import * as THREE from 'three';
import { SpriteResources, SpriteState, type PrefabDisplayGroup } from '@dontstarve-web/display';
import { createEffect, WorldContentKey, type GetWatchWorldContent, type TileStateQuery } from '@dontstarve-web/signals';
import { Fishable, type FishableSave } from '../../componets/src/fishable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { SlipperyFeetTarget } from '../../componets/src/slipperyfeettarget';
import { WILSON_RUN_SPEED } from '../../componets/src/slipperyfeet';
import { actionEntity } from './actionEntity';
import { bindInstance, PrefabInstance, type PrefabComponents } from './prefabInstance';
import { newEntityId } from './saveRecord';
import { watchTileActivity } from './tileActivity';

export const POND_ID = 'pond' as const;
/** tuning.lua FISH_RESPAWN_TIME = day_time / 3, day_time = 8 * 60 * 0.5 * 2 / 2. */
const FISH_RESPAWN_TIME = 480 / 3;
/** pondfish.lua `inst.build`: the build SGwilson's catchfish swaps into fish01. */
const POND_FISH = { prefab: 'pondfish', build: 'fish01' } as const;
/** pond.lua OnSnowLevel: snowlevel above this freezes the pond. */
const POND_FREEZE_SNOWLEVEL = .02;

/** pond.lua SlipperyRate: running faster than WILSON_RUN_SPEED slips ten times faster. */
const slipperyRate = (_: unknown, target: unknown) =>
  (target as { getMotorSpeed(): number }).getMotorSpeed() > WILSON_RUN_SPEED ? 50 : 5;

export interface PondRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { fishable?: FishableSave };
}

/** What the scene injects into every pond. */
export interface PondWorld {
  scheduler: GameTimeScheduler;
  tickingarea?: TileStateQuery;
  getWatchWorldContent?: GetWatchWorldContent;
}

interface PondComponents extends PrefabComponents {
  fishable?: Fishable;
  slipperyfeettarget?: SlipperyFeetTarget;
}

/** pond.lua's commonfn("") and pondfrog(): marsh_tile art, fishable pondfish, and frozen following snowlevel. */
export class PondInstance extends PrefabInstance<SpriteState, PondComponents> {
  frozen = false;

  constructor(position: THREE.Vector3, { scheduler, getWatchWorldContent }: PondWorld) {
    super(POND_ID, new SpriteState({ name: 'idle' }));
    this.setPosition(position.x, 0, position.z);
    // OnGround: lift only the artwork above terrain; the entity/save origin stays grounded. Ground layers share
    // group order 0 and use mesh order. A negative group order would draw the pond before transparent turf, which covers it up.
    this.sprite.setGround(0); this.sprite.setMeshOrder(-.5);
    // MakePondPhysics(inst, 1.95) is not ported; its radius still sets how close the fisher comes (GoToEntity).
    this.physicsRadiusOverride = 1.95;
    this.minimap.SetIcon('pond.png');
    for (const tag of ['watersource', 'pond', 'antlion_sinkhole_blocker', 'birdblocker']) this.addTag(tag);

    const fishable = this.components.fishable = new Fishable(this, scheduler);
    fishable.AddFish(POND_FISH.prefab, POND_FISH.build);
    fishable.SetRespawnTime(FISH_RESPAWN_TIME);

    // WatchWorldState("snowlevel", OnSnowLevel), through this pond's own watched signal.
    let stopWatching: (() => void) | undefined;
    const snowLevel = getWatchWorldContent?.(WorldContentKey.SnowLevel, stop => { stopWatching = stop; });
    if (snowLevel) createEffect(() => this.OnSnowLevel(snowLevel.get()));

    this.onRemove(() => {
      stopWatching?.();
      fishable.OnRemoveFromEntity();
    });
  }

  private OnSnowLevel(snowlevel: number): void {
    if (snowlevel > POND_FREEZE_SNOWLEVEL) {
      if (this.frozen) return;
      this.frozen = true;
      this.sprite.playOnce('frozen');
      this.components.fishable!.Freeze();
      const slipperyfeettarget = this.components.slipperyfeettarget = new SlipperyFeetTarget(this);
      slipperyfeettarget.SetSlipperyRate(slipperyRate);
    } else if (this.frozen) {
      this.frozen = false;
      this.sprite.start('idle');
      this.components.fishable!.Unfreeze();
      this.components.slipperyfeettarget!.OnRemoveFromEntity();
      delete this.components.slipperyfeettarget;
    }
  }
}

/** The ponds of a world: their collection, injected world and shared marsh_tile art. */
export class PondManager {
  private readonly resources: SpriteResources;
  private readonly ponds = new Set<PondInstance>();
  private readonly displays: PrefabDisplayGroup;
  private readonly world: PondWorld;
  private disposed = false;

  /** `displays` is the display-layer owner of the ponds' scene membership, injected and disposed by the application. */
  constructor(displays: PrefabDisplayGroup, animationBaseUrl: string, world: PondWorld) {
    this.displays = displays;
    this.resources = new SpriteResources(animationBaseUrl);
    this.world = world;
  }

  /** SpawnPrefab: the pond exists now and its display loads the art. */
  spawn(position: THREE.Vector3, saved?: PondRecord): PondInstance {
    if (this.disposed) throw new Error('Pond manager has been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid pond position');
    const instance = new PondInstance(position, this.world);
    const display = this.displays.add({ root: instance.transform.model, name: POND_ID, status: instance.status, sprite: instance.sprite, light: instance.light,
      archive: this.resources.archive({ animationArchive: 'marsh_tile.zip', buildArchives: ['marsh_tile.zip'], bank: 'marsh_tile' }) });
    bindInstance(display.model, instance);
    instance.entityId = saved?.id ?? newEntityId();
    instance.components.fishable!.OnLoad(saved?.components.fishable);
    actionEntity(display.model, POND_ID);
    this.ponds.add(instance);
    const stopActivity = watchTileActivity(display.model, this.world.tickingarea, active => instance.setActive(active));
    instance.onRemove(() => { stopActivity(); this.ponds.delete(instance); });
    return instance;
  }

  /** The display group advances the awake ponds' clips; fish respawn on the world's scheduler. */
  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    if (!this.disposed) this.displays.update(dt, cameraQuaternion);
  }

  exportRecords(): PondRecord[] {
    return [...this.ponds].map((pond) => {
      const fishable = pond.components.fishable!.OnSave();
      return {
        id: String(pond.entityId),
        transform: { position: [pond.position.x, 0, pond.position.z], rotationY: 0 },
        components: fishable ? { fishable } : {},
      };
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pond of [...this.ponds]) pond.remove();
    // Every pond's display is released above, before the shared resources.
    this.resources.dispose();
  }
}
