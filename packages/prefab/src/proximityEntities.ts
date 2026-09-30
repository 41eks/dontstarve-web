import * as THREE from 'three';

export interface ProximityEntity {
  readonly id: number;
  readonly saveId?: string;
  /** Ground-contact position; retained even while the entity is unloaded. */
  readonly position: THREE.Vector3;
  model?: THREE.Group;
}

/** Keeps only nearby entity models alive. Distance is measured on the XZ plane. */
export class ProximityEntities {
  readonly group = new THREE.Group();
  readonly entities: readonly ProximityEntity[];
  private readonly loaded = new Set<ProximityEntity>();
  private readonly radiusSquared: number;
  private readonly createModel: (entity: ProximityEntity) => THREE.Group;
  private readonly disposeModel: (model: THREE.Group) => void;

  constructor(
    positions: readonly THREE.Vector3[],
    radius: number,
    createModel: (entity: ProximityEntity) => THREE.Group,
    disposeModel: (model: THREE.Group) => void,
    entityIds?: readonly string[],
  ) {
    if (!Number.isFinite(radius) || radius < 0) throw new Error('Invalid entity load radius');
    if (entityIds && (entityIds.length !== positions.length
      || new Set(entityIds).size !== entityIds.length
      || entityIds.some((id) => !id))) throw new Error('Invalid persistent entity IDs');
    this.entities = positions.map((position, id) => ({
      id, position, ...(entityIds ? { saveId: entityIds[id] } : {}),
    }));
    this.radiusSquared = radius * radius;
    this.createModel = createModel;
    this.disposeModel = disposeModel;
  }

  get activeEntities(): ReadonlySet<ProximityEntity> {
    return this.loaded;
  }

  update(playerPosition: THREE.Vector3): void {
    // Release departing models before creating incoming ones.
    for (const entity of this.loaded) {
      if (!this.isNearby(entity, playerPosition)) this.unload(entity);
    }
    for (const entity of this.entities) {
      if (entity.model || !this.isNearby(entity, playerPosition)) continue;
      const model = this.createModel(entity);
      model.position.copy(entity.position);
      entity.model = model;
      this.group.add(model);
      this.loaded.add(entity);
    }
  }

  dispose(): void {
    for (const entity of this.loaded) this.unload(entity);
    this.group.removeFromParent();
  }

  private isNearby(entity: ProximityEntity, player: THREE.Vector3): boolean {
    const dx = entity.position.x - player.x;
    const dz = entity.position.z - player.z;
    return dx * dx + dz * dz <= this.radiusSquared;
  }

  private unload(entity: ProximityEntity): void {
    entity.model!.removeFromParent();
    this.disposeModel(entity.model!);
    entity.model = undefined;
    this.loaded.delete(entity);
  }
}
