import { syncPlacementEntity } from '../packages/prefab/src/placementEntities';
import { modelValues } from '../packages/prefab/src/modelRecords';
import { ItemEntity, ItemEntityRegistry, type InventoryStore } from '@dontstarve-web/inventory';
import type { PickupTarget } from '@dontstarve-web/stategraphs';
import type { PlayerActionPicker } from '@dontstarve-web/stategraphs';
import { loadImageAtlas, type ImageAtlas } from '@dontstarve-web/animation/imageAtlas';
import * as THREE from 'three';
import { isSpriteEntityRendered, registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import { isHatId, HAT_DEFINITIONS } from '@dontstarve-web/prefab/hats';
import { nextReskin } from '@dontstarve-web/prefab/reskin_tool';
import { type ReskinFxMessage, type ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { GROUND_ITEM_DEFINITIONS } from '@dontstarve-web/prefab/groundItems';
import { newEntityId } from '@dontstarve-web/prefab/saveRecord';
import type { BernieWorld } from '@dontstarve-web/prefab/bernie';
import type { ButterflyWorld } from '@dontstarve-web/prefab/butterfly';
import { GroundPrefabRegistry } from '@dontstarve-web/prefab/groundPrefabRegistry';
import type { GroundItemDefinition, GroundItemVisual, GroundPrefabOptions } from '@dontstarve-web/prefab/groundPrefab';
import type { NetCaptureTarget } from '@dontstarve-web/stategraphs/bugnet';
import type { FirefliesWorld } from '@dontstarve-web/prefab/fireflies';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import { isPlayerNearby } from '@dontstarve-web/prefab/playerProximity';
import { LootFling, type LootLaunch } from '@dontstarve-web/prefab/lootFling';
import { PHONOGRAPH_ID, PhonographController } from '@dontstarve-web/prefab/phonograph';
import { RECORD_ID, RECORD_SONGS, isPhonographRecord } from '@dontstarve-web/prefab/records';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import type { SavedEntity } from './save/types';
import { performToolWork } from '../packages/stategraphs/src/componentactions';
import { actionEntity, disposeActionEntity } from '../packages/prefab/src/actionEntity';
import type { GameTimeScheduler } from '../packages/componets/src/gameTimeScheduler';
import type { DeconstructionTarget, DeconstructionLoot, PreparedDeconstruction } from '@dontstarve-web/prefab/greenstaff';
import type { MiniMapEntity } from '@dontstarve-web/prefab/minimapEntity';
import type { WorldEventEmitter } from '../packages/prefab/src/worldContext';
import { createEffect, watchSignal, WorldContentKey, type GetWatchWorldContent, type Signal } from '@dontstarve-web/signals';

export interface PreparedDrop {
  /** Takes the item from the inventory and places it; false (and disposes the art) when the take fails. */
  commit(position: THREE.Vector3, takeFromInventory: () => boolean | ItemEntity): boolean;
  dispose(): void;
}
export type { GroundItemDefinition } from '@dontstarve-web/prefab/groundPrefab';

const DEFAULT_ATLAS = 'images/inventoryimages.xml';
const ITEM_HEIGHT = 4;

interface GroundItemRecord extends GroundItemVisual {
  id: string;
  entity: ItemEntity;
  definition: GroundItemDefinition;
  readonly footPosition: THREE.Vector3;
  fling?: LootFling;
  stopInventoryEvents?: () => void;
  stopActivity?: () => void;
  /** Cleanups of the record's private watched signals (updating flag, entity removal). */
  readonly stops: (() => void)[];
}

export class GroundItemManager {
  /** Logical item icons survive visual replacement; owned/picked-up items are
   * hidden by inventoryitem and leave the ground-item collection.
   */
  get miniMapEntities(): readonly MiniMapEntity[] {
    return this.disposed ? [] : this.entities.miniMapEntities;
  }
  readonly entities: ItemEntityRegistry;
  private readonly atlasRequests = new Map<string, Promise<ImageAtlas>>();
  private readonly archiveUrl: string;
  private readonly prefabs: GroundPrefabRegistry;
  private readonly items = new Map<THREE.Group, GroundItemRecord>();
  private readonly groundEntitiesByPrefab = new Map<string, Set<ItemEntity>>();
  private readonly groundEntityStops = new Map<ItemEntity, () => void>();
  /** Reservations exist only while spawn art loads; committed entities replace them synchronously. */
  private readonly pendingSpawnPositions = new Map<string, Map<string, { position: THREE.Vector3 }>>();
  private readonly activeItems = new Set<GroundItemRecord>();
  /** Billboard sort entries reused across frames; the scene rewrites each entry's depth every frame. */
  private readonly renderEntryByRecord = new WeakMap<GroundItemRecord, { readonly object: THREE.Group; readonly footPosition: THREE.Vector3; cameraDepth: number }>();
  /** StartUpdatingComponent/StopUpdatingComponent: only these records are visited each frame. */
  private readonly updatingItems = new Set<GroundItemRecord>();
  private readonly inventory: InventoryStore;
  private readonly stopDrops: () => void;
  private readonly stopSpawnAsh?: () => void;
  private readonly pendingDrops = new Map<string, { entity: ItemEntity; definition: GroundItemDefinition }>();
  private onNetCapture?: (target: NetCaptureTarget) => boolean;
  private readonly pointer: PointerRaycaster;
  private readonly mouseActions?: PlayerActionPicker;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly player: THREE.Object3D;
  private disposed = false;
  /** Private view of the world camera rotation; undefined for standalone managers, which orient in update(). */
  private readonly cameraRotation?: Signal<THREE.Quaternion>;
  private readonly cleanups: (() => void)[] = [];
  private readonly inserting = new Set<GroundItemRecord>();
  private recordSource?: () => { entity: ItemEntity; take(): boolean } | undefined;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    archiveUrl: string,
    inventory: InventoryStore,
    animationBaseUrl: string,
    player: THREE.Object3D,
    butterflyWorld: ButterflyWorld = { getThreatPositions: () => [], getFlowers: () => [] },
    firefliesWorld: FirefliesWorld = {},
    bernieWorld: BernieWorld = { getSanityPercent: () => 1 },
    entities = new ItemEntityRegistry(),
    scheduler?: GameTimeScheduler,
    fx?: GroundPrefabOptions['fx'],
    moleWorld?: GroundPrefabOptions['moleWorld'],
    worldEvents?: WorldEventEmitter,
    getWatchWorldContent?: GetWatchWorldContent,
    mouseActions?: PlayerActionPicker,
    lightflierWorld?: GroundPrefabOptions['lightflierWorld'],
    tickingarea?: GroundPrefabOptions['tickingarea'],
    physics?: GroundPrefabOptions['physics'],
  ) {
    this.mouseActions = mouseActions;
    this.entities = entities;
    this.scene = scene;
    this.renderer = renderer;
    this.pointer = new PointerRaycaster({ camera, renderer });
    this.archiveUrl = archiveUrl;
    this.inventory = inventory;
    this.player = player;
    this.prefabs = new GroundPrefabRegistry({
      scene, animationBaseUrl, scheduler, fx, moleWorld, lightflierWorld, tickingarea, physics, butterflyWorld, firefliesWorld, bernieWorld, inventoryOwnerPosition: player.position,
      handEquipment: inventory.handEquipment,
      dropLoot: (items, position) => this.flingLoot(items, position),
      prepareSpawn: definition => this.prepareSpawn(definition),
    });
    if (getWatchWorldContent) {
      const rotation = this.cameraRotation = getWatchWorldContent(WorldContentKey.CameraRotation, stop => this.cleanups.push(stop));
      // Billboards face the camera: re-orient them only when the camera turns.
      createEffect(() => {
        const quaternion = rotation.get();
        for (const { model } of this.activeItems) model.quaternion.copy(quaternion);
      });
    }
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.stopDrops = inventory.subscribeDropped((entity, launch) => this.onInventoryDrop(entity, launch));
    // DefaultBurntFn requests one ash at the burnt inst's ground position.
    this.stopSpawnAsh = worldEvents?.on('spawnAsh', position => {
      void this.spawnFromSave(newEntityId(), { ...inventory.getItemSpec('ash'), itemId: 'ash', count: 1 }, position.clone())
        .catch((error: unknown) => console.error('Unable to spawn ash', error));
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopSpawnAsh?.();
    this.cleanups.splice(0).forEach(stop => stop());
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.pointer.dispose();
    this.stopDrops();
    for (const item of [...this.items.values()]) { this.removeVisual(item); this.entities.destroy(item.entity); }
    for (const { entity } of this.pendingDrops.values()) this.entities.destroy(entity);
    this.pendingDrops.clear();
    for (const stop of this.groundEntityStops.values()) stop();
    this.groundEntityStops.clear();
    this.groundEntitiesByPrefab.clear();
    this.pendingSpawnPositions.clear();
    this.items.clear();
    this.activeItems.clear();
    this.updatingItems.clear();
    this.atlasRequests.clear();
    this.prefabs.dispose();
  }

  /** Loads the drop art ahead of time; commit() then takes the item and places it synchronously. */
  async prepareDrop(definition: GroundItemDefinition): Promise<PreparedDrop> {
    const visuals = await this.createDropVisuals(definition);
    let done = false;
    const dispose = () => { if (!done) { done = true; visuals.forEach((visual) => visual.dispose()); } };
    return {
      dispose,
      commit: (position, takeFromInventory) => {
        if (done) return false;
        if (this.disposed) { dispose(); return false; }
        let taken: boolean | ItemEntity;
        try {
          taken = takeFromInventory();
        } catch (error) {
          dispose();
          throw error;
        }
        if (!taken) { dispose(); return false; }
        done = true;
        if (taken instanceof ItemEntity) {
          const state = taken.snapshot();
          for (const [index, visual] of visuals.entries()) {
            const count = visuals.length === 1 ? state.count : 1;
            const entity = index === 0 ? taken : this.entities.create({ ...state, entityId: undefined, count });
            if (index === 0 && visuals.length > 1) entity.apply({ ...state, count });
            this.addVisual(entity.id, { ...definition, ...entity.snapshot(), entity }, position, visual, true);
          }
        } else {
          for (const visual of visuals) this.addVisual(newEntityId(), this.singleDropDefinition(definition), position, visual, true);
        }
        return true;
      },
    };
  }

  async drop(
    definition: GroundItemDefinition,
    position: THREE.Vector3,
    takeFromInventory: () => boolean | ItemEntity,
  ): Promise<boolean> {
    return (await this.prepareDrop(definition)).commit(position, takeFromInventory);
  }

  /** DropLoot spawns each recipe ingredient separately, then FlingItem launches it. */
  async flingLoot(definitions: readonly GroundItemDefinition[], position: THREE.Vector3, launch?: () => LootLaunch): Promise<void> {
    if (this.disposed) throw new Error('Ground items have been disposed');
    const origin = position.clone();
    const pieces = definitions.flatMap((definition) => {
      if (!Number.isSafeInteger(definition.count) || definition.count < 1) throw new RangeError('Invalid loot count');
      return Array.from({ length: definition.count }, () => ({ ...definition, count: 1 }));
    });
    // Prepare every piece before launching, so asynchronous asset loads cannot
    // stagger one building's scatter or leave a partially spawned batch.
    const results = await Promise.allSettled(pieces.map((definition) => this.createVisual(definition)));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed || this.disposed) {
      for (const result of results) if (result.status === 'fulfilled') result.value.dispose();
      if (failed?.status === 'rejected') throw failed.reason;
      throw new Error('Ground items have been disposed');
    }
    for (const [index, result] of results.entries()) {
      if (result.status !== 'fulfilled') continue;
      this.addFlungVisual(pieces[index], origin, result.value, launch?.());
    }
  }

  /** Restores an item without removing anything from inventory or playing pickup. */
  async spawnFromSave(
    id: string,
    definition: GroundItemDefinition,
    position: THREE.Vector3,
  ): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Ground items have been disposed');
    if (!Number.isSafeInteger(definition.count) || definition.count < 1) throw new RangeError('Invalid ground item count');
    const ids = Array.from({ length: this.isNetCreature(definition.itemId) ? definition.count : 1 },
      (_, index) => index === 0 ? id : newEntityId());
    const stops = ids.map(id => this.reserveSpawnPosition(definition.itemId, id, position));
    try {
      const visuals = await this.createDropVisuals(definition);
      visuals.forEach((visual, index) => this.addVisual(ids[index],
        this.singleDropDefinition(definition), position, visual));
      return visuals[0].model;
    } finally { stops.forEach(stop => stop()); }
  }

  private reserveSpawnPosition(prefab: string, id: string, position: THREE.Vector3): () => void {
    let pending = this.pendingSpawnPositions.get(prefab);
    if (!pending) this.pendingSpawnPositions.set(prefab, pending = new Map());
    const reservation = { position };
    pending.set(id, reservation);
    return () => {
      if (pending.get(id) !== reservation) return;
      pending.delete(id);
      if (pending.size === 0) this.pendingSpawnPositions.delete(prefab);
    };
  }

  private trackGroundEntity(entity: ItemEntity): void {
    const pending = this.pendingSpawnPositions.get(entity.prefab);
    pending?.delete(entity.id);
    if (pending?.size === 0) this.pendingSpawnPositions.delete(entity.prefab);
    if (this.groundEntityStops.has(entity) || entity.isRemoved || entity.components.inventoryitem.owner) return;
    let entities = this.groundEntitiesByPrefab.get(entity.prefab);
    if (!entities) this.groundEntitiesByPrefab.set(entity.prefab, entities = new Set());
    entities.add(entity);
    const remove = () => {
      entities.delete(entity);
      if (entities.size === 0) this.groundEntitiesByPrefab.delete(entity.prefab);
      this.pendingDrops.delete(entity.id);
      this.groundEntityStops.get(entity)?.();
      this.groundEntityStops.delete(entity);
    };
    const stopPickup = entity.ListenForEvent('onputininventory', remove);
    const stopRemoval = entity.ListenForEvent('onremove', remove);
    this.groundEntityStops.set(entity, () => { stopPickup(); stopRemoval(); });
  }

  /** Logical ground positions, including pending drops/spawns; no snapshots, art queries or unrelated prefabs. */
  *iteratePrefabPositions(prefab: string): IterableIterator<THREE.Vector3> {
    if (this.disposed) return;
    for (const entity of this.groundEntitiesByPrefab.get(prefab) ?? []) {
      if (!entity.isRemoved && !entity.components.inventoryitem.owner && !entity.hasTag('INLIMBO')) {
        yield entity.transform.position;
      }
    }
    for (const { position } of this.pendingSpawnPositions.get(prefab)?.values() ?? []) yield position;
  }

  private singleDropDefinition(definition: GroundItemDefinition): GroundItemDefinition {
    return { ...definition, count: this.isNetCreature(definition.itemId) ? 1 : definition.count };
  }

  /** Prepare art before a timed action; committing a spawned stack is synchronous. */
  spawnPreparedEntity(entity: ItemEntity, position: THREE.Vector3): void {
    if (this.disposed || entity.isRemoved) throw new Error('Cannot place removed ground entity');
    const definition = { ...this.inventory.getItemSpec(entity.prefab), ...entity.snapshot(), entity };
    const factory = this.prefabs.get(entity.prefab);
    if (!factory?.createPrepared) throw new Error(`Ground art was not prepared for ${entity.prefab}`);
    const visual = factory.createPrepared(definition);
    try { this.addVisual(entity.id, definition, position, visual); }
    catch (error) { visual.dispose(); throw error; }
  }

  // fling=true uses lootdropper.lua's FlingItem scatter; false places a normal dropped stack.
  async prepareSpawn(definition: GroundItemDefinition, fling = false): Promise<import('@dontstarve-web/prefab/groundPrefab').PreparedGroundSpawn> {
    const visuals = await this.createDropVisuals(definition);
    let released = false;
    let spawnedEntity: ItemEntity | undefined;
    return {
      get spawnedEntity() { return spawnedEntity; },
      spawn: (position, count = definition.count, launch) => {
        if (released || this.disposed || !Number.isSafeInteger(count) || count <= 0 || count > definition.count) return false;
        released = true;
        const used = this.isNetCreature(definition.itemId) ? count : 1;
        visuals.slice(0, used).forEach(visual => {
          const item = this.singleDropDefinition({ ...definition, count });
          if (fling || launch) this.addFlungVisual(item, position, visual, launch);
          else this.addVisual(newEntityId(), item, position, visual, true);
          spawnedEntity ??= this.items.get(visual.model)?.entity;
        });
        visuals.slice(used).forEach(visual => visual.dispose());
        return true;
      },
      dispose: () => {
        if (released) return;
        released = true;
        visuals.forEach(visual => visual.dispose());
      },
    };
  }

  /** Prepare individual source loot pieces; the action's impact only mutates live entities. */
  async prepareLoot(items: readonly DeconstructionLoot[]): Promise<PreparedDeconstruction> {
    const pieces = items.flatMap(({ itemId, count }) => Array.from({ length: count }, () => ({
      ...this.inventory.getItemSpec(itemId), itemId, count: 1,
    })));
    const results = await Promise.allSettled(pieces.map(item => this.createVisual(item)));
    const failure = results.find(result => result.status === 'rejected');
    const visuals = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    if (failure || this.disposed) {
      visuals.forEach(visual => visual.dispose());
      throw failure?.status === 'rejected' ? failure.reason : new Error('Ground items have been disposed');
    }
    let released = false;
    return {
      spawn: (loot, position) => {
        if (released || this.disposed) return false;
        const wanted = new Map(loot.map(item => [item.itemId, item.count]));
        for (const [itemId, count] of wanted) {
          if (count > pieces.filter(piece => piece.itemId === itemId).length) return false;
        }
        released = true;
        for (const [index, piece] of pieces.entries()) {
          const remaining = wanted.get(piece.itemId) ?? 0;
          if (remaining > 0) {
            this.addFlungVisual(piece, position, visuals[index]);
            wanted.set(piece.itemId, remaining - 1);
          } else visuals[index].dispose();
        }
        return true;
      },
      dispose: () => { if (!released) { released = true; visuals.forEach(visual => visual.dispose()); } },
    };
  }
  get spellTargets(): readonly DeconstructionTarget[] { return this.getSpellTargets(); }

  getSpellTargets(model?: THREE.Object3D): readonly DeconstructionTarget[] {
    return modelValues(this.items, model, this.activeItems).map(record => {
      const entity = record.entity;
      const isValid = () => !this.disposed && this.activeItems.has(record) && !entity.isRemoved
        && !entity.components.inventoryitem.owner && record.isClickable?.() !== false && !record.isRemoved?.();
      return {
        prefab: entity.prefab, model: record.model, components: entity.components,
        get position() { return record.footPosition; }, get isRemoved() { return !isValid(); }, isValid,
        isVisible: () => record.model.visible,
        hasTag: (tag: string) => entity.hasTag(tag) || (record.model.userData.tags?.includes(tag) ?? false), flush: () => entity.flush(),
        PushEvent: (name: string, data: unknown) => entity.PushEvent(name, data),
        removeOne: () => {
          if (!isValid()) return false;
          if (entity.components.stackable.count > 1) { entity.components.stackable.count--; return true; }
          return entity.remove();
        },
      };
    });
  }

  private async createDropVisuals(definition: GroundItemDefinition): Promise<GroundItemVisual[]> {
    if (this.disposed) throw new Error('Ground items have been disposed');
    if (!Number.isSafeInteger(definition.count) || definition.count < 1) throw new RangeError('Invalid ground item count');
    const count = this.isNetCreature(definition.itemId) ? definition.count : 1;
    const visuals: GroundItemVisual[] = [];
    try {
      // Live insects force individual drops from a stack.
      for (let index = 0; index < count; index++) visuals.push(await this.createVisual(this.singleDropDefinition(definition)));
      if (this.disposed) throw new Error('Ground items have been disposed');
      return visuals;
    } catch (error) {
      visuals.forEach((visual) => visual.dispose());
      throw error;
    }
  }

  private addVisual(id: string, definition: GroundItemDefinition, position: THREE.Vector3, visual: GroundItemVisual, dropped = false): void {
    const entity = definition.entity ?? (definition.entityId ? this.entities.get(definition.entityId) : undefined)
      ?? this.entities.create({ ...definition, entityId: id });
    this.entities.adopt(entity);
    this.pendingDrops.delete(entity.id);
    this.inventory.configureItem(entity);
    this.prefabs.get(entity.prefab)?.configureEntity?.(entity);
    definition = { ...definition, ...entity.snapshot(), entity };
    Object.assign(visual.model.userData, { itemId: entity.prefab, skinId: entity.skinId, count: entity.components.stackable.count });
    id = entity.id;
    entity.transform.position.set(position.x, dropped ? 0 : position.y, position.z);
    this.trackGroundEntity(entity);
    visual.bindTransform?.(entity.transform);
    visual.model.position.copy(entity.transform.position);
    visual.model.userData.entityId = id;
    visual.setDefinition?.(definition);
    visual.bindEntity?.(entity);
    const record = this.withFootPosition({ id, entity, definition, stops: [], ...visual });
    this.items.set(visual.model, record);
    this.bindInventoryEvents(record);
    this.bindVisualActivity(record);
    this.bindVisualUpdating(record);
    this.bindEntityRemoval(record);
    visual.model.dispatchEvent({ type: dropped ? 'ondropped' : 'onload' });
  }

  private removeVisual(record: GroundItemRecord): void {
    if (this.items.get(record.model) !== record) return;
    this.items.delete(record.model);
    this.activeItems.delete(record);
    this.updatingItems.delete(record);
    record.stops.splice(0).forEach(stop => stop());
    record.stopActivity?.();
    record.stopInventoryEvents?.();
    record.dispose();
    disposeActionEntity(record.model);
  }

  private bindVisualActivity(record: GroundItemRecord): void {
    const setActive = (active: boolean) => {
      if (active) {
        this.activeItems.add(record);
        this.refreshUpdating(record);
        record.model.position.copy(record.entity.transform.position);
        if (this.cameraRotation) record.model.quaternion.copy(this.cameraRotation.peek());
        this.scene.add(record.model);
      } else {
        this.activeItems.delete(record);
        this.updatingItems.delete(record);
        record.model.removeFromParent();
      }
    };
    record.stopActivity = undefined;
    if (!record.active) { setActive(true); return; }
    const active = watchSignal(record.active, stop => { record.stopActivity = stop; });
    createEffect(() => setActive(active.get()));
  }

  /** A visual joins the frame loop while it can change by itself: it has an update, a removal check or a fling. */
  private refreshUpdating(record: GroundItemRecord): void {
    const needed = this.activeItems.has(record) && (record.fling !== undefined
      || ((record.update !== undefined || record.isRemoved !== undefined) && (record.updating?.peek() ?? true)));
    if (needed) this.updatingItems.add(record); else this.updatingItems.delete(record);
  }

  private bindVisualUpdating(record: GroundItemRecord): void {
    if (!record.updating) return;
    const updating = watchSignal(record.updating, stop => record.stops.push(stop));
    createEffect(() => { updating.get(); this.refreshUpdating(record); });
  }

  /** Entity removal ends the record without waiting for a frame visit. */
  private bindEntityRemoval(record: GroundItemRecord): void {
    const removal = watchSignal(record.entity.removal, stop => record.stops.push(stop));
    createEffect(() => {
      if (!removal.get() || this.items.get(record.model) !== record) return;
      this.removeVisual(record);
      this.entities.destroy(record.entity);
    });
  }

  private bindInventoryEvents(record: GroundItemRecord): void {
    const { model, entity } = record;
    model.userData.components = entity.components;
    // Domain queries read the authoritative vector; presentation/pickup snapshots own their scratch vector.
    model.userData.getGroundPosition = () => entity.transform.position;
    actionEntity(model, entity.prefab, entity);
    model.userData.pickupTarget = {
      model, entity, get position() { return record.footPosition; },
      hasTag: (tag: string) => entity.hasTag(tag) || (model.userData.tags?.includes(tag) ?? false),
      isValid: () => !this.disposed && this.activeItems.has(record) && !entity.isRemoved
        && !entity.components.inventoryitem.owner && record.isClickable?.() !== false && !record.isRemoved?.()
        && !this.inserting.has(record),
    } satisfies PickupTarget;
    const stops = [
      entity.ListenForEvent('onputininventory', () => {
        model.dispatchEvent({ type: 'onputininventory' });
        this.removeVisual(record);
      }),
      entity.ListenForEvent('onremove', () => this.removeVisual(record)),
      entity.ListenForEvent('perished', () => { void this.replacePerished(record).catch((error: unknown) =>
        console.error(`Unable to replace perished ${entity.prefab}`, error)); }),
      // physics.lua LaunchAt: any inst may be thrown from its own position.
      entity.ListenForEvent('launch', launch => { record.fling = new LootFling(entity.transform, undefined, undefined, launch as LootLaunch); this.refreshUpdating(record); }),
      entity.ListenForEvent('ondropped', () => { record.fling = undefined; model.position.copy(entity.transform.position); syncPlacementEntity(model); model.dispatchEvent({ type: 'ondropped' }); }),
    ];
    record.stopInventoryEvents = () => stops.forEach(stop => stop());
    // An inst that perished between holders is replaced once it reaches the ground.
    if (entity.components.perishable.timer.peek().status === 'perished') entity.PushEvent('perished', undefined);
  }

  /** perishable.lua onperishreplacement for a world inst: same position and stack size. */
  private async replacePerished(record: GroundItemRecord): Promise<void> {
    const { entity } = record, prefab = entity.components.perishable.onperishreplacement;
    const holder = () => entity.components.inventoryitem.owner;
    if (prefab === undefined || holder()) return;
    const count = entity.components.stackable.count;
    const prepared = await this.prepareSpawn({ ...this.inventory.getItemSpec(prefab), itemId: prefab, count });
    if (this.disposed || entity.isRemoved) { prepared.dispose(); return; }
    // Picked up while the replacement art was loading: the holder replaces it in its slot.
    const owner = holder();
    if (owner) { prepared.dispose(); owner.replace(prefab); return; }
    if (this.items.get(record.model) !== record) { prepared.dispose(); return; }
    const position = record.footPosition.clone();
    entity.remove();
    if (!prepared.spawn(position, count)) prepared.dispose();
  }

  private onInventoryDrop(entity: ItemEntity, launch?: LootLaunch): void {
    if (this.disposed || this.groundEntityStops.has(entity)) return;
    // butterfly.lua OnDropped: a dropped stack of live insects splits into one entity per insect.
    const extra = this.isNetCreature(entity.prefab) ? entity.components.stackable.count - 1 : 0;
    if (extra > 0) {
      const rest = { ...this.inventory.getStackSpec(entity.snapshot()), ...entity.snapshot(false), itemId: entity.prefab, count: extra };
      entity.components.stackable.count = 1;
      const position = entity.transform.position.clone();
      void this.spawnFromSave(newEntityId(), rest, position)
        .catch((error: unknown) => console.error(`Unable to split dropped ${entity.prefab}`, error));
    }
    const definition = { ...this.inventory.getStackSpec(entity.snapshot()), ...entity.snapshot(), entity };
    const pending = { entity, definition };
    this.pendingDrops.set(entity.id, pending);
    this.trackGroundEntity(entity);
    void this.createVisual(definition).then(visual => {
      if (this.disposed || this.pendingDrops.get(entity.id) !== pending || entity.isRemoved || entity.components.inventoryitem.owner) {
        visual.dispose();
        if (this.pendingDrops.get(entity.id) === pending) this.pendingDrops.delete(entity.id);
        return;
      }
      this.pendingDrops.delete(entity.id);
      if (launch) this.addFlungVisual(definition, entity.transform.position.clone(), visual, launch);
      else this.addVisual(entity.id, definition, entity.transform.position.clone(), visual, true);
    }).catch((error: unknown) => console.error('Unable to render dropped item', error));
  }

  /** Adapt the authoritative tuple for consumers requiring a live Three.js foot point. */
  private withFootPosition(record: Omit<GroundItemRecord, 'footPosition'>): GroundItemRecord {
    const footPosition = new THREE.Vector3();
    return Object.defineProperty(record, 'footPosition', {
      enumerable: true,
      get: () => footPosition.copy(record.entity.transform.position),
    }) as GroundItemRecord;
  }

  private addFlungVisual(definition: GroundItemDefinition, origin: THREE.Vector3, visual: GroundItemVisual, launch?: LootLaunch): void {
    const entity = definition.entity ?? (definition.entityId ? this.entities.get(definition.entityId) : undefined)
      ?? this.entities.create({ ...definition, entityId: newEntityId() });
    entity.transform.position.copy(origin);
    const fling = new LootFling(entity.transform, undefined, undefined, launch);
    this.addVisual(entity.id, { ...definition, entity }, fling.position, visual, true);
    const flung = this.items.get(visual.model)!;
    flung.fling = fling;
    this.refreshUpdating(flung);
  }

  /** Component-driven ground work, including inventory prefabs such as hard stone fruit. */
  get mineTargets(): import('@dontstarve-web/stategraphs/pickaxe').PickaxeTarget[] { return this.getMineTargets(); }

  getMineTargets(model?: THREE.Object3D): import('@dontstarve-web/stategraphs/pickaxe').PickaxeTarget[] {
    return modelValues(this.items, model, this.activeItems).filter(({ entity }) => entity.components.workable?.GetWorkAction() === 'MINE'
      && entity.components.workable.CanBeWorked()).map(record => ({
      id: record.entity.id, model: record.model, position: record.footPosition,
      entity: actionEntity(record.model, record.entity.prefab, record.entity),
      isValid: () => this.activeItems.has(record) && !record.entity.isRemoved
        && record.entity.components.workable?.CanBeWorked() === true,
    }));
  }

  exportRecords(): SavedEntity[] {
    const pending = [...this.pendingDrops.values()].filter(({ entity }) => !entity.isRemoved && entity.persists && !entity.components.inventoryitem.owner)
      .map(({ entity }) => {
        const { entityId: _entityId, ...stack } = entity.snapshot();
        return { id: entity.id, transform: { position: entity.transform.position.toArray(), rotationY: 0 },
          components: { stack } };
      });
    return [...pending, ...[...this.items.values()].flatMap<SavedEntity>((record) => {
      const { id } = record;
      const definition = this.currentDefinition(record);
      if (record.entity.isRemoved || !record.entity.persists || record.isRemoved?.() || record.entity.hasTag('INLIMBO')) return [];
      return [{
        id,
        transform: {
          position: record.entity.transform.position.toArray(),
          rotationY: 0,
        },
        components: {
          stack: {
            itemId: definition.itemId, count: definition.count,
            ...(definition.mole === undefined ? {} : { mole: definition.mole }),
            ...(definition.lightflier === undefined ? {} : { lightflier: definition.lightflier }),
            ...(definition.container === undefined ? {} : { container: definition.container }),
            ...(definition.remainingUses === undefined ? {} : { remainingUses: definition.remainingUses }),
            ...(definition.remainingFuel === undefined ? {} : { remainingFuel: definition.remainingFuel }),
            ...(definition.temperature === undefined ? {} : { temperature: definition.temperature }),
            ...(definition.highTemp === undefined ? {} : { highTemp: definition.highTemp }),
            ...(definition.lowTemp === undefined ? {} : { lowTemp: definition.lowTemp }),
            ...(definition.freshnessPercent === undefined ? {} : { freshnessPercent: definition.freshnessPercent }),
            ...(definition.wet === undefined ? {} : { wet: definition.wet }),
            ...(definition.skinId === undefined ? {} : { skinId: definition.skinId }),
            ...(definition.phonographRecord === undefined ? {} : { phonographRecord: definition.phonographRecord }),
          },
          ...(definition.playbackRemaining === undefined ? {} : { phonograph: { remainingSeconds: definition.playbackRemaining } }),
          ...(definition.torchLit ? { torch: { lit: true as const } } : {}),
          ...(definition.lanternOn === undefined ? {} : { lantern: { ison: definition.lanternOn } }),
        },
      }];
    })];
  }

  /** Slot selection supplies one record; the take callback validates and consumes it atomically. */
  setPhonographRecordSource(source: () => { entity: ItemEntity; take(): boolean } | undefined): void {
    this.recordSource = source;
  }

  /** Shared hover selection uses the same insertion availability as the click path. */
  get phonographTargets(): readonly { model: THREE.Group; canInsert: boolean }[] {
    return [...this.activeItems].filter(record => record.definition.itemId === PHONOGRAPH_ID
      && !record.entity.isRemoved && !record.isRemoved?.()).map(record => ({
      model: record.model,
      canInsert: !this.inserting.has(record) && isPlayerNearby(this.player.position, record.footPosition, false),
    }));
  }

  private currentDefinition(record: GroundItemRecord): GroundItemDefinition {
    record.entity.flush();
    const definition = { ...record.definition, ...record.entity.snapshot(), ...record.getDefinition?.(), entity: record.entity };
    if (!record.entity.isRemoved) record.entity.apply(definition);
    return definition;
  }

  async insertPhonographRecord(model: THREE.Group, source: { entity: ItemEntity; take(): boolean }): Promise<boolean> {
    const record = this.items.get(model);
    const controller = model.userData.phonograph as PhonographController | undefined;
    if (!record || !controller || this.inserting.has(record) || source.entity.isRemoved || !isPhonographRecord(source.entity)
      || !Object.hasOwn(RECORD_SONGS, source.entity.skinId ?? RECORD_ID)
      || !isPlayerNearby(this.player.position, record.footPosition, false)) return false;
    this.inserting.add(record);
    const insertedRecord = source.entity.skinId ?? RECORD_ID;
    let ejected: GroundItemVisual | undefined;
    try {
      const oldRecord = controller.record;
      const skinId = oldRecord === RECORD_ID ? undefined : oldRecord;
      const spec = GROUND_ITEM_DEFINITIONS.record;
      const definition = { itemId: RECORD_ID, count: 1, name: spec.name, icon: spec.icon, atlas: spec.atlas,
        ...(skinId ? { skinId } : {}) };
      if (oldRecord) ejected = await this.createVisual(definition);
      if (this.disposed || this.items.get(model) !== record || controller.record !== oldRecord
        || source.entity.isRemoved || !isPhonographRecord(source.entity) || (source.entity.skinId ?? RECORD_ID) !== insertedRecord
        || !isPlayerNearby(this.player.position, record.footPosition, false) || !source.take()) return false;
      controller.insert(insertedRecord);
      if (ejected) {
        this.addFlungVisual(definition, record.footPosition, ejected);
        ejected = undefined;
      }
      return true;
    } finally { ejected?.dispose(); this.inserting.delete(record); }
  }

  get combatTargets(): import('../packages/stategraphs/src/attack').AttackTarget[] {
    return [...this.activeItems].filter(({ entity, isClickable }) => entity.components.combat && isClickable?.() !== false)
      .map(record => ({ id: record.entity.id, model: record.model,
        inst: { prefab: record.entity.prefab, components: record.entity.components,
          get isRemoved() { return record.entity.isRemoved; },
          getPosition: () => record.entity.getPosition(), getPhysicsRadius: () => record.model.userData.physicsRadius ?? 0,
          hasTag: (tag: string) => record.entity.hasTag(tag), PushEvent: (name: string, data: unknown) => record.entity.PushEvent(name, data) },
        isValid: () => this.activeItems.has(record) && !record.entity.isRemoved && !record.entity.hasTag('INLIMBO') }));
  }
  get hammerTargets(): readonly HammerTarget[] { return this.getHammerTargets(); }

  getHammerTargets(model?: THREE.Object3D): readonly HammerTarget[] {
    return modelValues(this.items, model, this.activeItems).filter(record => record.entity.components.workable?.GetWorkAction() === 'HAMMER')
      .map(record => ({
        id: record.id, entity: record.entity, model: record.model, get position() { return record.footPosition; },
        isValid: () => !this.disposed && this.activeItems.has(record) && !this.inserting.has(record)
          && record.entity.hasTag('HAMMER_workable'),
        playHit: () => { performToolWork('HAMMER', record.entity, {}); },
      }));
  }

  setNetCaptureHandler(handler: (target: NetCaptureTarget) => boolean): void {
    this.onNetCapture = handler;
  }
  get netCaptureTargets(): readonly NetCaptureTarget[] { return this.getNetCaptureTargets(); }

  getNetCaptureTargets(model?: THREE.Object3D): readonly NetCaptureTarget[] {
    return modelValues(this.items, model, this.activeItems).filter(record => record.entity.components.workable?.GetWorkAction() === 'NET')
      .map((record) => this.captureTarget(record));
  }
    get reskinTargets(): readonly ReskinTarget[] { return this.getReskinTargets(); }

    getReskinTargets(model?: THREE.Object3D): readonly ReskinTarget[] {
        return modelValues(this.items, model, this.activeItems).flatMap((record) => {
            const prefabId = record.definition.itemId;
            const skins = Object.keys((isHatId(prefabId) ? HAT_DEFINITIONS[prefabId] : GROUND_ITEM_DEFINITIONS[prefabId])?.skinArchives ?? {});
            const isValid = () => this.activeItems.has(record) && !record.entity.isRemoved && !record.isRemoved?.();
            return [{
                id: record.id, prefabId, model: record.model, get position() { return record.footPosition; }, isValid,
                get isRemoved() { return record.entity.isRemoved; }, hasTag: tag => record.entity.hasTag(tag) || (record.model.userData.tags?.includes(tag) ?? false),
                isVisible: () => record.model.visible,
                skins, get skinId() { return record.entity.skinId; },
                prepareNextSkin: async (tool) => {
                    const skinId = nextReskin(skins, record.definition.skinId, tool?._cached_reskinname, prefabId);
                    const definition = this.currentDefinition(record);
                    if (skinId === undefined) delete definition.skinId; else definition.skinId = skinId;
                    const visual = await this.createVisual(definition);
                    let used = false;
                    return {
                        apply: (fx?: ReskinFxMessage) => {
                            if (used || !isValid()) return false;
                            // The machine may have advanced while skin assets were loading.
                            const oldMachine = record.model.userData.phonograph as PhonographController | undefined;
                            const newMachine = visual.model.userData.phonograph as PhonographController | undefined;
                            if (oldMachine && newMachine) {
                              newMachine.record = oldMachine.record;
                              definition.phonographRecord = oldMachine.record;
                              definition.playbackRemaining = oldMachine.isPlaying ? oldMachine.remainingSeconds : undefined;
                            }
                            if (record.definition.itemId === 'torch' || record.definition.itemId === 'lantern') {
                              const current = this.currentDefinition(record);
                              if (!isValid()) return false;
                              definition.remainingFuel = current.remainingFuel;
                              definition.torchLit = current.torchLit;
                              definition.lanternOn = current.lanternOn;
                            }
                            record.entity.apply({ ...record.entity.snapshot(), skinId: definition.skinId });
                            visual.bindTransform?.(record.entity.transform);
                            visual.setDefinition?.(definition);
                            visual.bindEntity?.(record.entity);
                            visual.model.position.copy(record.footPosition);
                            visual.model.quaternion.copy(record.model.quaternion);
                            if (record.fling) visual.model.children[0].position.y = record.fling.height;
                            visual.model.userData.entityId = record.id;
                            this.removeVisual(record);
                            const replacement = this.withFootPosition({ ...record, ...visual, definition });
                            this.items.set(visual.model, replacement);
                            this.bindInventoryEvents(replacement);
                            this.bindVisualActivity(replacement);
                            visual.model.dispatchEvent({ type: 'onload' });
                            fx?.play(record.footPosition, prefabId);
                            used = true;
                            return true;
                        },
                        dispose: () => { if (!used) { visual.dispose(); used = true; } },
                    };
                },
            }];
        });
    }

    private isNetCreature(itemId: string): boolean { return this.prefabs.get(itemId)?.capture === 'net'; }

  private captureTarget(record: GroundItemRecord): NetCaptureTarget {
    const isValid = () => this.activeItems.has(record) && !record.entity.isRemoved && !record.isRemoved?.() && record.entity.hasTag('NET_workable');
    return {
      id: record.id, entity: record.entity, model: record.model, get position() { return record.footPosition; }, isValid,
      isClickable: () => record.isClickable?.() !== false,
      capture: () => {
        return isValid() && performToolWork('NET', record.entity, { components: { inventory: this.inventory } })
          && (!!record.entity.components.inventoryitem.owner || record.entity.isRemoved);
      },
    };
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if ((event.button !== 0 && event.button !== 2) || event.defaultPrevented || this.activeItems.size === 0) return;

    const actions = this.mouseActions?.getMouseActions(event);
    let root: THREE.Object3D | null;
    if (this.mouseActions) root = this.mouseActions.targetModel ?? null;
    else {
      // Standalone managers without a shared picker use their own pointer service.
      for (const record of this.activeItems) record.model.position.copy(record.entity.transform.position);
      this.pointer.trackPointer(event);
      const hit = this.pointer.raycastPointer([...this.activeItems]
        .filter(record => record.isClickable?.() !== false).map(record => record.model), true);
      root = hit?.object ?? null;
      while (root && !this.items.has(root as THREE.Group)) root = root.parent;
    }
    const record = root ? this.items.get(root as THREE.Group) : undefined;
    if (!record) return;
    const machine = record.model.userData.phonograph as PhonographController | undefined;
    if (event.button === 2) {
      if (!machine || !machine.record || !isPlayerNearby(this.player.position, record.footPosition, false)) return;
      event.preventDefault();
      if (machine.isPlaying) machine.stop(); else machine.play();
      return;
    }
    const source = this.recordSource?.();
    if (machine && source) {
      event.preventDefault();
      void this.insertPhonographRecord(record.model, source)
        .catch((error: unknown) => console.error('Unable to insert record', error));
      return;
    }
    if (record.entity.components.workable?.GetWorkAction() === 'NET') {
      if (this.mouseActions && actions?.left?.action !== 'NET') return;
      event.preventDefault();
      this.onNetCapture?.(this.captureTarget(record));
      return;
    }
  };

  get renderEntities(): readonly { object: THREE.Group; footPosition: THREE.Vector3; cameraDepth: number }[] {
    const entries: { readonly object: THREE.Group; readonly footPosition: THREE.Vector3; cameraDepth: number }[] = [];
    // Hidden visuals (daytime fireflies) take no part in depth sorting; entries are reused across frames.
    for (const record of this.activeItems) {
      if (!isSpriteEntityRendered(record.model)) continue;
      let entry = this.renderEntryByRecord.get(record);
      if (!entry) {
        entry = { get object() { return record.model; }, get footPosition() { return record.footPosition; }, cameraDepth: 0 };
        this.renderEntryByRecord.set(record, entry);
      }
      entries.push(entry);
    }
    for (const entry of this.prefabs.renderEntities) entries.push(entry);
    return entries;
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    this.prefabs.update(dt, cameraQuaternion);
    if (!this.cameraRotation) for (const { model } of this.activeItems) {
      if (model.quaternion.equals(cameraQuaternion)) continue;
      model.quaternion.copy(cameraQuaternion);
    }
    for (const item of [...this.updatingItems]) {
      const previousX = item.model.position.x, previousY = item.model.position.y, previousZ = item.model.position.z;
      item.model.position.copy(item.entity.transform.position);
      item.update?.(dt);
      if (item.fling) {
        item.fling.update(dt);
        item.model.children[0].position.y = item.fling.height;
        if (item.fling.settled) { item.fling = undefined; this.refreshUpdating(item); }
      }
      item.model.position.copy(item.entity.transform.position);
      if (item.entity.isRemoved || item.isRemoved?.()) {
        this.removeVisual(item);
        this.entities.destroy(item.entity);
      } else {
        const moved = item.model.position.x !== previousX || item.model.position.y !== previousY || item.model.position.z !== previousZ;
        // Placement tracks the logical ground origin; pointer queries update visual matrices on demand.
        if (moved) syncPlacementEntity(item.model);
      }
    }
  }

  private async createVisual(definition: GroundItemDefinition): Promise<GroundItemVisual> {
    const factory = this.prefabs.get(definition.itemId);
    const visual = await (factory ? factory.create(definition) : this.createIconVisual(definition));
    Object.assign(visual.model.userData, {
      itemId: definition.itemId, skinId: definition.skinId, count: definition.count,
    });
    return visual;
  }

  private async createIconVisual(definition: GroundItemDefinition): Promise<GroundItemVisual> {
    const atlasPath = definition.atlas ?? DEFAULT_ATLAS;
    let atlasRequest = this.atlasRequests.get(atlasPath);
    if (!atlasRequest) {
      atlasRequest = loadImageAtlas(this.archiveUrl, atlasPath);
      this.atlasRequests.set(atlasPath, atlasRequest);
      void atlasRequest.catch(() => this.atlasRequests.delete(atlasPath));
    }
    const image = (await atlasRequest).require(definition.icon);
    const texture = new THREE.DataTexture(
      Uint8Array.from(image.pixels),
      image.width,
      image.height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = true;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.01,
      toneMapped: false,
    }));
    sprite.name = `GroundItem:${definition.itemId}`;
    sprite.scale.set(ITEM_HEIGHT * image.width / image.height, ITEM_HEIGHT, 1);
    sprite.userData.itemId = definition.itemId;
    sprite.userData.skinId = definition.skinId;
    sprite.userData.count = definition.count;
    sprite.position.y = ITEM_HEIGHT / 2;
    const model = new THREE.Group();
    model.name = sprite.name;
    Object.assign(model.userData, sprite.userData);
    const visual = new THREE.Group();
    visual.add(sprite);
    model.add(visual);
    registerSpriteRenderGroup(model, visual);
    return {
      model,
      dispose() {
        model.removeFromParent();
        sprite.material.map?.dispose();
        sprite.material.dispose();
      },
    };
  }
}
