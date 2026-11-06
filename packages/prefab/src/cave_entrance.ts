import { SpriteState } from '@dontstarve-web/display';
import * as THREE from 'three';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { LootDropper } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import { WorldMigrator, type WorldMigratorShard } from '../../componets/src/worldmigrator';
import { actionEntity } from './actionEntity';
import type { SpawnGroundItem } from './groundPrefab';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { PlaySound } from './sound';
import { MakeObstaclePhysics } from './standardcomponents';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import { Transform } from './transform';
import catalog from './groundItems.json' with { type: 'json' };

export const CAVE_ENTRANCE_ID = 'cave_entrance' as const;
export const CAVE_ENTRANCE_OPEN_ID = 'cave_entrance_open' as const;
export const CAVE_ENTRANCE_IDS = [CAVE_ENTRANCE_ID, CAVE_ENTRANCE_OPEN_ID] as const;
export type CaveEntranceId = typeof CAVE_ENTRANCE_IDS[number];

/** tuning.lua ROCKS_MINE. */
const ROCKS_MINE = 6;
/** cave_entrance.lua MakeObstaclePhysics(inst, 1). */
const PHYSICS_RADIUS = 1;
/** cave_entrance.lua closed_fn SetLoot. */
const CLOSED_LOOT = ['rocks', 'rocks', 'flint', 'flint', 'flint'] as const;
/** LAYER_BACKGROUND with sort order 3: drawn under the world entities, still facing the camera. */
const BACKGROUND_RENDER_ORDER = -.5;

/** cave_entrance.lua open_fn `worldmigrator.shard_name`. */
export const CAVES_SHARD = 'Caves';

export interface CaveEntranceWorld extends ToolMouseTargetWorld {
  /** The shard link behind `cave_entrance_open`; without it the destination is never available. */
  shard?: WorldMigratorShard;
  /** lootdropper:DropLoot when the closed entrance is mined open; the loot's display loads its art. */
  spawnGroundItem: SpawnGroundItem;
  /** SpawnPrefab("cave_entrance_open") in the closed entrance's place. */
  spawnPrefab(prefab: typeof CAVE_ENTRANCE_OPEN_ID, position: ReadonlyVector3): unknown;
}

const NO_SHARD: WorldMigratorShard = { isWorldAvailable: () => false, isWorldFull: () => false, migratePlayer: () => {} };

/**
 * cave_entrance.lua fn / closed_fn / open_fn: a MINE-able sealed entrance that becomes `cave_entrance_open`.
 * workable.savestate defaults to false and worldmigrator saves are not ported: records carry only identity and position.
 * The bats' childspawner, pointofinterest and cave_entrance_ruins are not ported.
 */
export class CaveEntranceInstance extends PrefabInstance {
  declare readonly prefab: CaveEntranceId;
  declare readonly components: PrefabInstance['components'] & { inspectable: Inspectable; workable?: Workable; lootdropper?: LootDropper; worldmigrator?: WorldMigrator };

  constructor(prefab: CaveEntranceId, world: CaveEntranceWorld, position: ReadonlyVector3) {
    const open = prefab === CAVE_ENTRANCE_OPEN_ID;
    super(prefab, new SpriteState({ name: open ? 'no_access' : 'idle_closed', held: !open, billboard: true }), Transform.stationary());
    this.setPosition(position.x, 0, position.z);
    // PlayAnimation("idle_closed") plays once rather than resting on its last frame.
    if (!open) this.sprite.playOnce('idle_closed');
    else this.sprite.setGround(BACKGROUND_RENDER_ORDER, false);
    this.addTag('antlion_sinkhole_blocker');
    this.addTag('inspectable');
    this.components.inspectable = new Inspectable(this);
    if (open) open_fn(this, world); else closed_fn(this, world);
  }
}

/** closed_fn: MINE for ROCKS_MINE work; OnWork shows low/med/idle_closed and finally drops the loot and opens. */
function closed_fn(inst: CaveEntranceInstance, world: CaveEntranceWorld): void {
  const workable = new Workable(inst);
  workable.SetWorkAction('MINE');
  workable.SetWorkLeft(ROCKS_MINE);
  const lootdropper = new LootDropper(inst, (itemId, point) => world.spawnGroundItem(
    { ...catalog.items[itemId as keyof typeof catalog.items], itemId, count: 1 }, new THREE.Vector3(point.x, point.y, point.z), { fling: true }));
  lootdropper.SetLoot(CLOSED_LOOT);
  workable.SetOnWorkCallback((_inst, _worker, workleft) => OnWork(inst, world, workleft));
  Object.assign(inst.components, { workable, lootdropper });
  inst.onRemove(() => workable.dispose());
}

function OnWork(inst: CaveEntranceInstance, world: CaveEntranceWorld, workleft: number): void {
  if (workleft > 0) {
    inst.sprite.playOnce(workleft < ROCKS_MINE / 3 ? 'low' : workleft < ROCKS_MINE * 2 / 3 ? 'med' : 'idle_closed');
    return;
  }
  // rock_break_fx, DropLoot, then cave_entrance_open takes the closed entrance's place.
  const pt = inst.position;
  PlaySound('dontstarve/wilson/rock_break', pt);
  inst.components.lootdropper!.DropLoot();
  world.spawnPrefab(CAVE_ENTRANCE_OPEN_ID, pt);
  inst.remove();
}

/** open_fn: the migration events pick the loop (`open`, `no_access`, `over_capacity`); the destination is the Caves shard. */
function open_fn(inst: CaveEntranceInstance, world: CaveEntranceWorld): void {
  const migrator = new WorldMigrator(inst, world.shard ?? NO_SHARD);
  inst.components.worldmigrator = migrator;
  inst.ListenForEvent('migration_available', () => inst.sprite.start('open'));
  inst.ListenForEvent('migration_unavailable', () => inst.sprite.start('no_access'));
  inst.ListenForEvent('migration_full', () => inst.sprite.start('over_capacity'));
  migrator.SetDestinationWorld(CAVES_SHARD);
}

/** The two Prefabs cave_entrance.lua returns that are ported. */
export function caveEntrancePrefabs(world: CaveEntranceWorld): Readonly<Record<CaveEntranceId, PrefabEntityDefinition<CaveEntranceInstance>>> {
  const definition = (id: CaveEntranceId): PrefabEntityDefinition<CaveEntranceInstance> => ({
    fn: position => new CaveEntranceInstance(id, world, position),
    assets: { animationArchive: 'cave_entrance.zip', buildArchives: ['cave_entrance.zip'], bank: 'cave_entrance' },
    physics: { make: MakeObstaclePhysics, radius: PHYSICS_RADIUS },
    minimapIcon: id === CAVE_ENTRANCE_ID ? 'cave_closed.png' : 'cave_open.png',
    onSpawned: inst => {
      const workable = inst.components.workable;
      if (workable) new ToolMouseTarget(actionEntity(inst.transform.model, id), inst, workable, world.handEquipment);
    },
  });
  return { cave_entrance: definition(CAVE_ENTRANCE_ID), cave_entrance_open: definition(CAVE_ENTRANCE_OPEN_ID) };
}
