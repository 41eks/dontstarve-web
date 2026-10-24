import { createSignal, readonlySignal } from '../../signals/src';

/** worldmigrator.lua STATUS. */
export type WorldMigratorStatus = 'active' | 'inactive' | 'full';

/** The entity that owns a worldmigrator: it takes the `migrator` tag and hears the status events. */
export interface WorldMigratorInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
  PushEvent?(name: string, data?: unknown): void;
}

/** The player-side doer of `Activate`; only `player` is migrated. */
export interface WorldMigratorDoer {
  hasTag(tag: string): boolean;
}

/** TheShard / Shard_IsWorldAvailable / ms_playerdespawnandmigrate, injected by the world that owns the shard link. */
export interface WorldMigratorShard {
  isWorldAvailable(worldId: string): boolean;
  isWorldFull(worldId: string): boolean;
  /** TheWorld:PushEvent("ms_playerdespawnandmigrate", { player, portalid, worldid }). */
  migratePlayer(player: WorldMigratorDoer, portalId: number | undefined, worldId: string): void;
}

/** components/worldmigrator.lua: a portal to another shard. Saves, item transfer and portal-id negotiation are not ported. */
export class WorldMigrator {
  auto = true;
  id: number | undefined;
  linkedWorld: string | undefined;
  receivedPortal: number | undefined;
  private enabled = true;
  private hiddenaction = false;
  private readonly statusState = createSignal<WorldMigratorStatus | undefined>(undefined);
  readonly status = readonlySignal(this.statusState);
  private readonly inst: WorldMigratorInst;
  private readonly shard: WorldMigratorShard;

  constructor(inst: WorldMigratorInst, shard: WorldMigratorShard) {
    this.inst = inst; this.shard = shard;
  }

  /** onstatus: the `migrator` tag follows ACTIVE unless the actions are hidden. */
  private setStatus(status: WorldMigratorStatus): void {
    this.statusState.set(status);
    if (!this.hiddenaction && status === 'active') this.inst.addTag('migrator');
    else this.inst.removeTag('migrator');
  }

  SetHideActions(hidden: boolean): void {
    this.hiddenaction = hidden;
    if (!hidden && this.statusState.peek() === 'active') this.inst.addTag('migrator');
    else this.inst.removeTag('migrator');
  }

  SetDestinationWorld(world: string | undefined, permanent?: boolean): void {
    this.auto = permanent === undefined ? true : !permanent;
    this.linkedWorld = world;
    this.ValidateAndPushEvents();
  }

  SetEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.ValidateAndPushEvents();
  }

  SetID(id: number): void { this.id = id; this.receivedPortal = id; }

  ValidateAndPushEvents(): void {
    if (!this.enabled) {
      this.setStatus('inactive');
      this.inst.PushEvent?.('migration_unavailable');
      return;
    }
    const status = this.statusState.peek(), world = this.linkedWorld;
    if (status !== 'active' && world !== undefined && this.shard.isWorldAvailable(world)) {
      this.setStatus('active');
      this.inst.PushEvent?.('migration_available');
    } else if (status !== 'full' && world !== undefined && this.shard.isWorldFull(world)) {
      this.setStatus('full');
      this.inst.PushEvent?.('migration_full');
    } else if (status !== 'inactive' && (world === undefined || !this.shard.isWorldAvailable(world))) {
      this.setStatus('inactive');
      this.inst.PushEvent?.('migration_unavailable');
    }
  }

  IsActive(): boolean { return this.enabled && this.statusState.peek() === 'active'; }
  IsFull(): boolean { return this.statusState.peek() === 'full'; }
  IsLinked(): boolean { return this.linkedWorld !== undefined && this.receivedPortal !== undefined; }

  /** ACTIONS.MIGRATE.fn: false is the NODESTINATION failure. */
  Activate(doer: WorldMigratorDoer): boolean {
    if (this.linkedWorld === undefined || !doer.hasTag('player')) return false;
    this.inst.PushEvent?.('migration_activate', { doer });
    this.shard.migratePlayer(doer, this.id, this.linkedWorld);
    return true;
  }
}
