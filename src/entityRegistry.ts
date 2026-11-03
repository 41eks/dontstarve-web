import type { ReadonlyVector3 } from '@dontstarve-web/animation/transformRoot';
import type * as THREE from 'three';
import { Vector3 } from 'three';
import type { ResidentEntity } from '@dontstarve-web/animation/residentSprite';
import type { SavedEntity } from './save/types';
import type { PrefabDefinition } from './prefabDefinitions';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import { PrefabInstance, PrefabEntityManager, prefabInstance } from '@dontstarve-web/prefab/prefabInstance';
import type { DisplayDrivenPrefabManager } from '@dontstarve-web/prefab/manager';

/** What a restore handler hands back for the saved id: the logical entity, or for older managers its model. */
export type RestoredEntity = THREE.Object3D | ResidentEntity | PrefabInstance<ArchiveSpriteCommands>;

export interface EntityRenderEntry {
  object: THREE.Object3D;
  footPosition: ReadonlyVector3;
  cameraDepth: number;
  /** Drawing layer before depth sorting: background < 0, ordinary world entities default to 0. */
  renderLayer?: number;
  /** Order among parts sharing one foot point (default 1): an effect passes its owner's foot. */
  sortLayer?: number;
}

export interface EntityRecord {
  prefabId: string;
  record: {
    id: string;
    transform: { position: readonly [number, number, number]; rotationY: number };
    components: SavedEntity['components'];
  };
}

export interface EntityRegistration<PrefabId extends string> {
  restore?: (prefabId: PrefabId, record: SavedEntity) => Promise<RestoredEntity> | RestoredEntity;
  /** Only these IDs are exposed through c_spawn, including any aliases. */
  debugSpawn?: (prefabId: PrefabId) => unknown;
  /** SpawnPrefab(id, skin) then Transform:SetPosition for the source prefabs this family owns, synchronously. */
  spawnPrefab?: Readonly<Record<string, (position: THREE.Vector3, skinId?: string) => THREE.Object3D | PrefabInstance | undefined>>;
  exportRecords: () => readonly EntityRecord[];
  beforePhysics?: (dt: number) => void;
  update?: (dt: number, cameraQuaternion: THREE.Quaternion) => void;
  renderEntities?: () => readonly EntityRenderEntry[];
  dispose: () => void;
}

/** A display-owned prefab family: its manager has no frame hook to forward animations through. */
export interface DisplayDrivenEntityManager extends DisplayDrivenPrefabManager<EntityRecord> {
  readonly renderEntities?: readonly EntityRenderEntry[];
}

/** Routes scene lifecycles through the same declarations used by debug spawning. */
export class EntityRegistry {
  readonly byEntityId = new Map<string, RestoredEntity>();
  private readonly restorers = new Map<string, (record: SavedEntity) => ReturnType<NonNullable<EntityRegistration<string>['restore']>>>();
  private readonly creators = new Map<string, () => unknown>();
  private readonly spawners = new Map<string, NonNullable<EntityRegistration<string>['spawnPrefab']>[string]>();
  private readonly registrations: (EntityRegistration<string> & { definition: PrefabDefinition })[] = [];
  private readonly displays = new Set<PrefabDisplay>();
  private readonly lifecycleOrder: ReadonlyMap<PrefabDefinition, number>;
  private disposed = false;
  /** Reused each frame: render ordering reads the list before the next frame refills it. */
  private readonly renderEntries: EntityRenderEntry[] = [];

  private readonly prefabs?: PrefabEntityManager<string, PrefabInstance>;
  private readonly spawnPosition?: () => THREE.Vector3;

  /** Construction dependencies may differ from the required frame/update and disposal order. */
  constructor(lifecycleOrder: readonly PrefabDefinition[] = [], prefabs?: PrefabEntityManager<string, PrefabInstance>, spawnPosition?: () => THREE.Vector3) {
    this.prefabs = prefabs; this.spawnPosition = spawnPosition;
    this.lifecycleOrder = new Map(lifecycleOrder.map((definition, index) => [definition, index]));
  }

  register<PrefabId extends string>(definition: PrefabDefinition<PrefabId>, registration: EntityRegistration<PrefabId>): void {
    // this.assertActive();
    const savedIds = definition.prefabIds;
    const debugIds = definition.debugSpawnIds;
    if (savedIds.length && !registration.restore) throw new Error('Persistent entities require a restore handler');
    if (debugIds.length && !registration.debugSpawn) throw new Error('Debug prefabs require a spawn handler');
    if (this.registrations.some((entry) => entry.definition === definition)
      || new Set(savedIds).size !== savedIds.length || new Set(debugIds).size !== debugIds.length
      || savedIds.some((id) => this.restorers.has(id)) || debugIds.some((id) => this.creators.has(id))) {
      throw new Error('Duplicate entity registration');
    }
    for (const id of savedIds) this.restorers.set(id, (record) => registration.restore!(id, record));
    for (const id of debugIds) this.creators.set(id, () => registration.debugSpawn!(id));
    for (const [id, spawn] of Object.entries(registration.spawnPrefab ?? {})) {
      if (this.spawners.has(id)) throw new Error('Duplicate entity registration');
      this.spawners.set(id, spawn);
    }
    // Prefab IDs have been bound above; lifecycle callbacks no longer accept IDs.
    this.registrations.push({ ...registration, definition, restore: undefined, debugSpawn: undefined });
    this.registrations.sort((a, b) =>
      (this.lifecycleOrder.get(a.definition) ?? this.lifecycleOrder.size) - (this.lifecycleOrder.get(b.definition) ?? this.lifecycleOrder.size));
  }

  /** Expose a registered prefab family through commands/restoration; its shared owner is advanced and saved once. */
  registerPrefabs<PrefabId extends string>(definition: PrefabDefinition<PrefabId>): void {
    if (!this.prefabs) throw new Error('No shared prefab manager');
    if (definition.debugSpawnIds.length && !this.spawnPosition) throw new Error('No debug spawn position');
    for (const id of new Set([...definition.prefabIds, ...definition.debugSpawnIds])) if (!this.prefabs.has(id)) throw new Error(`Missing prefab declaration: ${id}`);
    this.register(definition, {
      restore: (id, record) => this.prefabs!.spawn(id, new Vector3(...record.transform.position), record),
      debugSpawn: definition.debugSpawnIds.length ? id => this.prefabs!.spawn(id, this.spawnPosition!()) : undefined,
      exportRecords: () => [], dispose: () => {},
    });
  }

  /** Bind a display-driven manager without exposing an update callback at the scene registration site. */
  registerDisplayManager<PrefabId extends string>(definition: PrefabDefinition<PrefabId>, manager: DisplayDrivenEntityManager,
    handlers: Pick<EntityRegistration<PrefabId>, 'restore' | 'debugSpawn'>): void {
    this.register(definition, {
      ...handlers,
      exportRecords: () => manager.exportRecords(),
      renderEntities: () => manager.renderEntities ?? [],
      dispose: () => manager.dispose(),
    });
  }

  get prefabDefinitions(): readonly PrefabDefinition[] {
    return this.registrations.map(({ definition }) => definition);
  }

  /** Fail during setup if the shared catalog has an unbound scene family. */
  assertDefinitions(definitions: readonly PrefabDefinition[]): void {
    // this.assertActive();
    const bound = new Set(this.prefabDefinitions);
    for (const definition of definitions) {
      if (!bound.has(definition)) throw new Error(`Unbound prefab definition: ${definition.prefabIds.join(', ') || 'transient effects'}`);
    }
  }

  /** SpawnPrefab for game code: the logical inst exists now and its display loads the art. */
  SpawnPrefab(prefabId: string, position: THREE.Vector3, skinId?: string): PrefabInstance | undefined {
    if (this.prefabs?.has(prefabId)) return this.prefabs.spawn(prefabId, position, undefined, skinId);
    const spawn = this.spawners.get(prefabId);
    if (!spawn) throw new Error(`No SpawnPrefab registered for ${prefabId}`);
    const spawned = spawn(position, skinId);
    return spawned instanceof PrefabInstance ? spawned : spawned && prefabInstance(spawned);
  }

  async spawn(prefabId: string): Promise<boolean> {
    // this.assertActive();
    const create = this.creators.get(prefabId);
    if (!create) return false;
    await create();
    // this.assertActive();
    return true;
  }

  async restoreAll(entities: Readonly<Record<string, readonly SavedEntity[]>>): Promise<void> {
    this.assertActive();
    const ids = new Set(this.byEntityId.keys());
    // Validate the entire batch before adding any models to the scene.
    for (const [_prefabId, records] of Object.entries(entities)) {
      for (const record of records) {
        ids.add(record.id);
      }
    }
    for (const [prefabId, records] of Object.entries(entities)) {
      for (const record of records) {
        const entity = await this.restorers.get(prefabId)!(record);
        this.assertActive();
        this.byEntityId.set(record.id, entity);
      }
    }
  }

  exportRecords(): Record<string, SavedEntity[]> {
    this.assertActive();
    const entities: Record<string, SavedEntity[]> = {};
    const ids = new Set<string>();
    for (const registration of this.registrations) {
      for (const prefabId of registration.definition.prefabIds) entities[prefabId] ??= [];
      for (const { prefabId, record } of registration.exportRecords()) {
        if (!registration.definition.prefabIds.includes(prefabId)) throw new Error(`Unregistered exported prefab: ${prefabId}`);
        if (ids.has(record.id)) throw new Error(`Duplicate entity ID: ${record.id}`);
        ids.add(record.id);
        // Saves must not share mutable component state with live entities.
        (entities[prefabId] ??= []).push(structuredClone({
          ...record, transform: { ...record.transform, position: [...record.transform.position] },
        }) as SavedEntity);
      }
    }
    for (const { prefabId, record } of this.prefabs?.exportRecords() ?? []) {
      if (!this.restorers.has(prefabId)) throw new Error(`Unregistered exported prefab: ${prefabId}`);
      if (ids.has(record.id)) throw new Error(`Duplicate entity ID: ${record.id}`);
      ids.add(record.id);
      (entities[prefabId] ??= []).push(structuredClone(record) as SavedEntity);
    }
    return entities;
  }

  beforePhysics(dt: number): void {
    if (!this.disposed) for (const registration of this.registrations) registration.beforePhysics?.(dt);
  }

  /** Scene-owned animation ticks for prefab displays; each display leaves the set when it is removed. */
  trackDisplay(display: PrefabDisplay): void {
    if (this.disposed || display.isRemoved) return;
    this.displays.add(display);
    display.onDispose(() => this.displays.delete(display));
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    for (const registration of this.registrations) registration.update?.(dt, cameraQuaternion);
    this.prefabs?.update(dt, cameraQuaternion);
    for (const display of this.displays) display.update(dt, cameraQuaternion);
  }

  /** Every registration's entries, in one list that the next read refills. */
  get renderEntities(): readonly EntityRenderEntry[] {
    const entries = this.renderEntries;
    entries.length = 0;
    if (this.disposed) return entries;
    for (const registration of this.registrations) {
      const provided = registration.renderEntities?.();
      if (provided) for (let i = 0; i < provided.length; i++) entries.push(provided[i]);
    }
    if (this.prefabs) for (const entry of this.prefabs.renderEntities) entries.push(entry);
    return entries;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.byEntityId.clear();
    const errors: unknown[] = [];
    for (const registration of [...this.registrations].reverse()) {
      try { registration.dispose(); } catch (error) { errors.push(error); }
    }
    try { this.prefabs?.dispose(); } catch (error) { errors.push(error); }
    this.displays.clear();
    if (errors.length) throw new AggregateError(errors, 'Unable to dispose scene entities');
  }

  private assertActive(): void {
    // if (this.disposed) throw new Error('Entity registry has been disposed');
  }
}
