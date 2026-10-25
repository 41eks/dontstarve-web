import * as THREE from 'three';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory, type SpriteAnimationController } from '@dontstarve-web/animation/sprite';
import { createEffect, WorldContentKey, type GetWatchWorldContent, type WorldContentSignal } from '@dontstarve-web/signals';
import { Fishable, type FishableSave } from '../../componets/src/fishable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { SlipperyFeetTarget } from '../../componets/src/slipperyfeettarget';
import { WILSON_RUN_SPEED } from '../../componets/src/slipperyfeet';
import { actionEntity } from './actionEntity';
import { WORLD_SCALE } from './standardcomponents';
import { newEntityId } from './saveRecord';
import { MiniMapEntity } from './minimapEntity';
import { createPrefabEntity, prefabInstance } from './prefabInstance';
import type { PrefabDisplay } from '@dontstarve-web/display';

export const POND_ID = 'pond' as const;
/** pond.lua MakePondPhysics(inst, 1.95), in scene units. */
const POND_RADIUS = 1.95 * WORLD_SCALE;
/** pond.lua SlipperyRate: running faster than WILSON_RUN_SPEED slips ten times faster. */
const slipperyRate = (_: unknown, target: unknown) =>
  (target as { getMotorSpeed(): number }).getMotorSpeed() > WILSON_RUN_SPEED ? 50 : 5;

export interface PondRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { fishable?: FishableSave };
}

/** tuning.lua FISH_RESPAWN_TIME = day_time / 3, day_time = 8 * 60 * 0.5 * 2 / 2. */
export const FISH_RESPAWN_TIME = 480 / 3;
/** pondfish.lua `inst.build`: the build SGwilson's catchfish swaps into fish01. */
export const POND_FISH = { prefab: 'pondfish', build: 'fish01' } as const;

/** A pond as the fishing action sees it. */
export interface FishingPondTarget {
  readonly entity: ReturnType<typeof actionEntity>;
  readonly model: THREE.Group;
  readonly position: THREE.Vector3;
  /** MakePondPhysics radius in scene units. */
  readonly radius: number;
  isValid(): boolean;
}

/** pond.lua OnSnowLevel: snowlevel above this freezes the pond. */
export const POND_FREEZE_SNOWLEVEL = .02;

/** pond.lua: marsh_tile bank/build, looping idle, OnGround background layer; frozen follows snowlevel. */
export class PondManager {
  private factoryRequest?: Promise<AnimatedSpriteFactory>;
  private readonly ponds = new Set<THREE.Group>();
  private readonly minimaps = new Map<THREE.Group, MiniMapEntity>();
  private readonly scene: THREE.Scene;
  private readonly assetBaseUrl: string;
  private readonly snowLevel?: WorldContentSignal<number>;
  private readonly cleanups: (() => void)[] = [];
  private readonly scheduler: GameTimeScheduler;
  private frozen = false;
  private disposed = false;

  /** WatchWorldState("snowlevel", OnSnowLevel), with a private watched weather signal. */
  constructor(scene: THREE.Scene, assetBaseUrl: string, scheduler: GameTimeScheduler, getWatchWorldContent?: GetWatchWorldContent) {
    this.scene = scene;
    this.scheduler = scheduler;
    this.assetBaseUrl = assetBaseUrl;
    if (getWatchWorldContent) {
      this.snowLevel = getWatchWorldContent(WorldContentKey.SnowLevel, stop => this.cleanups.push(stop));
      createEffect(() => this.onSnowLevel(this.snowLevel!.get()));
    }
  }

  private onSnowLevel(snowlevel: number): void {
    const frozen = snowlevel > POND_FREEZE_SNOWLEVEL;
    if (frozen === this.frozen) return;
    this.frozen = frozen;
    for (const model of this.ponds) this.applyFrozen(model, true);
  }

  private applyFrozen(model: THREE.Group, animate: boolean): void {
    model.userData.frozen = this.frozen;
    const entity = actionEntity(model, POND_ID), components = entity.components as { slipperyfeettarget?: SlipperyFeetTarget; fishable?: Fishable };
    if (this.frozen) components.fishable?.Freeze(); else components.fishable?.Unfreeze();
    if (this.frozen && !components.slipperyfeettarget) {
      components.slipperyfeettarget = new SlipperyFeetTarget({
        addTag: tag => entity.addTag(tag), removeTag: tag => entity.removeTag(tag),
        getPosition: () => entity.getPosition(), getPhysicsRadius: () => POND_RADIUS,
      });
      components.slipperyfeettarget.SetSlipperyRate(slipperyRate);
    } else if (!this.frozen && components.slipperyfeettarget) {
      components.slipperyfeettarget.OnRemoveFromEntity();
      delete components.slipperyfeettarget;
    }
    const controller = model.userData.animationController as SpriteAnimationController;
    if (this.frozen) controller.playOnce('frozen');
    else controller.start('idle');
    if (!animate) controller.update(0);
  }

  async spawn(position: THREE.Vector3, saved?: PondRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Pond manager has been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid pond position');
    if (!this.factoryRequest) {
      this.factoryRequest = createAnimatedSpriteFactory(this.assetBaseUrl, 'marsh_tile.zip');
      void this.factoryRequest.catch(() => { this.factoryRequest = undefined; });
    }
    const factory = await this.factoryRequest;
    if (this.disposed) throw new Error('Pond manager has been disposed');
    const { instance, display } = createPrefabEntity(POND_ID, { create: animation => factory.create({ initialAnimation: animation, name: POND_ID }),
      release: sprite => factory.disposeSprite(sprite) }, { name: 'idle' }, POND_ID);
    const model = display.model;
    model.position.set(position.x, 0, position.z);
    // OnGround: lift only the artwork above terrain; the entity/save origin stays grounded. Ground layers share
    // group order 0 and use mesh order. A negative group order would draw the pond before transparent turf, which covers it up.
    instance.sprite.setGround(0); instance.sprite.setMeshOrder(-0.5);
    instance.entityId = saved?.id ?? newEntityId();
    model.userData.billboard = false;
    // pond.lua: the fishable component holds pondfish and respawns one every FISH_RESPAWN_TIME.
    const entity = actionEntity(model, POND_ID);
    const fishable = new Fishable(entity, this.scheduler);
    fishable.AddFish(POND_FISH.prefab, POND_FISH.build);
    fishable.SetRespawnTime(FISH_RESPAWN_TIME);
    fishable.OnLoad(saved?.components.fishable);
    (entity.components as { fishable?: Fishable }).fishable = fishable;
    // pond.lua commonfn: MiniMapEntity:SetIcon("pond"..pondtype..".png"), pondtype "" for the forest pond.
    const minimap = new MiniMapEntity(model.position);
    minimap.SetIcon('pond.png');
    this.minimaps.set(model, minimap);
    this.ponds.add(model);
    this.applyFrozen(model, false);
    this.scene.add(model);
    return model;
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const model of this.ponds) {
      (model.userData.animationController as SpriteAnimationController).update(dt);
    }
  }

  get miniMapEntities(): MiniMapEntity[] { return [...this.minimaps.values()]; }

  /** Frozen ponds drop the `fishable` tag, so the fishing action no longer targets them. */
  get fishTargets(): readonly FishingPondTarget[] { return this.getFishTargets(); }

  getFishTargets(model?: THREE.Object3D): readonly FishingPondTarget[] {
    return (model && this.ponds.has(model as THREE.Group) ? [model as THREE.Group] : model ? [] : [...this.ponds]).map(model => {
      const entity = actionEntity(model, POND_ID);
      return { entity, model, position: entity.getPosition(), radius: POND_RADIUS, isValid: () => !entity.isRemoved && this.ponds.has(model) };
    });
  }

  exportRecords(): PondRecord[] {
    return [...this.ponds].map((model) => {
      const fishable = (actionEntity(model, POND_ID).components as { fishable?: Fishable }).fishable?.OnSave();
      return {
        id: String(prefabInstance(model)!.entityId),
        transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
        components: fishable ? { fishable } : {},
      };
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cleanups.splice(0).forEach(stop => stop());
    for (const model of this.ponds) {
      (actionEntity(model, POND_ID).components as { fishable?: Fishable }).fishable?.OnRemoveFromEntity();
      prefabInstance(model)!.remove();
      (model.userData.display as PrefabDisplay).dispose();
    }
    for (const minimap of this.minimaps.values()) minimap.dispose();
    this.minimaps.clear();
    this.ponds.clear();
    void this.factoryRequest?.then((factory) => factory.dispose(), () => undefined);
  }
}
