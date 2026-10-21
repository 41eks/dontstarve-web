import * as THREE from 'three';
import { disposeActionEntity } from './actionEntity';
import { registerPlacementTree, syncPlacementEntity } from './placementEntities';
import { watchSignal, type Signal, type TileStateQuery } from '@dontstarve-web/signals';
import { TileTracker } from '../../componets/src/tileManager';

export interface ProximityEntity {
  readonly id: number;
  readonly saveId?: string;
  /** Ground-contact position; retained even while the entity is unloaded. */
  readonly position: THREE.Vector3;
  model?: THREE.Group;
}

/**
 * Keeps only active entity models alive. Once `bindTickingarea` supplies the world's tile query, an entity is
 * active exactly when its own tile is in the tickingarea; before that, no entity is active.
 */
export class ProximityEntities {
  readonly group = new THREE.Group();
  private readonly entityList: ProximityEntity[];
  private nextId: number;
  private readonly loaded = new Set<ProximityEntity>();
  private readonly placementStops = new Map<ProximityEntity, () => void>();
  private readonly placement?: { prefab: string; smartRadius: number };
  private readonly areas = new Map<ProximityEntity, { active?: Signal<boolean>; stop(): void }>();
  private tickingarea?: TileStateQuery;
  private readonly createModel: (entity: ProximityEntity) => THREE.Group;
  private readonly disposeModel: (model: THREE.Group) => void;

  constructor(
    positions: readonly THREE.Vector3[],
    createModel: (entity: ProximityEntity) => THREE.Group,
    disposeModel: (model: THREE.Group) => void,
    entityIds?: readonly string[],
    placement?: { prefab: string; smartRadius: number },
  ) {
    if (entityIds && (entityIds.length !== positions.length
      || new Set(entityIds).size !== entityIds.length
      || entityIds.some((id) => !id))) throw new Error('Invalid persistent entity IDs');
    this.entityList = positions.map((position, id) => ({
      id, position, ...(entityIds ? { saveId: entityIds[id] } : {}),
    }));
    this.nextId = this.entityList.length;
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
    this.trackArea(entity);
    return entity;
  }

  /**
   * Gate models by the world's tickingarea instead of player distance. Each entity keeps a private tile
   * tracker at its fixed foot point and a watched view of the shared area memo; the returned function
   * releases them and leaves every entity inactive. A query that returns `undefined` leaves the entity active.
   */
  bindTickingarea(query: TileStateQuery): () => void {
    this.releaseAreas();
    this.tickingarea = query;
    for (const entity of this.entityList) this.trackArea(entity);
    return () => {
      if (this.tickingarea !== query) return;
      this.releaseAreas();
      this.tickingarea = undefined;
    };
  }

  /** Permanently remove the logical entity as well as its loaded model. */
  remove(entity: ProximityEntity): boolean {
    const index = this.entityList.indexOf(entity);
    if (index < 0) return false;
    if (entity.model) this.unload(entity);
    this.placementStops.get(entity)?.(); this.placementStops.delete(entity);
    this.areas.get(entity)?.stop(); this.areas.delete(entity);
    this.entityList.splice(index, 1);
    return true;
  }

  update(): void {
    // Release departing models before creating incoming ones.
    for (const entity of this.loaded) {
      if (!this.isActive(entity)) this.unload(entity);
    }
    for (const entity of this.entities) {
      if (entity.model || !this.isActive(entity)) continue;
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
    this.releaseAreas();
    for (const stop of this.placementStops.values()) stop();
    this.placementStops.clear();
  }

  private trackPlacement(entity: ProximityEntity): void {
    if (this.placement) this.placementStops.set(entity,
      registerPlacementTree(this.group, entity, this.placement.prefab, this.placement.smartRadius));
  }

  private trackArea(entity: ProximityEntity): void {
    const query = this.tickingarea;
    if (!query) return;
    const tracker = new TileTracker(() => entity.position);
    const area = query(tracker.tile);
    if (!area) { this.areas.set(entity, { stop() {} }); return; }
    let stop = () => {};
    const active = watchSignal(area, cleanup => { stop = () => { cleanup(); area.dispose(); }; });
    this.areas.set(entity, { active, stop });
  }

  private releaseAreas(): void {
    for (const { stop } of this.areas.values()) stop();
    this.areas.clear();
  }

  private isActive(entity: ProximityEntity): boolean {
    return this.tickingarea !== undefined && (this.areas.get(entity)?.active?.peek() ?? true);
  }

  private unload(entity: ProximityEntity): void {
    entity.model!.removeFromParent();
    this.disposeModel(entity.model!);
    disposeActionEntity(entity.model!);
    entity.model = undefined;
    this.loaded.delete(entity);
  }
}
