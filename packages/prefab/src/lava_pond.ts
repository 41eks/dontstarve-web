import { SpriteState } from '@dontstarve-web/display';
import { Vector3 } from 'three';
import { createSignal, readonlySignal } from '@dontstarve-web/signals';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { Heater } from '../../componets/src/heater';
import { ComponentTimer } from '../../componets/src/timer';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PrefabInstance, type PrefabComponents, type PrefabEntityDefinition } from './prefabInstance';
import type { PlacementSaveRecord } from './saveRecord';
import { MakePondPhysics } from './standardcomponents';
import { Transform } from './transform';
import { WORLD_SCALE } from './tile';

export const LAVA_POND_ID = 'lava_pond' as const;
export const LAVA_POND_ROCK_IDS = ['lava_pond_rock', 'lava_pond_rock2', 'lava_pond_rock3',
  'lava_pond_rock4', 'lava_pond_rock5', 'lava_pond_rock6', 'lava_pond_rock7'] as const;
export type LavaPondRockId = typeof LAVA_POND_ROCK_IDS[number];
export type LavaPondRockType = '' | '2' | '3' | '4' | '5' | '6' | '7';
/** NUM_ROCK_TYPES = 7: math.random(NUM_ROCK_TYPES) > 1 and tostring(rocktype) or "". */
export const LAVA_POND_ROCK_TYPES = ['', '2', '3', '4', '5', '6', '7'] as const;
export const LAVA_POND_HEAT = 500;
/** MakePondPhysics(inst, 1.95), in scene units. */
export const LAVA_POND_RADIUS = 1.95 * WORLD_SCALE;
export interface LavaPondRockLayout { rocktype: LavaPondRockType; offset: [number, number, number]; }
/** lava_pond.lua OnSave: `data.rocks = inst.rocks`. */
export interface LavaPondSaveState { rocks?: LavaPondRockLayout[]; }
const copyLayout = (rocks: readonly LavaPondRockLayout[]) => rocks.map(rock => ({ ...rock, offset: [...rock.offset] as [number, number, number] }));

/** What the scene injects into every lava pond. */
export interface LavaPondWorld {
  scheduler: GameTimeScheduler;
  /** SpawnPrefab for the rocks around the pond. */
  spawnPrefab(prefab: LavaPondRockId, position: Vector3): PrefabInstance;
  random?: () => number;
}

interface LavaPondComponents extends PrefabComponents {
  inspectable?: Inspectable;
  heater?: Heater;
}

/**
 * lava_pond.lua fn: lava_tile art, its light and heater, and the SpawnRocks children. Collision ignition, propagator,
 * cooker, hauntable and the dragonfly music are not ported.
 */
export class LavaPondInstance extends PrefabInstance<SpriteState, LavaPondComponents> {
  readonly no_wet_prefix = true;
  private readonly rocksState = createSignal<readonly LavaPondRockLayout[] | undefined>(undefined);
  /** inst.rocks: the layout, in DST units from the pond. */
  readonly rocks = readonlySignal(this.rocksState);
  /** inst.task = inst:DoTaskInTime(0, SpawnRocks). */
  private readonly task: ComponentTimer;
  readonly timer;
  private readonly rock_ents: PrefabInstance[] = [];
  private readonly world: LavaPondWorld;
  private readonly random: () => number;

  constructor(world: LavaPondWorld, position: Vector3) {
    super(LAVA_POND_ID, new SpriteState({ name: 'bubble_lava' }), Transform.stationary());
    this.world = world; this.random = world.random ?? Math.random;
    this.setPosition(position.x, 0, position.z);
    // OnGround, LAYER_BACKGROUND and sort order 3, as pond.lua: the art lies on the ground and the entity root stays in world space.
    this.sprite.setGround(0); this.sprite.setMeshOrder(-.5);
    for (const tag of ['lava', 'antlion_sinkhole_blocker', 'birdblocker', 'inspectable']) this.addTag(tag);
    this.light.set({ radius: 1.5 * WORLD_SCALE, falloff: .66, intensity: .66, colour: [235 / 255, 121 / 255, 12 / 255] });
    this.deploySmartRadius = 2 * WORLD_SCALE;

    const heater = new Heater(this);
    heater.SetHeat(LAVA_POND_HEAT);
    Object.assign(this.components, { inspectable: new Inspectable(this), heater });

    this.task = new ComponentTimer(world.scheduler, () => this.SpawnRocks());
    this.timer = this.task.snapshot;
    this.task.start(0);

    this.onRemove(() => {
      if (this.isTaskPending) this.task.stop();
      heater.dispose();
      // Removing an entity removes its children.
      for (const rock of this.rock_ents) rock.remove();
      this.rock_ents.length = 0;
    });
  }

  private get isTaskPending(): boolean {
    const { status } = this.timer.peek();
    return status === 'scheduled' || status === 'paused';
  }

  OnSave(_inst: unknown, data: PlacementSaveRecord['components']): void {
    const rocks = this.rocksState.peek();
    data.lavaPond = rocks === undefined ? {} : { rocks: copyLayout(rocks) };
  }

  /** OnLoad cancels the pending task and spawns the saved rocks at once. */
  OnLoad(_inst: unknown, data: PlacementSaveRecord['components']): void {
    const rocks = data.lavaPond?.rocks;
    if (rocks === undefined || this.rocksState.peek() !== undefined || !this.isTaskPending) return;
    this.task.stop();
    this.rocksState.set(copyLayout(rocks));
    this.SpawnRocks();
  }

  private SpawnRocks(): void {
    if (this.rocksState.peek() === undefined) {
      const rocks: LavaPondRockLayout[] = [];
      const count = 2 + Math.floor(this.random() * 3);
      for (let i = 0; i < count; i++) {
        const theta = this.random() * Math.PI * 2;
        const rocktype = LAVA_POND_ROCK_TYPES[Math.floor(this.random() * LAVA_POND_ROCK_TYPES.length)];
        rocks.push({ rocktype, offset: [Math.sin(theta) * 2.1 + this.random() * .3, 0, Math.cos(theta) * 2.1 + this.random() * .3] });
      }
      this.rocksState.set(rocks);
    }
    for (const { rocktype, offset } of this.rocksState.peek()!) {
      const position = new Vector3(this.position.x + offset[0] * WORLD_SCALE, 0, this.position.z + offset[2] * WORLD_SCALE);
      const rock = this.world.spawnPrefab(`lava_pond_rock${rocktype}`, position);
      rock.entityParent = this as PrefabInstance<SpriteState, object>;
      rock.persists = false;
      this.rock_ents.push(rock);
    }
  }
}

/** makerock(rocktype): scorched_rock art; every type but the first shares the `lava_pond_rock` name. */
export class LavaPondRockInstance extends PrefabInstance {
  declare readonly prefab: LavaPondRockId;
  readonly prefabNameOverride?: 'lava_pond_rock';

  constructor(prefab: LavaPondRockId, position: Vector3) {
    const rocktype = prefab.slice('lava_pond_rock'.length);
    super(prefab, new SpriteState({ name: `idle${rocktype}`, billboard: true }), Transform.stationary());
    this.setPosition(position.x, 0, position.z);
    this.sprite.playOnce(`idle${rocktype}`);
    if (rocktype.length > 0) this.prefabNameOverride = 'lava_pond_rock';
    this.addTag('inspectable');
    Object.assign(this.components, { inspectable: new Inspectable(this) });
  }
}

/** The Prefab table lava_pond.lua returns: the seven rocks and the pond. */
export function lavaPondPrefabs(world: LavaPondWorld): Readonly<Record<typeof LAVA_POND_ID, PrefabEntityDefinition<LavaPondInstance>>
  & Record<LavaPondRockId, PrefabEntityDefinition<LavaPondRockInstance>>> {
  const rock = (id: LavaPondRockId): PrefabEntityDefinition<LavaPondRockInstance> => ({
    fn: position => new LavaPondRockInstance(id, new Vector3(position.x, 0, position.z)),
    assets: { animationArchive: 'scorched_rock.zip', buildArchives: ['scorched_rock.zip'], bank: 'scorched_rock' },
  });
  return {
    [LAVA_POND_ID]: {
      fn: position => new LavaPondInstance(world, new Vector3(position.x, 0, position.z)),
      assets: { animationArchive: 'lava_tile.zip', buildArchives: ['lava_tile.zip'], bank: 'lava_tile' },
      physics: { make: MakePondPhysics, radius: 1.95 },
      minimapIcon: 'lava_pond.png',
    },
    ...Object.fromEntries(LAVA_POND_ROCK_IDS.map(id => [id, rock(id)])) as Record<LavaPondRockId, PrefabEntityDefinition<LavaPondRockInstance>>,
  };
}
