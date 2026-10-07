import type * as THREE from 'three';
import type { ProximityEntity } from '@dontstarve-web/prefab/proximityEntities';
import type { SavedEntity } from './save/types';
import type { PrefabDefinition } from './prefabDefinitions';

export interface EntityRenderEntry {
  object: THREE.Object3D;
  footPosition: THREE.Vector3;
  cameraDepth: number;
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
  restore?: (prefabId: PrefabId, record: SavedEntity) => Promise<THREE.Object3D | ProximityEntity> | THREE.Object3D | ProximityEntity;
  /** Only these IDs are exposed through c_spawn, including any aliases. */
  debugSpawn?: (prefabId: PrefabId) => Promise<unknown>;
  exportRecords: () => readonly EntityRecord[];
  beforePhysics?: (dt: number) => void;
  update?: (dt: number, cameraQuaternion: THREE.Quaternion) => void;
  renderEntities?: () => readonly EntityRenderEntry[];
  dispose: () => void;
}

/** Routes scene lifecycles through the same declarations used by debug spawning. */
export class EntityRegistry {
  readonly byEntityId = new Map<string, THREE.Object3D | ProximityEntity>();
  private readonly restorers = new Map<string, (record: SavedEntity) => ReturnType<NonNullable<EntityRegistration<string>['restore']>>>();
  private readonly creators = new Map<string, () => Promise<unknown>>();
  private readonly registrations: (EntityRegistration<string> & { definition: PrefabDefinition })[] = [];
  private disposed = false;

  register<PrefabId extends string>(definition: PrefabDefinition<PrefabId>, registration: EntityRegistration<PrefabId>): void {
    this.assertActive();
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
    // Prefab IDs have been bound above; lifecycle callbacks no longer accept IDs.
    this.registrations.push({ ...registration, definition, restore: undefined, debugSpawn: undefined });
  }

  get prefabDefinitions(): readonly PrefabDefinition[] {
    return this.registrations.map(({ definition }) => definition);
  }

  /** Fail during setup if the shared catalog has an unbound scene family. */
  assertDefinitions(definitions: readonly PrefabDefinition[]): void {
    this.assertActive();
    const bound = new Set(this.prefabDefinitions);
    for (const definition of definitions) {
      if (!bound.has(definition)) throw new Error(`Unbound prefab definition: ${definition.prefabIds.join(', ') || 'transient effects'}`);
    }
  }

  async spawn(prefabId: string): Promise<boolean> {
    this.assertActive();
    const create = this.creators.get(prefabId);
    if (!create) return false;
    await create();
    this.assertActive();
    return true;
  }

  async restoreAll(entities: Readonly<Record<string, readonly SavedEntity[]>>): Promise<void> {
    this.assertActive();
    const ids = new Set(this.byEntityId.keys());
    // Validate the entire batch before adding any models to the scene.
    for (const [prefabId, records] of Object.entries(entities)) {
      if (!this.restorers.has(prefabId)) throw new Error(`Unregistered saved prefab: ${prefabId}`);
      for (const record of records) {
        if (ids.has(record.id)) throw new Error(`Duplicate entity ID: ${record.id}`);
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
    return entities;
  }

  beforePhysics(dt: number): void {
    if (!this.disposed) for (const registration of this.registrations) registration.beforePhysics?.(dt);
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    if (!this.disposed) for (const registration of this.registrations) registration.update?.(dt, cameraQuaternion);
  }

  get renderEntities(): readonly EntityRenderEntry[] {
    return this.disposed ? [] : this.registrations.flatMap((registration) => registration.renderEntities?.() ?? []);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.byEntityId.clear();
    const errors: unknown[] = [];
    for (const registration of [...this.registrations].reverse()) {
      try { registration.dispose(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Unable to dispose scene entities');
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Entity registry has been disposed');
  }
}
