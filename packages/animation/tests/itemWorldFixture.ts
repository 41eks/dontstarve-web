import * as THREE from 'three';
import { PrefabDisplayGroup, SpriteResources } from '../../display/src';
import { newItemEntityId, type InventoryStack, type InventoryStore, type ItemEntity, type ItemEntityRegistry } from '../../inventory/src';
import { ComponentUpdates } from '../../componets/src/componentUpdates';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { LootLaunch } from '../../componets/src/inventoryphysics';
import type { ReadonlyVector3 } from '../src/transformRoot';
import { GROUND_ART_DEFINITIONS, GroundItemAssets } from '../../prefab/src/groundItems';
import type { GroundItemDefinition, GroundSpawnOptions, ItemPrefabWorld } from '../../prefab/src/groundPrefab';
import { flingLoot, itemPrefabs, spawnGroundStack } from '../../prefab/src/itemPrefabs';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { instanceReskinTarget } from '../../prefab/src/reskin_tool';
import type { ReskinTarget } from '../../stategraphs/src/reskin_tool';
import type { PrefabSaveRecord } from '../../prefab/src/saveRecord';
import type { WorldEventEmitter } from '../../prefab/src/worldContext';
import { ITEM_PREFAB_IDS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import type { SavedEntity } from '../../../src/save/types';
import type { EntityRegistration } from '../../../src/entityRegistry';

const ORIGIN = new THREE.Vector3();

/**
 * The application's item wiring in a test scene: the item prefabs on a PrefabEntityManager of their own, the
 * inventory's registry spawning through it, the components' frame updates and the displays. Its methods are the
 * spawns and queries the scene's callers use.
 */
export class ItemWorldFixture {
  readonly prefabs: PrefabEntityManager<string, PrefabInstance>;
  readonly displays: PrefabDisplayGroup;
  readonly componentUpdates = new ComponentUpdates();
  readonly scheduler: GameTimeScheduler;
  readonly world: ItemPrefabWorld;
  private readonly inventory: InventoryStore;
  private readonly ownsScheduler: boolean;
  private readonly sprites = new SpriteResources(undefined, undefined, new GroundItemAssets());
  private readonly stopAsh?: () => void;

  constructor(scene: THREE.Scene, _camera: THREE.Camera, _renderer: unknown, archiveUrl: string, inventory: InventoryStore,
    animationBaseUrl: string, _player: THREE.Object3D,
    butterflyWorld: ItemPrefabWorld['butterflyWorld'] = { getThreatPositions: () => [], getFlowers: () => [] },
    firefliesWorld: ItemPrefabWorld['firefliesWorld'] = {}, bernieWorld?: ItemPrefabWorld['bernieWorld'],
    _entities?: ItemEntityRegistry, scheduler?: GameTimeScheduler, fx?: ItemPrefabWorld['fx'], moleWorld?: ItemPrefabWorld['moleWorld'],
    worldEvents?: WorldEventEmitter, _mouseActions?: unknown, lightflierWorld?: ItemPrefabWorld['lightflierWorld'],
    tickingarea?: import('../../signals/src').TileStateQuery, physics?: import('cannon-es').World) {
    this.inventory = inventory;
    this.ownsScheduler = !scheduler;
    this.scheduler = scheduler ?? new GameTimeScheduler();
    this.displays = new PrefabDisplayGroup(scene);
    // The scene has one ticking area: the manager's tile activity and the fireflies' world read the same one.
    this.prefabs = new PrefabEntityManager(this.displays, animationBaseUrl,
      { tickingarea: tickingarea ?? firefliesWorld.tickingarea, physics, iconArchiveUrl: archiveUrl });
    this.world = {
      newItem: prefab => inventory.entities.construct({ itemId: prefab, count: 1 }),
      spawnItem: state => inventory.entities.create(state),
      isInventoryItem: prefab => inventory.hasItemSpec(prefab),
      configureItem: entity => { inventory.entities.adopt(entity); inventory.configureItem(entity); },
      dropItem: (entity, position) => inventory.DropItem(entity, position),
      sprites: this.sprites, animationBaseUrl, scheduler: this.scheduler, componentUpdates: this.componentUpdates, physics,
      fx, moleWorld, lightflierWorld, handEquipment: inventory.handEquipment, bernieWorld,
      butterflyWorld, firefliesWorld,
      dropLoot: (items, position) => this.flingLoot(items, position),
      spawnGroundItem: (definition, position, options) => this.spawnGroundItem(definition, position, options),
    };
    const icons = Object.fromEntries(Object.entries(SAVE_CATALOG.items).filter(([id]) => !Object.hasOwn(GROUND_ART_DEFINITIONS, id))
      .map(([id, spec]) => [id, { atlas: spec.atlas ?? 'images/inventoryimages.xml', image: spec.icon }]));
    const ids = new Set(ITEM_PREFAB_IDS);
    this.prefabs.register(Object.fromEntries(Object.entries(itemPrefabs(this.world, icons)).filter(([id]) => ids.has(id))) as never);
    inventory.entities.bindSpawner(state => ids.has(state.itemId)
      ? this.prefabs.spawn(state.itemId, ORIGIN, { id: state.entityId ?? newItemEntityId(), components: { stack: state } }) as unknown as ItemEntity
      : undefined);
    // DefaultBurntFn's ash.
    this.stopAsh = worldEvents?.on('spawnAsh', position => { this.spawnGroundItem({ ...SAVE_CATALOG.items.ash, itemId: 'ash', count: 1 }, position); });
  }

  get entities(): ItemEntityRegistry { return this.inventory.entities; }

  /** The archive owner the manager's sprites draw from, so a rendering test can compose its instance atlases at once. */
  get archives(): SpriteResources['archives'] {
    return (this.prefabs as unknown as { readonly resources: SpriteResources }).resources.archives;
  }

  /** SpawnSaveRecord of an item record, as the registry restores it: the stack and the prefab's own records. */
  spawnFromSave(id: string, definition: GroundItemDefinition, position: ReadonlyVector3): THREE.Group {
    const { entity: _entity, name: _name, icon: _icon, atlas: _atlas, torchLit, lanternOn, playbackRemaining, ...stack } = definition;
    const record: PrefabSaveRecord = {
      id, transform: { position: [position.x, position.y, position.z], rotationY: 0 },
      components: { stack: { ...stack, entityId: undefined } as InventoryStack,
        ...torchLit ? { torch: { lit: true } } : {}, ...lanternOn === undefined ? {} : { lantern: { ison: lanternOn } },
        ...playbackRemaining === undefined ? {} : { phonograph: { remainingSeconds: playbackRemaining } } },
    };
    const inst = this.prefabs.spawn(definition.itemId, position, record);
    this.inventory.entities.adopt(inst as unknown as ItemEntity);
    return inst.transform.model;
  }

  spawnGroundItem(definition: GroundItemDefinition, position: ReadonlyVector3, options?: GroundSpawnOptions): ItemEntity {
    return spawnGroundStack(this.world, definition, position, options);
  }

  flingLoot(definitions: readonly GroundItemDefinition[], position: ReadonlyVector3, launch?: () => LootLaunch): void {
    flingLoot(this.world, definitions, position, launch);
  }

  /** DROP: the inst the holder lets go of is set down at `position`, or a stack the definition describes is spawned there. */
  drop(definition: GroundItemDefinition, position: ReadonlyVector3, take: () => boolean | ItemEntity): boolean {
    const taken = take();
    if (!taken) return false;
    if (taken === true) { this.spawnGroundItem(definition, position); return true; }
    taken.setPosition(position.x, 0, position.z);
    taken.components.inventoryitem.OnDropped();
    return true;
  }

  /** The item records Ents saves: insts in the scene, not held. */
  exportRecords(): PrefabSaveRecord[] {
    return this.prefabs.exportRecords().map(({ record }) => record);
  }

  /** The same records as a save's `world.entities` holds them, by prefab. */
  exportEntities(): Record<string, PrefabSaveRecord[]> {
    const entities: Record<string, PrefabSaveRecord[]> = {};
    for (const { prefabId, record } of this.prefabs.exportRecords()) (entities[prefabId] ??= []).push(record);
    return entities;
  }

  /** SpawnSaveRecord of one saved item record, as the scene's registry restores it. */
  restore(prefabId: string, record: SavedEntity): THREE.Group {
    return this.prefabs.spawn(prefabId, new THREE.Vector3(...record.transform.position), record).transform.model;
  }

  /** Restore every item record among a saved world's entities. */
  restoreEntities(entities: Readonly<Record<string, readonly SavedEntity[]>>): THREE.Group[] {
    const ids = new Set(ITEM_PREFAB_IDS);
    return Object.entries(entities).filter(([id]) => ids.has(id)).flatMap(([id, records]) => records.map(record => this.restore(id, record)));
  }

  /**
   * The item prefabs' registration with an EntityRegistry, as the scene registers them on its shared manager.
   * `c_spawn` puts an item at `spawnPosition`, under `spawnId`'s entity ID when the test names one.
   */
  registration(spawnPosition: (prefab: string) => ReadonlyVector3, spawnId?: (prefab: string) => string): EntityRegistration<string> {
    return {
      restore: (id, record) => this.restore(id, record),
      debugSpawn: id => this.prefabs.spawn(id, spawnPosition(id), spawnId && { id: spawnId(id), components: {} }).transform.model,
      exportRecords: () => this.prefabs.exportRecords(),
      dispose: () => this.dispose(),
    };
  }

  /** The items lying in the world, in spawn order, as the reskin tool's target views. */
  get reskinTargets() {
    return [...this.inventory.entities.values()].filter(inst => !inst.isRemoved && !inst.inlimbo && this.prefabs.get(inst.id) === inst as unknown)
      .map(inst => instanceReskinTarget(inst as unknown as PrefabInstance) as ReskinTarget & { readonly model: THREE.Group });
  }

  *iteratePrefabPositions(prefab: string): IterableIterator<ReadonlyVector3> {
    for (const inst of this.prefabs.instances(prefab)) if (!inst.inlimbo) yield inst.position;
  }

  get renderEntities() { return this.displays.renderEntities; }

  update(dt: number, cameraQuaternion?: THREE.Quaternion): void {
    if (this.ownsScheduler && dt > 0) this.scheduler.advance(dt);
    this.componentUpdates.update(dt);
    this.displays.update(dt, cameraQuaternion);
  }

  private disposed = false;
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAsh?.();
    this.inventory.entities.bindSpawner(undefined);
    this.prefabs.dispose();
    this.displays.dispose();
    this.sprites.dispose();
    this.componentUpdates.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();
  }
}

/** The item inst a ground model draws. */
export function itemAt(model: THREE.Object3D): ItemEntity {
  const inst = prefabInstance<ItemEntity>(model);
  if (!inst) throw new Error('No item inst draws this model');
  return inst;
}

/** The item prefabs' records among a world's saved entities, by prefab as `exportEntities` lists them. */
export function itemEntities<Record_>(entities: Readonly<Record<string, readonly Record_[]>>): Record<string, Record_[]> {
  const ids = new Set(ITEM_PREFAB_IDS);
  return Object.fromEntries(Object.entries(entities).filter(([id, records]) => ids.has(id) && records.length).map(([id, records]) => [id, [...records]]));
}
