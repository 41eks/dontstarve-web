import type * as THREE from 'three';
import type { ProximityEntity } from '@three-roaming/prefab/proximityEntities';
import type { SavedEntity } from './save/types';

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
  /** Saved prefab IDs. Transient effects use an empty list. */
  prefabIds: readonly PrefabId[];
  restore?: (prefabId: PrefabId, record: SavedEntity) => Promise<THREE.Object3D | ProximityEntity> | THREE.Object3D | ProximityEntity;
  /** Only these IDs are exposed through c_spawn, including any aliases. */
  debugSpawn?: { prefabIds: readonly PrefabId[]; create: (prefabId: PrefabId) => Promise<unknown> };
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
  private readonly registrations: EntityRegistration<string>[] = [];
  private disposed = false;

  register<PrefabId extends string>(registration: EntityRegistration<PrefabId>): void {
    this.assertActive();
    const savedIds = registration.prefabIds;
    const debugIds = registration.debugSpawn?.prefabIds ?? [];
    if (savedIds.length && !registration.restore) throw new Error('Persistent entities require a restore handler');
    if (new Set(savedIds).size !== savedIds.length || new Set(debugIds).size !== debugIds.length
      || savedIds.some((id) => this.restorers.has(id)) || debugIds.some((id) => this.creators.has(id))) {
      throw new Error('Duplicate entity registration');
    }
    for (const id of savedIds) this.restorers.set(id, (record) => registration.restore!(id, record));
    for (const id of debugIds) this.creators.set(id, () => registration.debugSpawn!.create(id));
    // Prefab IDs have been bound above; lifecycle callbacks no longer accept IDs.
    this.registrations.push({ ...registration, restore: undefined, debugSpawn: undefined });
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
      for (const prefabId of registration.prefabIds) entities[prefabId] ??= [];
      for (const { prefabId, record } of registration.exportRecords()) {
        if (!registration.prefabIds.includes(prefabId)) throw new Error(`Unregistered exported prefab: ${prefabId}`);
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
