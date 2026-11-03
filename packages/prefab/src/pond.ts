import { SpriteState } from '@dontstarve-web/display';
import { WorldContentKey, type GetWatchWorldContent, type TileStateQuery } from '@dontstarve-web/signals';
import { Vector3 } from 'three';
import type * as CANNON from 'cannon-es';
import { Fishable } from '../../componets/src/fishable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { SlipperyFeetTarget } from '../../componets/src/slipperyfeettarget';
import { WILSON_RUN_SPEED } from '../../componets/src/slipperyfeet';
import { COLLISION } from '../../componets/src/physicsState';
import { MARSH_PLANT_ID } from './marsh_plant';
import { PrefabInstance, type PrefabComponents , type PrefabEntityDefinition } from './prefabInstance';
import type { PlacementSaveRecord } from './saveRecord';
import { WORLD_SCALE } from './tile';
import { MakePondPhysics } from './standardcomponents';

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

/** What the scene injects into every pond. */
export interface PondWorld {
  scheduler: GameTimeScheduler;
  tickingarea?: TileStateQuery;
  getWatchWorldContent?: GetWatchWorldContent;
  physics?: CANNON.World;
  /** SpawnPrefab for the plants around the pond. */
  spawnPrefab?: (prefab: string, position: Vector3) => PrefabInstance | undefined;
}

interface PondComponents extends PrefabComponents {
  fishable?: Fishable;
  slipperyfeettarget?: SlipperyFeetTarget;
}

/** pond.lua's commonfn("") and pondfrog(): marsh_tile art, fishable pondfish, and frozen following snowlevel. */
export class PondInstance extends PrefabInstance<SpriteState, PondComponents> {
  /** Undefined until the first OnSnowLevel, as in the source. */
  frozen?: boolean;
  /** inst.plants: where the plants stand, in DST units from the pond; they outlive a burnt plant, not a freeze. */
  private plants?: NonNullable<PlacementSaveRecord['components']['plants']>;
  private plant_ents?: PrefabInstance<SpriteState, object>[];
  private readonly spawnPrefab: PondWorld['spawnPrefab'];
  private readonly getWatchWorldContent?: GetWatchWorldContent;
  private stopWatching?: () => void;
  private stopSnowLevel?: () => void;

  constructor({ scheduler, getWatchWorldContent, spawnPrefab }: PondWorld) {
    super(POND_ID, new SpriteState({ name: 'idle' }));
    this.getWatchWorldContent = getWatchWorldContent;
    this.spawnPrefab = spawnPrefab;
    // OnGround: lift only the artwork above terrain; the entity/save origin stays grounded. Ground layers share
    // group order 0 and use mesh order. A negative group order would draw the pond before transparent turf, which covers it up.
    this.sprite.setGround(0); this.sprite.setMeshOrder(-.5);
    for (const tag of ['watersource', 'pond', 'antlion_sinkhole_blocker', 'birdblocker']) this.addTag(tag);

    const fishable = this.components.fishable = new Fishable(this, scheduler);
    fishable.AddFish(POND_FISH.prefab, POND_FISH.build);
    fishable.SetRespawnTime(FISH_RESPAWN_TIME);

    this.onRemove(() => {
      this.stopSnowLevel?.();
      this.stopWatching?.();
      // Removing an entity removes its children.
      for (const plant of this.plant_ents ?? []) plant.remove();
      fishable.OnRemoveFromEntity();
    });
  }

  /** pond.lua OnInit: WatchWorldState("snowlevel", OnSnowLevel) and a first OnSnowLevel, through its own watched signal. */
  OnInit(): void {
    const snowLevel = this.getWatchWorldContent?.(WorldContentKey.SnowLevel, stop => { this.stopWatching = stop; });
    if (snowLevel) this.stopSnowLevel = snowLevel.subscribe(level => this.OnSnowLevel(level));
    this.OnSnowLevel(snowLevel?.peek() ?? 0);
  }

  OnSave(_inst: unknown, data: PlacementSaveRecord['components']): void {
    if (this.plants) data.plants = this.plants;
  }

  /** Always before OnInit here, while the source's inst.task is still pending. */
  OnLoad(_inst: unknown, data: PlacementSaveRecord['components']): void {
    this.plants ??= data.plants;
  }

  private SpawnPlants(): void {
    if (this.plant_ents) return;
    if (!this.plants) {
      this.plants = [];
      const count = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const theta = Math.random() * 2 * Math.PI;
        this.plants.push({ offset: [Math.sin(theta) * 1.9 + Math.random() * .3, 0, Math.cos(theta) * 2.1 + Math.random() * .3] });
      }
    }
    this.plant_ents = [];
    for (const { offset } of this.plants) {
      const position = new Vector3(this.position.x + offset[0] * WORLD_SCALE, 0, this.position.z + offset[2] * WORLD_SCALE);
      const plant = this.spawnPrefab?.(MARSH_PLANT_ID, position);
      if (!plant) continue;
      plant.entityParent = this as PrefabInstance<SpriteState, object>;
      plant.persists = false;
      this.plant_ents.push(plant);
    }
  }

  private DespawnPlants(): void {
    for (const plant of this.plant_ents ?? []) plant.remove();
    this.plant_ents = undefined;
    this.plants = undefined;
  }

  private OnSnowLevel(snowlevel: number): void {
    if (snowlevel > POND_FREEZE_SNOWLEVEL) {
      if (this.frozen) return;
      this.frozen = true;
      this.sprite.playOnce('frozen');
      this.components.fishable!.Freeze();
      this.physics.SetCollisionGroup(COLLISION.LAND_OCEAN_LIMITS);
      this.physics.SetCollisionMask(COLLISION.WORLD, COLLISION.ITEMS);
      this.DespawnPlants();
      const slipperyfeettarget = this.components.slipperyfeettarget = new SlipperyFeetTarget(this);
      slipperyfeettarget.SetSlipperyRate(slipperyRate);
    } else if (this.frozen) {
      this.frozen = false;
      this.sprite.start('idle');
      this.components.fishable!.Unfreeze();
      this.physics.SetCollisionGroup(COLLISION.OBSTACLES);
      this.physics.SetCollisionMask(COLLISION.ITEMS, COLLISION.CHARACTERS, COLLISION.GIANTS);
      this.SpawnPlants();
      this.components.slipperyfeettarget!.OnRemoveFromEntity();
      delete this.components.slipperyfeettarget;
    } else if (this.frozen === undefined) {
      this.frozen = false;
      this.SpawnPlants();
    }
  }
}

/** The Prefab table pond.lua returns, as far as it is ported. */
export function pondPrefabs(world: PondWorld): Readonly<Record<typeof POND_ID, PrefabEntityDefinition<PondInstance>>> {
  return {
    [POND_ID]: {
      fn: () => new PondInstance(world),
      assets: { animationArchive: 'marsh_tile.zip', buildArchives: ['marsh_tile.zip'], bank: 'marsh_tile' },
      physics: { make: MakePondPhysics, radius: 1.95 },
      minimapIcon: 'pond.png',
      onSpawned: pond => pond.OnInit(),
    },
  };
}
