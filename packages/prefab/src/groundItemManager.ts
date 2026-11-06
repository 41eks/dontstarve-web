import type { ReadonlyVector3 } from '@dontstarve-web/animation/transformRoot';
import { syncPlacementEntity } from './placementEntities';
import { ItemEntity, ItemEntityRegistry, type InventoryStack, type InventoryStore } from '@dontstarve-web/inventory';
import type { PickupTarget } from '@dontstarve-web/stategraphs';
import type { PlayerActionPicker } from '@dontstarve-web/stategraphs';
import { IconSpriteAtlases, PrefabDisplayGroup } from '@dontstarve-web/display';
import * as THREE from 'three';
import { isSpriteEntityRendered } from '@dontstarve-web/animation/renderOrder';
import { isHatId, HAT_DEFINITIONS } from './hats';
import { reskinTarget } from './reskin_tool';
import type { ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { GROUND_ART_DEFINITIONS } from './groundItems';
import { createPrefabEntity } from './prefabInstance';
import { newEntityId } from './saveRecord';
import type { BernieWorld } from './bernie';
import type { ButterflyWorld } from './butterfly';
import { GroundPrefabRegistry } from './groundPrefabRegistry';
import type { GroundItemDefinition, GroundItemVisual, GroundPrefabOptions, GroundSpawnOptions } from './groundPrefab';
import type { FirefliesWorld } from './fireflies';
import { LootFling, type LootLaunch } from './lootFling';
import { actionEntity, disposeActionEntity, findActionEntity } from './actionEntity';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { DeconstructionTarget } from './staff';
import type { WorldEventEmitter } from './worldContext';
import { createEffect, watchSignal } from '@dontstarve-web/signals';

const DEFAULT_ATLAS = 'images/inventoryimages.xml';

/** A ground stack as the save holds it; the entity's other saved state lives in its stack. */
export interface GroundItemSaveRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: {
    stack: InventoryStack;
    phonograph?: { remainingSeconds: number };
    torch?: { lit: true };
    lantern?: { ison: boolean };
  };
}

interface GroundItemRecord extends GroundItemVisual {
  definition: GroundItemDefinition;
  readonly footPosition: ReadonlyVector3;
  fling?: LootFling;
  stopInventoryEvents?: () => void;
  stopActivity?: () => void;
  /** Cleanups of the record's private watched signals (updating flag, entity removal). */
  readonly stops: (() => void)[];
}

export class GroundItemManager {
  readonly entities: ItemEntityRegistry;
  private readonly icons: IconSpriteAtlases;
  private readonly prefabs: GroundPrefabRegistry;
  private readonly items = new Map<THREE.Group, GroundItemRecord>();
  private readonly groundEntitiesByPrefab = new Map<string, Set<ItemEntity>>();
  private readonly groundEntityStops = new Map<ItemEntity, () => void>();
  /** Reservations exist only while spawn art loads; committed entities replace them synchronously. */
  private readonly activeItems = new Set<GroundItemRecord>();
  /** Billboard sort entries reused across frames; the scene rewrites each entry's depth every frame. */
  private readonly renderEntryByRecord = new WeakMap<GroundItemRecord, { readonly object: THREE.Group; readonly footPosition: ReadonlyVector3; cameraDepth: number }>();
  /** StartUpdatingComponent/StopUpdatingComponent: only these records are visited each frame. */
  private readonly updatingItems = new Set<GroundItemRecord>();
  private readonly inventory: InventoryStore;
  private readonly stopDrops: () => void;
  private readonly stopSpawnAsh?: () => void;
  private readonly displays: PrefabDisplayGroup;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    _camera: THREE.Camera,
    _renderer: THREE.WebGLRenderer,
    archiveUrl: string,
    inventory: InventoryStore,
    animationBaseUrl: string,
    player: THREE.Object3D,
    butterflyWorld: ButterflyWorld = { getThreatPositions: () => [], getFlowers: () => [] },
    firefliesWorld: FirefliesWorld = {},
    bernieWorld?: BernieWorld,
    entities = new ItemEntityRegistry(),
    scheduler?: GameTimeScheduler,
    fx?: GroundPrefabOptions['fx'],
    moleWorld?: GroundPrefabOptions['moleWorld'],
    worldEvents?: WorldEventEmitter,
    _mouseActions?: PlayerActionPicker,
    lightflierWorld?: GroundPrefabOptions['lightflierWorld'],
    tickingarea?: GroundPrefabOptions['tickingarea'],
    physics?: GroundPrefabOptions['physics'],
  ) {
    this.entities = entities;
    this.displays = new PrefabDisplayGroup(scene);
    this.icons = new IconSpriteAtlases(archiveUrl);
    this.inventory = inventory;
    this.prefabs = new GroundPrefabRegistry({
      scene, animationBaseUrl, scheduler, fx, moleWorld, lightflierWorld, tickingarea, physics, butterflyWorld, firefliesWorld, bernieWorld, inventoryOwnerPosition: player.position,
      handEquipment: inventory.handEquipment,
      dropLoot: (items, position) => this.flingLoot(items, position),
      spawnGroundItem: (definition, position, options) => this.spawnGroundItem(definition, position, options),
    });
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
    this.stopDrops();
    for (const item of [...this.items.values()]) { this.removeVisual(item); this.entities.destroy(item.instance); }
    this.displays.dispose();
    for (const stop of this.groundEntityStops.values()) stop();
    this.groundEntityStops.clear();
    this.groundEntitiesByPrefab.clear();
    this.items.clear();
    this.activeItems.clear();
    this.updatingItems.clear();
    this.icons.dispose();
    this.prefabs.dispose();
  }

  /**
   * DROP's perform frame takes and places the authoritative item; the display loads its art. A ground visual draws its
   * inst's own sprite. An inst the caller names (`definition.entity`) leaves the inventory, which validated its skin, and
   * only then is shown on the ground. A drop described by its definition alone becomes new insts whose visuals are created
   * before anything is taken, so art that cannot be created takes nothing.
   */
  drop(definition: GroundItemDefinition, position: ReadonlyVector3, takeFromInventory: () => boolean | ItemEntity): boolean {
    const pieces = this.dropPieces(definition);
    const prepared: { entity: ItemEntity; created: boolean; item: GroundItemDefinition; visual: GroundItemVisual }[] = [];
    try {
      if (!definition.entity) {
        for (let index = 0; index < pieces; index++) {
          const item = this.singleDropDefinition(definition);
          const existing = item.entityId ? this.entities.get(item.entityId) : undefined;
          const entity = existing ?? this.entities.create({ ...item, entityId: newEntityId() });
          let visual: GroundItemVisual;
          try { visual = this.createVisual(item, entity); }
          catch (error) { if (!existing) this.entities.destroy(entity); throw error; }
          prepared.push({ entity, created: !existing, item, visual });
        }
      }
      const taken = takeFromInventory();
      if (!taken) return false;
      if (taken instanceof ItemEntity) {
        const preparedIndex = prepared.findIndex(entry => entry.entity === taken);
        this.placeTaken(taken, definition, pieces, position, prepared[preparedIndex]?.visual);
        if (preparedIndex !== -1) prepared.splice(preparedIndex, 1);
      }
      else for (const { entity, item, visual } of prepared.splice(0)) this.addVisual(entity, item, position, visual, true);
      return true;
    } finally {
      for (const { entity, created, visual } of prepared) {
        visual.dispose();
        if (created) this.entities.destroy(entity);
      }
    }
  }

  /** The taken inst is placed itself; a stack of live insects becomes one inst per insect, as their OnDropped does. */
  private placeTaken(taken: ItemEntity, definition: GroundItemDefinition, pieces: number, position: ReadonlyVector3, visual?: GroundItemVisual): void {
    if (pieces > 1) taken.apply({ ...taken.snapshot(), count: 1 });
    const item = { ...definition, ...taken.snapshot(), entity: taken };
    if (visual) this.addVisual(taken, item, position, visual, true);
    else this.placeEntity(taken, item, position, true);
    for (let index = 1; index < pieces; index++) {
      const item = { ...definition, ...taken.snapshot(), entity: undefined, entityId: undefined, count: 1 };
      this.withGroundEntity(item, newEntityId(), entity => this.placeEntity(entity, item, position, true));
    }
  }

  /** Restore identity and components immediately, without playing the drop animation. */
  spawnFromSave(id: string, definition: GroundItemDefinition, position: ReadonlyVector3): THREE.Group {
    const pieces = this.dropPieces(definition);
    let first: THREE.Group | undefined;
    for (let index = 0; index < pieces; index++) {
      const item = this.singleDropDefinition(definition);
      const model = this.withGroundEntity(item, index === 0 ? id : newEntityId(), entity => this.placeEntity(entity, item, position));
      first ??= model;
    }
    return first!;
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
  *iteratePrefabPositions(prefab: string): IterableIterator<ReadonlyVector3> {
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
  spawnEntity(entity: ItemEntity, position: ReadonlyVector3): void {
    if (this.disposed || entity.isRemoved) throw new Error('Cannot place removed ground entity');
    const definition = { ...this.inventory.getItemSpec(entity.prefab), ...entity.snapshot(), entity };
    this.placeEntity(entity, definition, position);
  }

  /**
   * SpawnPrefab of a ground stack, synchronously: the inst and its display exist now and the display loads the art.
   * `fling` scatters it as lootdropper.lua's FlingItem, `launch` gives its exact flight; otherwise it is placed as dropped.
   * A stack of live insects becomes one inst per insect, as their OnDropped does; the first is returned.
   */
  spawnGroundItem(definition: GroundItemDefinition, position: ReadonlyVector3, { fling = false, launch }: GroundSpawnOptions = {}): ItemEntity | undefined {
    if (this.disposed) return undefined;
    if (!Number.isSafeInteger(definition.count) || definition.count < 1) throw new RangeError('Invalid ground item count');
    const pieces = this.isNetCreature(definition.itemId) ? definition.count : 1;
    let first: ItemEntity | undefined;
    for (let index = 0; index < pieces; index++) {
      const item = this.singleDropDefinition(definition);
      const entity = this.withGroundEntity(item, newEntityId(), entity => {
        if (fling || launch) this.addFlungVisual(entity, item, position, this.createVisual(item, entity), launch);
        else this.placeEntity(entity, item, position, true);
        return entity;
      });
      first ??= entity;
    }
    return first;
  }

  /** DropLoot spawns each recipe ingredient separately, then FlingItem launches it. */
  flingLoot(definitions: readonly GroundItemDefinition[], position: ReadonlyVector3, launch?: () => LootLaunch): void {
    if (this.disposed) return;
    const origin = position.clone();
    for (const definition of definitions) {
      if (!Number.isSafeInteger(definition.count) || definition.count < 1) throw new RangeError('Invalid loot count');
      for (let index = 0; index < definition.count; index++) {
        this.spawnGroundItem({ ...definition, count: 1 }, origin, { fling: true, launch: launch?.() });
      }
    }
  }

  /** How many insts a ground stack becomes: live insects force individual drops from a stack. */
  private dropPieces(definition: GroundItemDefinition): number {
    if (this.disposed) throw new Error('Ground items have been disposed');
    if (!Number.isSafeInteger(definition.count) || definition.count < 1) throw new RangeError('Invalid ground item count');
    return this.isNetCreature(definition.itemId) ? definition.count : 1;
  }

  /**
   * Places the inst a ground definition names: the given one, a registered one by id, or a new one with `id`. Its
   * visual draws its sprite, so the inst exists first; one created here is destroyed again if placing it fails.
   */
  private withGroundEntity<T>(definition: GroundItemDefinition, id: string, place: (entity: ItemEntity) => T): T {
    const existing = definition.entity ?? (definition.entityId ? this.entities.get(definition.entityId) : undefined);
    const entity = existing ?? this.entities.create({ ...definition, entityId: id });
    try { return place(entity); }
    catch (error) { if (!existing) this.entities.destroy(entity); throw error; }
  }

  /** Places the inst with a ground visual created now, which draws the item's own sprite. */
  private placeEntity(entity: ItemEntity, definition: GroundItemDefinition, position: ReadonlyVector3, dropped = false, notifyDrop = true): THREE.Group {
    const visual = this.createVisual(definition, entity);
    try { this.addVisual(entity, definition, position, visual, dropped, notifyDrop); }
    catch (error) { visual.dispose(); throw error; }
    return visual.model;
  }

  private addVisual(entity: ItemEntity, definition: GroundItemDefinition, position: ReadonlyVector3, visual: GroundItemVisual, dropped = false, notifyDrop = true): void {
    // A tile-bound item follows its tile from ondropped / onload.
    visual.instance.setActive(true);
    this.entities.adopt(entity);
    if (this.inventory.hasItemSpec(entity.prefab)) {
      this.inventory.configureItem(entity);
      this.prefabs.get(entity.prefab)?.configureEntity?.(entity);
    } else {
      entity.components.inventoryitem.canbepickedup = false;
    }
    definition = { ...definition, ...entity.snapshot(), entity };
    visual.instance.setPosition(position.x, dropped ? 0 : position.y, position.z);
    entity.MiniMapEntity?.tileTracker.sync();
    this.trackGroundEntity(entity);
    visual.setDefinition?.(definition);
    const record: GroundItemRecord = { definition, stops: [], ...visual, footPosition: entity.position };
    this.items.set(visual.model, record);
    this.bindInventoryEvents(record);
    this.displays.mount(visual.display, record.footPosition);
    this.bindVisualActivity(record);
    this.bindVisualUpdating(record);
    this.bindEntityRemoval(record);
    if (!dropped || notifyDrop) entity.PushEvent(dropped ? 'ondropped' : 'onload');
  }

  private removeVisual(record: GroundItemRecord): void {
    if (this.items.get(record.model) !== record) return;
    this.items.delete(record.model);
    this.endFling(record);
    this.activeItems.delete(record);
    this.updatingItems.delete(record);
    record.stops.splice(0).forEach(stop => stop());
    record.stopActivity?.();
    record.stopInventoryEvents?.();
    record.dispose();
    disposeActionEntity(record.model);
  }

  /** Loot in flight comes to rest: the entity keeps its sprite json, so a later visual starts on the ground. */
  private endFling(record: GroundItemRecord): void {
    record.fling = undefined;
    record.instance.sprite.setVisualHeight(0);
  }

  private bindVisualActivity(record: GroundItemRecord): void {
    const setActive = (active: boolean) => {
      if (active) {
        this.activeItems.add(record);
        this.refreshUpdating(record);
      } else {
        this.activeItems.delete(record);
        this.updatingItems.delete(record);
      }
    };
    record.stopActivity = undefined;
    if (!record.active) { setActive(true); return; }
    const active = watchSignal(record.active, stop => { record.stopActivity = stop; });
    createEffect(() => setActive(active.get()));
  }

  /** Visit active records while their prefab requests frame updates or their loot is in flight. */
  private refreshUpdating(record: GroundItemRecord): void {
    const needed = this.activeItems.has(record) && (record.fling !== undefined
      || (record.updating?.peek() ?? true));
    if (needed) this.updatingItems.add(record); else this.updatingItems.delete(record);
  }

  private bindVisualUpdating(record: GroundItemRecord): void {
    if (!record.updating) return;
    const updating = watchSignal(record.updating, stop => record.stops.push(stop));
    createEffect(() => { updating.get(); this.refreshUpdating(record); });
  }

  /** Entity removal ends the record without waiting for a frame visit. */
  private bindEntityRemoval(record: GroundItemRecord): void {
    const removal = watchSignal(record.instance.removal, stop => record.stops.push(stop));
    createEffect(() => {
      if (!removal.get() || this.items.get(record.model) !== record) return;
      this.removeVisual(record);
      this.entities.destroy(record.instance);
    });
  }

  private bindInventoryEvents(record: GroundItemRecord): void {
    const { model, instance: entity } = record;
    if (!this.inventory.hasItemSpec(entity.prefab)) { record.isClickable = () => false; return; }
    // Domain queries read the authoritative vector; presentation/pickup snapshots own their scratch vector.
    const actions = actionEntity(model, entity.prefab, entity);
    actions.reskinTarget = this.createReskinTarget(record);
    actions.deconstructionTarget = this.createDeconstructionTarget(record);
    actions.pickupTarget = {
      model, entity, get position() { return record.footPosition; },
      hasTag: (tag: string) => entity.hasTag(tag),
      isValid: () => !this.disposed && this.activeItems.has(record) && !entity.isRemoved
        && !entity.components.inventoryitem.owner && record.isClickable?.() !== false && !record.isRemoved?.(),
    } satisfies PickupTarget;
    const stops = [
      entity.ListenForEvent('onputininventory', () => {
        this.removeVisual(record);
      }),
      entity.ListenForEvent('onremove', () => this.removeVisual(record)),
      entity.ListenForEvent('perished', () => this.replacePerished(record)),
      // physics.lua LaunchAt: any inst may be thrown from its own position.
      entity.ListenForEvent('launch', launch => { record.fling = new LootFling(entity.transform, undefined, undefined, launch as LootLaunch); this.refreshUpdating(record); }),
      entity.ListenForEvent('ondropped', () => { this.endFling(record); this.refreshUpdating(record); syncPlacementEntity(model); }),
    ];
    record.stopInventoryEvents = () => stops.forEach(stop => stop());
    // An inst that perished between holders is replaced once it reaches the ground.
    if (entity.components.perishable.timer.peek().status === 'perished') entity.PushEvent('perished', undefined);
  }

  /** perishable.lua onperishreplacement for a world inst: same position and stack size. */
  private replacePerished(record: GroundItemRecord): void {
    const { instance: entity } = record, prefab = entity.components.perishable.onperishreplacement;
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
    if (launch) this.addFlungVisual(entity, definition, entity.transform.position.clone(), this.createVisual(definition, entity), launch, false);
    else this.placeEntity(entity, definition, entity.transform.position.clone(), true, false);
  }

  private addFlungVisual(entity: ItemEntity, definition: GroundItemDefinition, origin: ReadonlyVector3, visual: GroundItemVisual, launch?: LootLaunch, notifyDrop = true): void {
    entity.setPosition(origin.x, origin.y, origin.z);
    const fling = new LootFling(entity.transform, undefined, undefined, launch);
    this.addVisual(entity, { ...definition, entity }, fling.position, visual, true, notifyDrop);
    const flung = this.items.get(visual.model)!;
    flung.fling = fling;
    this.refreshUpdating(flung);
  }



  exportRecords(): GroundItemSaveRecord[] {
    return [...[...this.items.values()].flatMap<GroundItemSaveRecord>((record) => {
      const id = record.instance.id;
      const definition = this.currentDefinition(record);
      if (record.instance.isRemoved || !record.instance.persists || record.isRemoved?.() || record.instance.hasTag('INLIMBO')) return [];
      return [{
        id,
        transform: {
          position: record.instance.transform.position.toArray(),
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
            ...(definition.inventory === undefined ? {} : { inventory: definition.inventory }),
          },
          ...(definition.playbackRemaining === undefined ? {} : { phonograph: { remainingSeconds: definition.playbackRemaining } }),
          ...(definition.torchLit ? { torch: { lit: true as const } } : {}),
          ...(definition.lanternOn === undefined ? {} : { lantern: { ison: definition.lanternOn } }),
        },
      }];
    })];
  }

  private currentDefinition(record: GroundItemRecord): GroundItemDefinition {
    record.instance.flush();
    // The skin is read from the inst alone: a snapshot omits an unskinned item's skinId.
    const { skinId: _placed, ...placed } = record.definition;
    const definition = { ...placed, ...record.instance.snapshot(), ...record.getDefinition?.(), entity: record.instance };
    if (!record.instance.isRemoved) record.instance.apply(definition);
    return definition;
  }

    get reskinTargets(): readonly ReskinTarget[] {
        return Array.from(this.activeItems, record => findActionEntity(record.model)?.reskinTarget)
            .filter((target): target is ReskinTarget => target !== undefined);
    }

  /** The greenstaff's view of a ground stack: it removes one item of the stack at a time. */
  private createDeconstructionTarget(record: GroundItemRecord): DeconstructionTarget {
    const entity = record.instance;
    const isValid = () => !this.disposed && this.activeItems.has(record) && !entity.isRemoved
      && !entity.components.inventoryitem.owner && record.isClickable?.() !== false && !record.isRemoved?.();
    return {
      prefab: entity.prefab, model: record.model, components: entity.components,
      get position() { return record.footPosition; }, get isRemoved() { return !isValid(); }, isValid,
      isVisible: () => record.model.visible,
      hasTag: (tag: string) => entity.hasTag(tag), flush: () => entity.flush(),
      PushEvent: (name: string, data: unknown) => entity.PushEvent(name, data),
      removeOne: () => {
        if (!isValid()) return false;
        if (entity.components.stackable.count > 1) { entity.components.stackable.count--; return true; }
        return entity.remove();
      },
    };
  }

    private createReskinTarget(record: GroundItemRecord): ReskinTarget {
        const prefabId = record.definition.itemId;
        const skins = Object.keys((isHatId(prefabId) ? HAT_DEFINITIONS[prefabId] : GROUND_ART_DEFINITIONS[prefabId])?.skinArchives ?? {});
        const isValid = () => this.activeItems.has(record) && !record.instance.isRemoved && !record.isRemoved?.();
        // The item's sprite json owns its skin; its ground visual, slot and save follow it.
        return reskinTarget({
            id: record.instance.id, prefabId, model: record.model, sprite: record.instance.sprite, skins, isValid,
            get position() { return record.footPosition; }, get isRemoved() { return record.instance.isRemoved; },
            hasTag: tag => record.instance.hasTag(tag), isVisible: () => record.model.visible,
        });
    }

    private isNetCreature(itemId: string): boolean { return this.prefabs.get(itemId)?.capture === 'net'; }


  get renderEntities(): readonly { object: THREE.Group; footPosition: ReadonlyVector3; cameraDepth: number }[] {
    const entries: { readonly object: THREE.Group; readonly footPosition: ReadonlyVector3; cameraDepth: number }[] = [];
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
    for (const item of [...this.updatingItems]) {
      // Declared before the display draws, so the sprite stands at this frame's height.
      if (item.fling) {
        item.fling.update(dt);
        item.instance.sprite.setVisualHeight(item.fling.height);
        if (item.fling.settled) { this.endFling(item); this.refreshUpdating(item); }
      }
      // The display advances the declared clips, then the visual's own update runs prefab logic. What that logic
      // declares this frame (a new clip, a set frame) is drawn now, as the engine renders the latest AnimState.
      item.display.update(dt, cameraQuaternion);
      if (item.update) { item.update(dt); item.display.update(0, cameraQuaternion); }
      if (item.instance.isRemoved || item.isRemoved?.()) {
        this.removeVisual(item);
        this.entities.destroy(item.instance);
      } else {
        // These indexes retain their own tile keys and read the model's authoritative position.
        syncPlacementEntity(item.model);
        item.instance.MiniMapEntity?.tileTracker.moved();
      }
    }
  }

  /** The inst's ground visual, created now; it draws the item's own sprite, which keeps its skin. */
  private createVisual(definition: GroundItemDefinition, entity: ItemEntity): GroundItemVisual {
    const factory = this.prefabs.get(definition.itemId);
    return factory ? factory.create(definition, entity) : this.createIconVisual(definition, entity);
  }

  /** An inventory icon billboard for items outside the ground catalog; the display side loads the atlas. */
  private createIconVisual(definition: GroundItemDefinition, entity: ItemEntity): GroundItemVisual {
    const name = `GroundItem:${definition.itemId}`;
    const icon = this.icons.source(definition.atlas ?? DEFAULT_ATLAS, definition.icon, name);
    // The entity is drawn by its display like any other item; the source only builds the icon billboard.
    const { instance, display } = createPrefabEntity(definition.itemId, icon, { name: '', billboard: true, instance: entity }, name);
    return {
      model: display.model, instance, display,
      dispose() {
        display.dispose();
        icon.dispose();
      },
    };
  }
}
