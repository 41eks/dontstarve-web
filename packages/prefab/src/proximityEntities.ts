import * as THREE from 'three';
import { disposeActionEntity } from './actionEntity';
import { registerPlacementTree, syncPlacementEntity } from './placementEntities';

export interface ProximityEntity {
  readonly id: number;
  readonly saveId?: string;
  /** Ground-contact position; retained even while the entity is unloaded. */
  readonly position: THREE.Vector3;
  model?: THREE.Group;
}

/** Keeps only nearby entity models alive, using their ground-contact positions. */
export class ProximityEntities {
  readonly group = new THREE.Group();
  private readonly entityList: ProximityEntity[];
  private nextId: number;
  private readonly loaded = new Set<ProximityEntity>();
  private readonly placementStops = new Map<ProximityEntity, () => void>();
  private readonly placement?: { prefab: string; smartRadius: number };
  private readonly radiusSquared: number;
  private readonly createModel: (entity: ProximityEntity) => THREE.Group;
  private readonly disposeModel: (model: THREE.Group) => void;

  constructor(
    positions: readonly THREE.Vector3[],
    radius: number,
    createModel: (entity: ProximityEntity) => THREE.Group,
    disposeModel: (model: THREE.Group) => void,
    entityIds?: readonly string[],
    placement?: { prefab: string; smartRadius: number },
  ) {
    if (!Number.isFinite(radius) || radius < 0) throw new Error('Invalid entity load radius');
    if (entityIds && (entityIds.length !== positions.length
      || new Set(entityIds).size !== entityIds.length
      || entityIds.some((id) => !id))) throw new Error('Invalid persistent entity IDs');
    this.entityList = positions.map((position, id) => ({
      id, position, ...(entityIds ? { saveId: entityIds[id] } : {}),
    }));
    this.nextId = this.entityList.length;
    this.radiusSquared = radius * radius;
    this.createModel = createModel;
    this.disposeModel = disposeModel;
    this.placement = placement;
    for (const entity of this.entityList) this.trackPlacement(entity);
  }

  get entities(): readonly ProximityEntity[] { return this.entityList; }

  get activeEntities(): ReadonlySet<ProximityEntity> {
    return this.loaded;
  }

  add(position: THREE.Vector3, saveId: string): ProximityEntity {
    if (this.entityList.some(entity => entity.saveId === saveId)) throw new Error(`Duplicate entity ID: ${saveId}`);
    const entity = { id: this.nextId++, saveId, position: position.clone() };
    this.entityList.push(entity);
    this.trackPlacement(entity);
    return entity;
  }

  /** Permanently remove the logical entity as well as its loaded model. */
  remove(entity: ProximityEntity): boolean {
    const index = this.entityList.indexOf(entity);
    if (index < 0) return false;
    if (entity.model) this.unload(entity);
    this.placementStops.get(entity)?.(); this.placementStops.delete(entity);
    this.entityList.splice(index, 1);
    return true;
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
      if (this.placement) { model.userData.placementLogical = true; syncPlacementEntity(model); }
      entity.model = model;
      this.group.add(model);
      this.loaded.add(entity);
    }
  }

  dispose(): void {
    for (const entity of this.loaded) this.unload(entity);
    this.group.removeFromParent();
    for (const stop of this.placementStops.values()) stop();
    this.placementStops.clear();
  }

  private trackPlacement(entity: ProximityEntity): void {
    if (this.placement) this.placementStops.set(entity,
      registerPlacementTree(this.group, entity, this.placement.prefab, this.placement.smartRadius));
  }

  private isNearby(entity: ProximityEntity, player: THREE.Vector3): boolean {
    return entity.position.distanceToSquared(player) <= this.radiusSquared;
  }

  private unload(entity: ProximityEntity): void {
    entity.model!.removeFromParent();
    this.disposeModel(entity.model!);
    disposeActionEntity(entity.model!);
    entity.model = undefined;
    this.loaded.delete(entity);
  }
}
