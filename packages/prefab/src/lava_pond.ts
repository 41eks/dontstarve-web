import { definePrefabIds } from './prefabRegistration';
import { addComponent } from './components';
import { SpriteState } from '@dontstarve-web/display';
import { Vector3 } from 'three';
import { createSignal, readonlySignal } from '@dontstarve-web/signals';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { Heater } from '../../componets/src/heater';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PrefabInstance, type EntityTask, type PrefabComponents, type PrefabEntityDefinition } from './prefabInstance';
import type { EntityPersistData } from './saveRecord';
import { MakePondPhysics } from './standardcomponents';
import { WORLD_SCALE } from './tile';

export const LAVA_POND_ID = 'lava_pond' as const;
export const LAVA_POND_ROCK_IDS = [
  'lava_pond_rock',
  'lava_pond_rock2',
  'lava_pond_rock3',
  'lava_pond_rock4',
  'lava_pond_rock5',
  'lava_pond_rock6',
  'lava_pond_rock7',
] as const;
export type LavaPondRockId = (typeof LAVA_POND_ROCK_IDS)[number];
export type LavaPondRockType = '' | '2' | '3' | '4' | '5' | '6' | '7';
/** NUM_ROCK_TYPES = 7: math.random(NUM_ROCK_TYPES) > 1 and tostring(rocktype) or "". */
export const LAVA_POND_ROCK_TYPES = ['', '2', '3', '4', '5', '6', '7'] as const;
export const LAVA_POND_HEAT = 500;
/** MakePondPhysics(inst, 1.95), in scene units. */
export const LAVA_POND_RADIUS = 1.95 * WORLD_SCALE;
export interface LavaPondRockLayout {
  rocktype: LavaPondRockType;
  offset: [number, number, number];
}
/** lava_pond.lua OnSave: `data.rocks = inst.rocks`. */
export interface LavaPondSaveState {
  rocks?: LavaPondRockLayout[];
}
const copyLayout = (rocks: readonly LavaPondRockLayout[]) =>
  rocks.map(rock => ({ ...rock, offset: [...rock.offset] as [number, number, number] }));

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
  task?: EntityTask;
  private readonly rock_ents: PrefabInstance[] = [];
  private readonly world: LavaPondWorld;
  private readonly random: () => number;

  constructor(world: LavaPondWorld, position: Vector3) {
    super(LAVA_POND_ID, new SpriteState({ name: 'bubble_lava' }));
    this.world = world;
    this.random = world.random ?? Math.random;
    this.BindScheduler(world.scheduler);
    this.setPosition(position.x, 0, position.z);
    // OnGround, LAYER_BACKGROUND and sort order 3, as pond.lua: the art lies on the ground and the entity root stays in world space.
    this.sprite.setGround(0);
    this.sprite.setMeshOrder(-0.5);
    for (const tag of ['lava', 'antlion_sinkhole_blocker', 'birdblocker', 'inspectable']) {
      this.addTag(tag);
    }
    this.light.set({
      radius: 1.5 * WORLD_SCALE,
      falloff: 0.66,
      intensity: 0.66,
      colour: [235 / 255, 121 / 255, 12 / 255],
    });
    this.deploySmartRadius = 2 * WORLD_SCALE;

    const heater = addComponent(this, 'heater', Heater);
    heater.SetHeat(LAVA_POND_HEAT);
    addComponent(this, 'inspectable', Inspectable);

    this.task = this.DoTaskInTime(0, () => this.SpawnRocks());

    this.onRemove(() => {
      heater.dispose();
      // The rocks are parented with entity:SetParent and retire with the pond.
      this.rock_ents.length = 0;
    });
  }

  override OnSave(_inst: unknown, data: EntityPersistData): void {
    const rocks = this.rocksState.value;
    data.lavaPond = rocks === undefined ? {} : { rocks: copyLayout(rocks) };
  }

  /** OnLoad cancels the pending task and spawns the saved rocks at once. */
  override OnLoad(_inst: unknown, data: EntityPersistData): void {
    const rocks = data.lavaPond?.rocks;
    if (rocks === undefined || this.rocksState.value !== undefined || !this.task) {
      return;
    }
    this.task.Cancel();
    this.task = undefined;
    this.rocksState.set(copyLayout(rocks));
    this.SpawnRocks();
  }

  private SpawnRocks(): void {
    this.task = undefined;
    let rocks = this.rocksState.value;
    if (rocks === undefined) {
      const layout: LavaPondRockLayout[] = [];
      const count = 2 + Math.floor(this.random() * 3);
      for (let i = 0; i < count; i++) {
        const theta = this.random() * Math.PI * 2;
        const rocktype = LAVA_POND_ROCK_TYPES[Math.floor(this.random() * LAVA_POND_ROCK_TYPES.length)];
        layout.push({
          rocktype,
          offset: [Math.sin(theta) * 2.1 + this.random() * 0.3, 0, Math.cos(theta) * 2.1 + this.random() * 0.3],
        });
      }
      this.rocksState.set((rocks = layout));
    }
    for (const { rocktype, offset } of rocks) {
      const position = new Vector3(
        this.position.x + offset[0] * WORLD_SCALE,
        0,
        this.position.z + offset[2] * WORLD_SCALE,
      );
      const rock = this.world.spawnPrefab(`lava_pond_rock${rocktype}`, position);
      rock.entityParent = this;
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
    super(prefab, new SpriteState({ name: `idle${rocktype}`, billboard: true }));
    this.setPosition(position.x, 0, position.z);
    this.sprite.playOnce(`idle${rocktype}`);
    if (rocktype.length > 0) {
      this.prefabNameOverride = 'lava_pond_rock';
    }
    this.addTag('inspectable');
    addComponent(this, 'inspectable', Inspectable);
  }
}

/** The Prefab table lava_pond.lua returns: the seven rocks and the pond. */
export function lavaPondPrefabs(
  world: LavaPondWorld,
): Readonly<
  Record<typeof LAVA_POND_ID, PrefabEntityDefinition<LavaPondInstance>> &
    Record<LavaPondRockId, PrefabEntityDefinition<LavaPondRockInstance>>
> {
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
    ...(Object.fromEntries(LAVA_POND_ROCK_IDS.map(id => [id, rock(id)])) as Record<
      LavaPondRockId,
      PrefabEntityDefinition<LavaPondRockInstance>
    >),
  };
}

export const lavaPondRegistration = {
  create: lavaPondPrefabs,
  families: {
    lavaPonds: definePrefabIds([LAVA_POND_ID], true),
    lavaPondRocks: definePrefabIds(LAVA_POND_ROCK_IDS, true),
  },
};
