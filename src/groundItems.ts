import { ItemEntity, ItemEntityRegistry, type InventoryStore } from '@dontstarve-web/inventory';
import type { PickupTarget } from '@dontstarve-web/stategraphs';
import { loadImageAtlas, type ImageAtlas } from '@dontstarve-web/animation/imageAtlas';
import * as THREE from 'three';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import { isHatId, HAT_DEFINITIONS } from '@dontstarve-web/prefab/hats';
import { nextReskin } from '@dontstarve-web/prefab/reskin_tool';
import { type ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';
import { GROUND_ITEM_DEFINITIONS } from '@dontstarve-web/prefab/groundItems';
import { newEntityId } from '@dontstarve-web/prefab/saveRecord';
import type { BernieWorld } from '@dontstarve-web/prefab/bernie';
import type { ButterflyWorld } from '@dontstarve-web/prefab/butterfly';
import { GroundPrefabRegistry } from '@dontstarve-web/prefab/groundPrefabRegistry';
import type { GroundItemDefinition, GroundItemVisual } from '@dontstarve-web/prefab/groundPrefab';
import type { NetCaptureTarget } from '@dontstarve-web/stategraphs/bugnet';
import type { FirefliesWorld } from '@dontstarve-web/prefab/fireflies';
import { intersectSpriteEntities } from '@dontstarve-web/stategraphs/pointerRaycaster';
import { isPlayerNearby } from '@dontstarve-web/prefab/playerProximity';
import { LootFling } from '@dontstarve-web/prefab/lootFling';
import { PHONOGRAPH_ID, PhonographController } from '@dontstarve-web/prefab/phonograph';
import { RECORD_ID, RECORD_SONGS, isPhonographRecord } from '@dontstarve-web/prefab/records';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import type { SavedEntity } from './save/types';
import { performToolWork } from '../packages/stategraphs/src/componentactions';
import { actionEntity } from '../packages/prefab/src/actionEntity';
import type { DeconstructionTarget, DeconstructionLoot, PreparedDeconstruction } from '@dontstarve-web/prefab/greenstaff';

export type { GroundItemDefinition } from '@dontstarve-web/prefab/groundPrefab';

const DEFAULT_ATLAS = 'images/inventoryimages.xml';
const ITEM_HEIGHT = 4;

interface GroundItemRecord extends GroundItemVisual {
  id: string;
  entity: ItemEntity;
  definition: GroundItemDefinition;
  readonly footPosition: THREE.Vector3;
  isPlayerNearby: boolean;
  fling?: LootFling;
  stopInventoryEvents?: () => void;
}

export class GroundItemManager {
  readonly entities: ItemEntityRegistry;
  private readonly atlasRequests = new Map<string, Promise<ImageAtlas>>();
  private readonly archiveUrl: string;
  private readonly camera: THREE.Camera;
  private readonly prefabs: GroundPrefabRegistry;
  private readonly items = new Map<THREE.Group, GroundItemRecord>();
  private readonly inventory: InventoryStore;
  private readonly stopDrops: () => void;
  private readonly pendingDrops = new Map<string, { entity: ItemEntity; definition: GroundItemDefinition }>();
  private onNetCapture?: (target: NetCaptureTarget) => boolean;
  private readonly pointer = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly player: THREE.Object3D;
  private disposed = false;
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
    butterflyWorld: ButterflyWorld = { isDay: () => true, getThreatPositions: () => [], getFlowers: () => [] },
    firefliesWorld: FirefliesWorld = { isNight: () => false, getPlayerPositions: () => [] },
    bernieWorld: BernieWorld = { getSanityPercent: () => 1 },
    entities = new ItemEntityRegistry(),
  ) {
    this.entities = entities;
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.archiveUrl = archiveUrl;
    this.inventory = inventory;
    this.player = player;
    this.prefabs = new GroundPrefabRegistry({
      scene, animationBaseUrl, butterflyWorld, firefliesWorld, bernieWorld, inventoryOwnerPosition: player.position,
      dropLoot: (items, position) => this.flingLoot(items, position),
      prepareSpawn: definition => this.prepareSpawn(definition),
      getNeighbours: () => [...this.items.values()]
        .map(({ model, footPosition }) => ({ model, position: footPosition })),
    });
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.stopDrops = inventory.subscribeDropped(entity => this.onInventoryDrop(entity));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.stopDrops();
    for (const item of [...this.items.values()]) { this.removeVisual(item); this.entities.destroy(item.entity); }
    for (const { entity } of this.pendingDrops.values()) this.entities.destroy(entity);
    this.pendingDrops.clear();
    this.items.clear();
    this.atlasRequests.clear();
    this.prefabs.dispose();
  }

  async drop(
    definition: GroundItemDefinition,
    position: THREE.Vector3,
    takeFromInventory: () => boolean | ItemEntity,
  ): Promise<boolean> {
    const visuals = await this.createDropVisuals(definition);
    let taken: boolean | ItemEntity;
    try {
      taken = takeFromInventory();
    } catch (error) {
      visuals.forEach((visual) => visual.dispose());
      throw error;
    }
    if (!taken) {
      visuals.forEach((visual) => visual.dispose());
      return false;
    }
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

  /** DropLoot spawns each recipe ingredient separately, then FlingItem launches it. */
  async flingLoot(definitions: readonly GroundItemDefinition[], position: THREE.Vector3): Promise<void> {
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
      this.addFlungVisual(pieces[index], origin, result.value);
    }
  }

  /** Restores an item without removing anything from inventory or playing pickup. */
  async spawnFromSave(
    id: string,
    definition: GroundItemDefinition,
    position: THREE.Vector3,
  ): Promise<THREE.Group> {
    const visuals = await this.createDropVisuals(definition);
    visuals.forEach((visual, index) => this.addVisual(index === 0 ? id : newEntityId(),
      this.singleDropDefinition(definition), position, visual));
    return visuals[0].model;
  }

  private singleDropDefinition(definition: GroundItemDefinition): GroundItemDefinition {
    return { ...definition, count: this.isNetCreature(definition.itemId) ? 1 : definition.count };
  }

  /** Prepare art before a timed action; committing a spawned stack is synchronous. */
  // fling=true uses lootdropper.lua's FlingItem scatter; false places a normal dropped stack.
  async prepareSpawn(definition: GroundItemDefinition, fling = false): Promise<import('@dontstarve-web/prefab/groundPrefab').PreparedGroundSpawn> {
    const visuals = await this.createDropVisuals(definition);
    let released = false;
    let spawnedEntity: ItemEntity | undefined;
    return {
      get spawnedEntity() { return spawnedEntity; },
      spawn: (position, count = definition.count) => {
        if (released || this.disposed || !Number.isSafeInteger(count) || count <= 0 || count > definition.count) return false;
        released = true;
        const used = this.isNetCreature(definition.itemId) ? count : 1;
        visuals.slice(0, used).forEach(visual => {
          const item = this.singleDropDefinition({ ...definition, count });
          if (fling) this.addFlungVisual(item, position, visual);
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

  get spellTargets(): readonly DeconstructionTarget[] {
    return [...this.items.values()].map(record => {
      const entity = record.entity;
      const isValid = () => !this.disposed && this.items.get(record.model) === record && !entity.isRemoved
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
    id = entity.id;
    entity.transform.position = [position.x, dropped ? 0 : position.y, position.z];
    visual.bindTransform?.(entity.transform);
    visual.model.position.fromArray(entity.transform.position);
    visual.model.userData.entityId = id;
    visual.setDefinition?.(definition);
    visual.bindEntity?.(entity);
    const record = this.withFootPosition({ id, entity, definition, isPlayerNearby: false, ...visual });
    this.updateProximity(record);
    this.items.set(visual.model, record);
    this.bindInventoryEvents(record);
    this.scene.add(visual.model);
    visual.model.dispatchEvent({ type: dropped ? 'ondropped' : 'onload' });
  }

  private removeVisual(record: GroundItemRecord): void {
    if (this.items.get(record.model) !== record) return;
    this.items.delete(record.model);
    record.stopInventoryEvents?.();
    record.dispose();
  }

  private bindInventoryEvents(record: GroundItemRecord): void {
    const { model, entity } = record;
    model.userData.components = entity.components;
    model.userData.getGroundPosition = () => record.footPosition.clone();
    actionEntity(model, entity.prefab, entity);
    model.userData.pickupTarget = {
      model, entity, get position() { return record.footPosition; },
      hasTag: (tag: string) => entity.hasTag(tag) || (model.userData.tags?.includes(tag) ?? false),
      isValid: () => !this.disposed && this.items.get(model) === record && !entity.isRemoved
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
      entity.ListenForEvent('ondropped', () => { record.fling = undefined; model.position.fromArray(entity.transform.position); model.dispatchEvent({ type: 'ondropped' }); }),
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

  private onInventoryDrop(entity: ItemEntity): void {
    if (this.disposed || [...this.items.values()].some(record => record.entity === entity) || this.pendingDrops.has(entity.id)) return;
    const definition = { ...this.inventory.getStackSpec(entity.snapshot()), ...entity.snapshot(), entity };
    const pending = { entity, definition };
    this.pendingDrops.set(entity.id, pending);
    void this.createVisual(definition).then(visual => {
      if (this.disposed || this.pendingDrops.get(entity.id) !== pending || entity.isRemoved || entity.components.inventoryitem.owner) {
        visual.dispose(); this.pendingDrops.delete(entity.id); return;
      }
      this.pendingDrops.delete(entity.id);
      this.addVisual(entity.id, definition, new THREE.Vector3().fromArray(entity.transform.position), visual, true);
    }).catch((error: unknown) => console.error('Unable to render dropped item', error));
  }

  /** Adapt the authoritative tuple for consumers requiring a live Three.js foot point. */
  private withFootPosition(record: Omit<GroundItemRecord, 'footPosition'>): GroundItemRecord {
    const footPosition = new THREE.Vector3();
    return Object.defineProperty(record, 'footPosition', {
      enumerable: true,
      get: () => footPosition.fromArray(record.entity.transform.position),
    }) as GroundItemRecord;
  }

  private addFlungVisual(definition: GroundItemDefinition, origin: THREE.Vector3, visual: GroundItemVisual): void {
    const entity = definition.entity ?? (definition.entityId ? this.entities.get(definition.entityId) : undefined)
      ?? this.entities.create({ ...definition, entityId: newEntityId() });
    entity.transform.position = origin.toArray();
    const fling = new LootFling(entity.transform);
    this.addVisual(entity.id, { ...definition, entity }, fling.position, visual, true);
    this.items.get(visual.model)!.fling = fling;
  }

  exportRecords(): SavedEntity[] {
    const pending = [...this.pendingDrops.values()].filter(({ entity }) => !entity.isRemoved && entity.persists && !entity.components.inventoryitem.owner)
      .map(({ entity }) => {
        const { entityId: _entityId, ...stack } = entity.snapshot();
        return { id: entity.id, transform: { position: [...entity.transform.position] as [number, number, number], rotationY: 0 },
          components: { stack } };
      });
    return [...pending, ...[...this.items.values()].flatMap<SavedEntity>((record) => {
      const { id } = record;
      const definition = this.currentDefinition(record);
      if (record.entity.isRemoved || !record.entity.persists || record.isRemoved?.()) return [];
      return [{
        id,
        transform: {
          position: [...record.entity.transform.position],
          rotationY: 0,
        },
        components: {
          stack: {
            itemId: definition.itemId, count: definition.count,
            ...(definition.container === undefined ? {} : { container: definition.container }),
            ...(definition.remainingUses === undefined ? {} : { remainingUses: definition.remainingUses }),
            ...(definition.remainingFuel === undefined ? {} : { remainingFuel: definition.remainingFuel }),
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
    return [...this.items.values()].filter(record => record.definition.itemId === PHONOGRAPH_ID
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

  get hammerTargets(): readonly HammerTarget[] {
    return [...this.items.values()].filter(record => record.entity.components.workable?.GetWorkAction() === 'HAMMER')
      .map(record => ({
        id: record.id, entity: record.entity, model: record.model, get position() { return record.footPosition; },
        isValid: () => !this.disposed && this.items.get(record.model) === record && !this.inserting.has(record)
          && record.entity.hasTag('HAMMER_workable'),
        playHit: () => { performToolWork('HAMMER', record.entity, {}); },
      }));
  }

  setNetCaptureHandler(handler: (target: NetCaptureTarget) => boolean): void {
    this.onNetCapture = handler;
  }

  get netCaptureTargets(): readonly NetCaptureTarget[] {
    return [...this.items.values()].filter(record => record.entity.components.workable?.GetWorkAction() === 'NET')
      .map((record) => this.captureTarget(record));
  }

    get reskinTargets(): readonly ReskinTarget[] {
        return [...this.items.values()].flatMap((record) => {
            const prefabId = record.definition.itemId;
            const skins = Object.keys((isHatId(prefabId) ? HAT_DEFINITIONS[prefabId] : GROUND_ITEM_DEFINITIONS[prefabId])?.skinArchives ?? {});
            const isValid = () => this.items.get(record.model) === record && !record.entity.isRemoved && !record.isRemoved?.();
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
                        apply: () => {
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
                            this.scene.add(visual.model);
                            visual.model.dispatchEvent({ type: 'onload' });
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
    const isValid = () => this.items.get(record.model) === record && !record.entity.isRemoved && !record.isRemoved?.() && record.entity.hasTag('NET_workable');
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
    if ((event.button !== 0 && event.button !== 2) || event.defaultPrevented || this.items.size === 0) return;

    // Input can arrive between active frames after an entity was teleported.
    for (const record of this.items.values()) record.model.position.fromArray(record.entity.transform.position);
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const hit = intersectSpriteEntities(this.raycaster, [...this.items.values()]
      .filter(record => record.isClickable?.() !== false).map(record => record.model), true)[0];
    if (!hit) return;
    let root: THREE.Object3D | null = hit.object;
    while (root && !this.items.has(root as THREE.Group)) root = root.parent;
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
      event.preventDefault();
      this.onNetCapture?.(this.captureTarget(record));
      return;
    }
  };

  get renderEntities(): readonly { object: THREE.Group; footPosition: THREE.Vector3; cameraDepth: number }[] {
    return [...this.items.values()].map(({ model, footPosition }) => ({
      object: model, footPosition, cameraDepth: 0,
    })).concat(this.prefabs.renderEntities);
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    this.prefabs.update(dt, cameraQuaternion);
    for (const item of this.items.values()) {
      item.model.position.fromArray(item.entity.transform.position);
      item.model.quaternion.copy(cameraQuaternion);
      item.update?.(dt);
      if (item.fling) {
        item.fling.update(dt);
        item.model.children[0].position.y = item.fling.height;
        if (item.fling.settled) item.fling = undefined;
      }
      item.model.position.fromArray(item.entity.transform.position);
      this.updateProximity(item);
      if (item.entity.isRemoved || item.isRemoved?.()) {
        this.removeVisual(item);
        this.entities.destroy(item.entity);
      }
    }
  }

  private updateProximity(record: GroundItemRecord): void {
    record.isPlayerNearby = isPlayerNearby(this.player.position, record.footPosition, record.isPlayerNearby);
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
