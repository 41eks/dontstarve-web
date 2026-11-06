import { SpriteState } from '@dontstarve-web/display';
import { WorldMigrator, type WorldMigratorShard } from '../../componets/src/worldmigrator';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';
import { Transform } from './transform';

export const CAVE_EXIT_ID = 'cave_exit' as const;
export const CAVE_EXIT_IDS = [CAVE_EXIT_ID] as const;

/** cave_exit.lua MakeObstaclePhysics(inst, 2). */
const PHYSICS_RADIUS = 2;
/** cave_exit.lua `worldmigrator.shard_name`. */
export const MASTER_SHARD = 'Master';
const NO_SHARD: WorldMigratorShard = { isWorldAvailable: () => false, isWorldFull: () => false, migratePlayer: () => {} };

export interface CaveExitWorld {
  /** The shard link behind the stairs; without it the destination is never available. */
  shard?: WorldMigratorShard;
}

function open(inst: PrefabInstance): void { inst.sprite.start('open'); }
function close(inst: PrefabInstance): void { inst.sprite.start('no_access'); }
function full(inst: PrefabInstance): void { inst.sprite.start('over_capacity'); }

/** cave_exit.lua fn: the staircase back to the surface; the migration events pick its loop. The client-hosted branch does not apply. */
export class CaveExitInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { worldmigrator: WorldMigrator };

  constructor(world: CaveExitWorld) {
    super(CAVE_EXIT_ID, new SpriteState({ name: 'open', billboard: true }), Transform.stationary());
    this.sprite.playOnce('open'); // PlayAnimation("open"), never looping.
    const worldmigrator = new WorldMigrator(this, world.shard ?? NO_SHARD);
    Object.assign(this.components, { worldmigrator, inspectable: {
      /** GetStatus. */
      getstatus: () => worldmigrator.IsActive() ? 'OPEN' : worldmigrator.IsFull() ? 'FULL' : undefined,
    } });
    const stops = [
      this.ListenForEvent('migration_available', () => open(this)),
      this.ListenForEvent('migration_unavailable', () => close(this)),
      this.ListenForEvent('migration_full', () => full(this)),
    ];
    this.onRemove(() => stops.forEach(stop => stop()));
    worldmigrator.SetDestinationWorld(MASTER_SHARD);
  }
}

/** The Prefab cave_exit.lua returns. worldmigrator has no OnSave: records carry only identity and position. */
export function caveExitPrefabs(world: CaveExitWorld): Readonly<Record<typeof CAVE_EXIT_ID, PrefabEntityDefinition<CaveExitInstance>>> {
  return {
    [CAVE_EXIT_ID]: {
      fn: () => new CaveExitInstance(world),
      assets: { animationArchive: 'cave_exit.zip', buildArchives: ['cave_exit.zip'], bank: 'cave_stairs' },
      physics: { make: MakeObstaclePhysics, radius: PHYSICS_RADIUS },
      minimapIcon: 'cave_open2.png',
    },
  };
}
