import { syncPlacementEntity } from '../packages/prefab/src/placementEntities';
import { modelValues } from '../packages/prefab/src/modelRecords';
import { ItemEntity, ItemEntityRegistry, type InventoryStore } from '@dontstarve-web/inventory';
import type { PickupTarget } from '@dontstarve-web/stategraphs';
import type { PlayerActionPicker } from '@dontstarve-web/stategraphs';
import { loadImageAtlas, type ImageAtlas } from '@dontstarve-web/animation/imageAtlas';
import * as THREE from 'three';
import { isSpriteEntityRendered } from '@dontstarve-web/animation/renderOrder';
import { isHatId, HAT_DEFINITIONS } from '@dontstarve-web/prefab/hats';
import { nextReskin } from '@dontstarve-web/prefab/reskin_tool';
import { type ReskinFxMessage, type ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { GROUND_ART_DEFINITIONS, GROUND_ITEM_DEFINITIONS } from '@dontstarve-web/prefab/groundItems';
import { createPrefabEntity, modelHasTag } from '@dontstarve-web/prefab/prefabInstance';
import { newEntityId } from '@dontstarve-web/prefab/saveRecord';
import type { BernieWorld } from '@dontstarve-web/prefab/bernie';
import type { ButterflyWorld } from '@dontstarve-web/prefab/butterfly';
import { GroundPrefabRegistry } from '@dontstarve-web/prefab/groundPrefabRegistry';
import type { GroundItemDefinition, GroundItemVisual, GroundPrefabOptions, GroundSpawnOptions } from '@dontstarve-web/prefab/groundPrefab';
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
import type { DeconstructionTarget } from '@dontstarve-web/prefab/greenstaff';
import type { MiniMapEntity } from '@dontstarve-web/prefab/minimapEntity';
import type { WorldEventEmitter } from '../packages/prefab/src/worldContext';
import { createEffect, watchSignal, WorldContentKey, type GetWatchWorldContent, type Signal } from '@dontstarve-web/signals';


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
  private readonly loadedAtlases = new Map<string, ImageAtlas>();
  private readonly archiveUrl: string;
  private readonly prefabs: GroundPrefabRegistry;
  private readonly items = new Map<THREE.Group, GroundItemRecord>();
  private readonly groundEntitiesByPrefab = new Map<string, Set<ItemEntity>>();
  private readonly groundEntityStops = new Map<ItemEntity, () => void>();
  /** Reservations exist only while spawn art loads; committed entities replace them synchronously. */
  private readonly activeItems = new Set<GroundItemRecord>();
  /** Billboard sort entries reused across frames; the scene rewrites each entry's depth every frame. */
  private readonly renderEntryByRecord = new WeakMap<GroundItemRecord, { readonly object: THREE.Group; readonly footPosition: THREE.Vector3; cameraDepth: number }>();
  /** StartUpdatingComponent/StopUpdatingComponent: only these records are visited each frame. */
  private readonly updatingItems = new Set<GroundItemRecord>();
  private readonly inventory: InventoryStore;
  private readonly stopDrops: () => void;
  private readonly stopSpawnAsh?: () => void;
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
      spawnGroundItem: (definition, position, options) => this.spawnGroundItem(definition, position, options),
    });
    if (getWatchWorldContent) {
      const rotation = this.cameraRotation = getWatchWorldContent(WorldContentKey.CameraRotation, stop => this.cleanups.push(stop));
      // Billboards face the camera: re-orient them only when the camera turns.
      createEffect(() => {
        const quaternion = rotation.get();
        for (const { model, instance } of this.activeItems) if (!instance.sprite.sprite.peek().ground) model.quaternion.copy(quaternion);
      });
    }
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.stopDrops = inventory.subscribeDropped((entity, launch) => this.onInventoryDrop(entity, launch));
    // DefaultBurntFn requests one ash at the burnt inst's ground position.
    this.stopSpawnAsh = worldEvents?.on('spawnAsh', position => {
      this.spawnFromSave(newEntityId(), { ...inventory.getItemSpec('ash'), itemId: 'ash', count: 1 }, position.clone());
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
    for (const stop of this.groundEntityStops.values()) stop();
    this.groundEntityStops.clear();
    this.groundEntitiesByPrefab.clear();
    this.items.clear();
    this.activeItems.clear();
    this.updatingItems.clear();
    this.atlasRequests.clear(); this.loadedAtlases.clear();
    this.prefabs.dispose();
  }

  /** DROP's perform frame takes and places the authoritative item; the display loads its art. */
  drop(definition: GroundItemDefinition, position: THREE.Vector3, takeFromInventory: () => boolean | ItemEntity): boolean {
    const visuals = this.createDropVisuals(definition);
    let taken: boolean | ItemEntity;
    try { taken = takeFromInventory(); }
    catch (error) { visuals.forEach(visual => visual.dispose()); throw error; }
    if (!taken) { visuals.forEach(visual => visual.dispose()); return false; }
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
  }

  /** Restore identity and components immediately, without playing the drop animation. */
  spawnFromSave(id: string, definition: GroundItemDefinition, position: THREE.Vector3): THREE.Group {
    const visuals = this.createDropVisuals(definition);
    visuals.forEach((visual, index) => this.addVisual(index === 0 ? id : newEntityId(),
      this.singleDropDefinition(definition), position, visual));
    return visuals[0].model;
  }

  private trackGroundEntity(entity: ItemEntity): void {
    if (this.groundEntityStops.has(entity) || entity.isRemoved || entity.components.inventoryitem.owner) return;
    let entities = this.groundEntitiesByPrefab.get(entity.prefab);
    if (!entities) this.groundEntitiesByPrefab.set(entity.prefab, entities = new Set());
    entities.add(entity);
    const remove = () => {
      entities.delete(entity);
      if (entities.size === 0) this.groundEntitiesByPrefab.delete(entity.prefab);
      this.groundEntityStops.get(entity)?.();
      this.groundEntityStops.delete(entity);
    };
    const stopPickup = entity.ListenForEvent('onputininventory', remove);
    const stopRemoval = entity.ListenForEvent('onremove', remove);
    this.groundEntityStops.set(entity, () => { stopPickup(); stopRemoval(); });
  }

  /** Logical ground positions; no snapshots, art queries or unrelated prefabs. */
  *iteratePrefabPositions(prefab: string): IterableIterator<THREE.Vector3> {
    if (this.disposed) return;
    for (const entity of this.groundEntitiesByPrefab.get(prefab) ?? []) {
      if (!entity.isRemoved && !entity.components.inventoryitem.owner && !entity.hasTag('INLIMBO')) {
        yield entity.transform.position;
      }
    }
  }

  private singleDropDefinition(definition: GroundItemDefinition): GroundItemDefinition {
    return { ...definition, count: this.isNetCreature(definition.itemId) ? 1 : definition.count };
  }

  /** Places an inst that already exists, such as a lightflier the habitat spawned, with a visual created now. */
  spawnEntity(entity: ItemEntity, position: THREE.Vector3): void {
    if (this.disposed || entity.isRemoved) throw new Error('Cannot place removed ground entity');
    const definition = { ...this.inventory.getItemSpec(entity.prefab), ...entity.snapshot(), entity };
    const visual = this.createVisual(definition);
    try { this.addVisual(entity.id, definition, position, visual); }
    catch (error) { visual.dispose(); throw error; }
  }

  /**
   * SpawnPrefab of a ground stack, synchronously: the inst and its display exist now and the display loads the art.
   * `fling` scatters it as lootdropper.lua's FlingItem, `launch` gives its exact flight; otherwise it is placed as dropped.
   * A stack of live insects becomes one inst per insect, as their OnDropped does; the first is returned.
   */
  spawnGroundItem(definition: GroundItemDefinition, position: THREE.Vector3, { fling = false, launch }: GroundSpawnOptions = {}): ItemEntity | undefined {
    if (this.disposed) return undefined;
    if (!Number.isSafeInteger(definition.count) || definition.count < 1) throw new RangeError('Invalid ground item count');
    const pieces = this.isNetCreature(definition.itemId) ? definition.count : 1;
    let first: ItemEntity | undefined;
    for (let index = 0; index < pieces; index++) {
      const item = this.singleDropDefinition(definition);
      const place = (visual: GroundItemVisual) => {
        if (fling || launch) this.addFlungVisual(item, position, visual, launch);
        else this.addVisual(newEntityId(), item, position, visual, true);
        return this.items.get(visual.model)?.entity;
      };
      const visual = this.createVisual(item);
      first ??= place(visual);
    }
    return first;
  }

  /** DropLoot spawns each recipe ingredient separately, then FlingItem launches it. */
  flingLoot(definitions: readonly GroundItemDefinition[], position: THREE.Vector3, launch?: () => LootLaunch): void {
    if (this.disposed) return;
    const origin = position.clone();
    for (const definition of definitions) {
      if (!Number.isSafeInteger(definition.count) || definition.count < 1) throw new RangeError('Invalid loot count');
      for (let index = 0; index < definition.count; index++) {
        this.spawnGroundItem({ ...definition, count: 1 }, origin, { fling: true, launch: launch?.() });
      }
    }
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
        hasTag: (tag: string) => entity.hasTag(tag) || modelHasTag(record.model, tag), flush: () => entity.flush(),
        PushEvent: (name: string, data: unknown) => entity.PushEvent(name, data),
        removeOne: () => {
          if (!isValid()) return false;
          if (entity.components.stackable.count > 1) { entity.components.stackable.count--; return true; }
          return entity.remove();
        },
      };
    });
  }

  private createDropVisuals(definition: GroundItemDefinition): GroundItemVisual[] {
    if (this.disposed) throw new Error('Ground items have been disposed');
    if (!Number.isSafeInteger(definition.count) || definition.count < 1) throw new RangeError('Invalid ground item count');
    const count = this.isNetCreature(definition.itemId) ? definition.count : 1;
    const visuals: GroundItemVisual[] = [];
    try {
      // Live insects force individual drops from a stack.
      for (let index = 0; index < count; index++) visuals.push(this.createVisual(this.singleDropDefinition(definition)));
      if (this.disposed) throw new Error('Ground items have been disposed');
      return visuals;
    } catch (error) {
      visuals.forEach((visual) => visual.dispose());
      throw error;
    }
  }

  private addVisual(id: string, definition: GroundItemDefinition, position: THREE.Vector3, visual: GroundItemVisual, dropped = false): void {
    // A tile-bound item follows its tile from ondropped / onload.
    visual.instance.setActive(true);
    const entity = definition.entity ?? (definition.entityId ? this.entities.get(definition.entityId) : undefined)
      ?? this.entities.create({ ...definition, entityId: id });
    this.entities.adopt(entity);
    if (this.inventory.hasItemSpec(entity.prefab)) {
      this.inventory.configureItem(entity);
      this.prefabs.get(entity.prefab)?.configureEntity?.(entity);
    } else {
      entity.components.inventoryitem.canbepickedup = false;
    }
    definition = { ...definition, ...entity.snapshot(), entity };
    Object.assign(visual.model.userData, { itemId: entity.prefab, count: entity.components.stackable.count });
    visual.instance.skinId = entity.skinId;
    id = entity.id;
    entity.transform.position.set(position.x, dropped ? 0 : position.y, position.z);
    this.trackGroundEntity(entity);
    visual.bindTransform?.(entity.transform);
    visual.model.position.copy(entity.transform.position);
    visual.instance.entityId = id;
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
        if (this.cameraRotation && !record.instance.sprite.sprite.peek().ground) record.model.quaternion.copy(this.cameraRotation.peek());
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
    if (!this.inventory.hasItemSpec(entity.prefab)) { record.isClickable = () => false; return; }
    model.userData.components = entity.components;
    // Domain queries read the authoritative vector; presentation/pickup snapshots own their scratch vector.
    model.userData.getGroundPosition = () => entity.transform.position;
    actionEntity(model, entity.prefab, entity);
    model.userData.pickupTarget = {
      model, entity, get position() { return record.footPosition; },
      hasTag: (tag: string) => entity.hasTag(tag) || modelHasTag(model, tag),
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
      entity.ListenForEvent('perished', () => this.replacePerished(record)),
      // physics.lua LaunchAt: any inst may be thrown from its own position.
      entity.ListenForEvent('launch', launch => { record.fling = new LootFling(entity.transform, undefined, undefined, launch as LootLaunch); this.refreshUpdating(record); }),
      entity.ListenForEvent('ondropped', () => { record.fling = undefined; model.position.copy(entity.transform.position); syncPlacementEntity(model); model.dispatchEvent({ type: 'ondropped' }); }),
    ];
    record.stopInventoryEvents = () => stops.forEach(stop => stop());
    // An inst that perished between holders is replaced once it reaches the ground.
    if (entity.components.perishable.timer.peek().status === 'perished') entity.PushEvent('perished', undefined);
  }

  /** perishable.lua onperishreplacement for a world inst: same position and stack size. */
  private replacePerished(record: GroundItemRecord): void {
    const { entity } = record, prefab = entity.components.perishable.onperishreplacement;
    if (prefab === undefined || entity.components.inventoryitem.owner || this.disposed || entity.isRemoved) return;
    if (this.items.get(record.model) !== record) return;
    const count = entity.components.stackable.count;
    const position = record.footPosition.clone();
    entity.remove();
    this.spawnGroundItem({ ...this.inventory.getItemSpec(prefab), itemId: prefab, count }, position);
  }

  private onInventoryDrop(entity: ItemEntity, launch?: LootLaunch): void {
    if (this.disposed || this.groundEntityStops.has(entity)) return;
    // butterfly.lua OnDropped: a dropped stack of live insects splits into one entity per insect.
    const extra = this.isNetCreature(entity.prefab) ? entity.components.stackable.count - 1 : 0;
    if (extra > 0) {
      const rest = { ...this.inventory.getStackSpec(entity.snapshot()), ...entity.snapshot(false), itemId: entity.prefab, count: extra };
      entity.components.stackable.count = 1;
      const position = entity.transform.position.clone();
      this.spawnFromSave(newEntityId(), rest, position);
    }
    const definition = { ...this.inventory.getStackSpec(entity.snapshot()), ...entity.snapshot(), entity };
    const visual = this.createVisual(definition);
    if (launch) this.addFlungVisual(definition, entity.transform.position.clone(), visual, launch);
    else this.addVisual(entity.id, definition, entity.transform.position.clone(), visual, true);
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
    return [...[...this.items.values()].flatMap<SavedEntity>((record) => {
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
            ...(definition.variant === undefined ? {} : { variant: definition.variant }),
            ...(definition.mole === undefined ? {} : { mole: definition.mole }),
            ...(definition.lightflier === undefined ? {} : { lightflier: definition.lightflier }),
            ...(definition.container === undefined ? {} : { container: definition.container }),
            ...(definition.remainingUses === undefined ? {} : { remainingUses: definition.remainingUses }),
            ...(definition.remainingFuel === undefined ? {} : { remainingFuel: definition.remainingFuel }),
            ...(definition.temperature === undefined ? {} : { temperature: definition.temperature }),
            ...(definition.armor === undefined ? {} : { armor: definition.armor }),
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
      if (oldRecord) ejected = this.createVisual(definition);
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
          getPosition: () => record.entity.getPosition(), getPhysicsRadius: () => record.instance.getPhysicsRadius(0),
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
            const skins = Object.keys((isHatId(prefabId) ? HAT_DEFINITIONS[prefabId] : GROUND_ART_DEFINITIONS[prefabId])?.skinArchives ?? {});
            const isValid = () => this.activeItems.has(record) && !record.entity.isRemoved && !record.isRemoved?.();
            return [{
                id: record.id, prefabId, model: record.model, get position() { return record.footPosition; }, isValid,
                get isRemoved() { return record.entity.isRemoved; }, hasTag: tag => record.entity.hasTag(tag) || modelHasTag(record.model, tag),
                isVisible: () => record.model.visible,
                skins, get skinId() { return record.entity.skinId; },
                prepareNextSkin: async (tool) => {
                    const skinId = nextReskin(skins, record.definition.skinId, tool?._cached_reskinname, prefabId);
                    const definition = this.currentDefinition(record);
                    if (skinId === undefined) delete definition.skinId; else definition.skinId = skinId;
                    const visual = this.createVisual(definition);
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
                            visual.instance.entityId = record.entity.id;
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
    // RMB switches a phonograph through its machine component's TURNON / TURNOFF.
    if (event.button === 2) return;
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
    // Items drawing nothing (no sprite built, as daytime fireflies playing no animation) take no part in depth sorting;
    // entries are reused across frames.
    for (const record of this.activeItems) {
      if (!record.instance.sprite.loaded || !isSpriteEntityRendered(record.model)) continue;
      let entry = this.renderEntryByRecord.get(record);
      if (!entry) {
        entry = { get object() { return record.model; }, get footPosition() { return record.footPosition; }, cameraDepth: 0, ...(record.instance.sprite.sprite.peek().ground ? { renderLayer: -1 } : {}) };
        this.renderEntryByRecord.set(record, entry);
      }
      entries.push(entry);
    }
    for (const entry of this.prefabs.renderEntities) entries.push(entry);
    return entries;
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    this.prefabs.update(dt, cameraQuaternion);
    if (!this.cameraRotation) for (const { model, instance } of this.activeItems) {
      if (instance.sprite.sprite.peek().ground) continue;
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

  /** The item's visual, created now; only the transitional creature factories still return a Promise. */
  private createVisual(definition: GroundItemDefinition): GroundItemVisual {
    const factory = this.prefabs.get(definition.itemId);
    const finish = (visual: GroundItemVisual) => {
      Object.assign(visual.model.userData, { itemId: definition.itemId, count: definition.count });
      visual.instance.skinId = definition.skinId;
      return visual;
    };
    const visual = factory ? factory.create(definition) : this.createIconVisual(definition);
    return finish(visual);
  }

  private loadAtlas(atlasPath: string): Promise<ImageAtlas> {
    let atlasRequest = this.atlasRequests.get(atlasPath);
    if (!atlasRequest) {
      atlasRequest = loadImageAtlas(this.archiveUrl, atlasPath);
      void atlasRequest.then(atlas => this.loadedAtlases.set(atlasPath, atlas), () => this.atlasRequests.delete(atlasPath));
      this.atlasRequests.set(atlasPath, atlasRequest);
    }
    return atlasRequest;
  }

  /** An inventory icon billboard for items outside the ground catalog; its display loads the atlas. */
  private createIconVisual(definition: GroundItemDefinition): GroundItemVisual {
    const atlasPath = definition.atlas ?? DEFAULT_ATLAS;
    const name = `GroundItem:${definition.itemId}`;
    let art: { texture: THREE.DataTexture; material: THREE.SpriteMaterial; aspect: number } | undefined;
    const draw = (atlas: ImageAtlas) => {
      art ??= iconArt(atlas, definition.icon);
      const { material, aspect } = art;
      return {
        create: () => {
          const sprite = new THREE.Sprite(material);
          sprite.name = name;
          sprite.scale.set(ITEM_HEIGHT * aspect, ITEM_HEIGHT, 1);
          sprite.position.y = ITEM_HEIGHT / 2;
          const visual = new THREE.Group();
          visual.add(sprite);
          return new THREE.Group().add(visual);
        },
        release: (drawn: THREE.Group) => drawn.removeFromParent(),
      };
    };
    // The entity is drawn by its display like any other item; the source only builds the icon billboard.
    const { instance, display } = createPrefabEntity(definition.itemId, {
      peek: () => { const atlas = this.loadedAtlases.get(atlasPath); return atlas && draw(atlas); },
      load: () => this.loadAtlas(atlasPath).then(draw),
    }, { name: '' }, name);
    return {
      model: display.model, instance,
      dispose() {
        instance.remove();
        display.dispose();
        art?.texture.dispose();
        art?.material.dispose();
      },
    };
  }
}

function iconArt(atlas: ImageAtlas, icon: string): { texture: THREE.DataTexture; material: THREE.SpriteMaterial; aspect: number } {
  const image = atlas.require(icon);
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

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.01,
    toneMapped: false,
  });
  return { texture, material, aspect: image.width / image.height };
}
