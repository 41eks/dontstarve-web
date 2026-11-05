import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpriteResources } from '../../display/src';
import { inventorySlotAddress } from '../../inventory/src';
import { createEmptyEntity } from '../../prefab/src/prefabInstance';
import { GroundItemAssets, createGroundItemFactory } from '../../prefab/src/groundItems';
import type { GroundPrefabContext } from '../../prefab/src/groundPrefab';
import { createBuildingContainer } from '../../prefab/src/containers';
import { createPickupDoer } from '../../stategraphs/src/pickup';
import { executeDebugCommand } from '../../../src/debugCommands';
import { createWorldState } from '../../../src/worldState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { INVENTORY_RECIPES } from '../../ui/src/categories/shared';
import { createPickupInventory } from './pickupFixture';
import { testMap } from './tileMapFixture';
import { GroundItemManager } from '../../prefab/src/groundItemManager';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { createInventoryStore } from '../../../src/inventory';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const ITEM = 'nightmare_timepiece', SLOT = inventorySlotAddress(0);

function setup(prefab: 'cave' | 'forest' = 'cave') {
  const world = createWorldState({ map: testMap(48), elapsedSeconds: 0, systems: {}, prefab });
  const inventory = createPickupInventory();
  const { instance: player, display } = createEmptyEntity('wilson');
  createPickupDoer(display.model, inventory);
  return { world, inventory, player, dispose() { inventory.dispose(); display.dispose(); world.dispose(); } };
}

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('nightmare_timepiece.lua', () => {
  it('is a single unstackable c_give item with its source recipe', async () => {
    const s = setup();
    try {
      expect(SAVE_CATALOG.items[ITEM]).toMatchObject({ icon: 'nightmare_timepiece.tex', maxStack: 1 });
      expect(INVENTORY_RECIPES[ITEM]).toBeDefined();
      expect((await executeDebugCommand(`c_give("${ITEM}", 2)`, s.inventory)).ok).toBe(true);
      expect(s.inventory.count(ITEM)).toBe(2);
      expect(s.inventory.get(SLOT)).toMatchObject({ itemId: ITEM, count: 1 });
    } finally { s.dispose(); }
  });

  it('shows and reports the nightmare phase through its clip, inventory image and status', async () => {
    const s = setup();
    try {
      s.inventory.add(ITEM, 1);
      const entity = s.inventory.getEntity(SLOT)!, clock = s.world.nightmareclock!;
      const image = () => entity.components.inventoryitem.image.peek()?.icon;
      const status = () => (entity.components as unknown as { inspectable: { getstatus(): string } }).inspectable.getstatus();
      const clip = () => entity.sprite.sprite.peek().clip;
      await flush();
      expect(clip()).toMatchObject({ name: 'idle_1', loop: false });
      expect(image()).toBe('nightmare_timepiece.tex');
      expect(status()).toBe('CALM');

      clock.SetPhase('warn');
      await flush();
      expect(clip().name).toBe('idle_2');
      expect(image()).toBe('nightmare_timepiece_warn.tex');
      expect(status()).toBe('WARN');

      clock.SetPhase('wild');
      await flush();
      expect(clip().name).toBe('idle_3');
      expect(image()).toBe('nightmare_timepiece_nightmare.tex');
      expect(status()).toBe('WAXING');
      s.world.scheduler.advance(clock.remainingTimeInPhase / 2);
      expect(status()).toBe('STEADY');
      s.world.scheduler.advance(clock.remainingTimeInPhase * .8);
      expect(status()).toBe('WANING');

      clock.SetPhase('dawn');
      await flush();
      expect(clip().name).toBe('idle_1');
      expect(image()).toBe('nightmare_timepiece.tex');
      expect(status()).toBe('DAWN');
    } finally { s.dispose(); }
  });

  it('reports no magic where the world has no nightmare clock', async () => {
    const s = setup('forest');
    try {
      s.inventory.add(ITEM, 1);
      const entity = s.inventory.getEntity(SLOT)!;
      await flush();
      expect(entity.sprite.sprite.peek().clip.name).toBe('idle_1');
      expect((entity.components as unknown as { inspectable: { getstatus(): string } }).inspectable.getstatus()).toBe('NOMAGIC');
    } finally { s.dispose(); }
  });

  it('a saved watch built before its world follows the phase once the item is bound to the world', async () => {
    const inventory = createPickupInventory();
    inventory.add(ITEM, 1);
    const entity = inventory.getEntity(SLOT)!;
    const world = createWorldState({ map: testMap(48), elapsedSeconds: 0, systems: {}, prefab: 'cave' });
    try {
      inventory.entities.bindPerishWorld({ perishClock: world.perishClock, scheduler: world.scheduler });
      world.nightmareclock!.SetPhase('wild');
      await flush();
      expect(entity.sprite.sprite.peek().clip.name).toBe('idle_3');
    } finally { inventory.dispose(); world.dispose(); }
  });

  it('marks its holder as a nightmare tracker until the holder has no watch left', () => {
    const s = setup();
    try {
      const tracking = () => s.player.hasTag('nightmaretracker');
      expect(tracking()).toBe(false);
      s.inventory.add(ITEM, 2);
      expect(tracking()).toBe(true);
      const first = s.inventory.getEntity(SLOT)!, second = s.inventory.getEntity(inventorySlotAddress(1))!;
      // Moving inside the holder's own inventory changes nothing.
      expect(s.inventory.transfer(SLOT, inventorySlotAddress(5), 1)).toBe(true);
      expect(tracking()).toBe(true);
      s.inventory.DropItem(first);
      expect(tracking()).toBe(true);
      s.inventory.DropItem(second);
      expect(tracking()).toBe(false);

      // A chest is the watch's owner, not the player who put it there.
      s.inventory.GiveItem(second);
      expect(tracking()).toBe(true);
      const chest = createBuildingContainer('treasurechest', {});
      s.inventory.registerContainer('world:chest', chest);
      expect(s.inventory.transfer(inventorySlotAddress(0), { containerId: 'world:chest', slotKey: '0' }, 1)).toBe(true);
      expect(tracking()).toBe(false);
      expect(s.inventory.transfer({ containerId: 'world:chest', slotKey: '0' }, inventorySlotAddress(0), 1)).toBe(true);
      expect(tracking()).toBe(true);

      // owner:ListenForEvent("onremove", toground, inst)
      second.remove();
      expect(tracking()).toBe(false);
      first.destroy();
    } finally { s.dispose(); }
  });

  it('restores the tag from a saved inventory, as inventory.lua OnLoad gives the item back', () => {
    const s = setup();
    try {
      s.inventory.add(ITEM, 1);
      const saved = s.inventory.exportState();
      s.inventory.getEntity(SLOT)!.remove();
      expect(s.player.hasTag('nightmaretracker')).toBe(false);
      s.inventory.replaceState(saved, INVENTORY_RECIPES);
      expect(s.inventory.count(ITEM)).toBe(1);
      expect(s.player.hasTag('nightmaretracker')).toBe(true);
    } finally { s.dispose(); }
  });

  it('saves a spawned watch and a held one through c_save', async () => {
    const world = createWorldState({ map: testMap(48), elapsedSeconds: 0, systems: {}, prefab: 'cave' });
    const inventory = createInventoryStore([]), scene = new THREE.Scene(), player = new THREE.Group();
    const ground = new GroundItemManager(scene, new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as THREE.WebGLRenderer,
      '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
    const registry = new EntityRegistry();
    registry.register(PREFAB_DEFINITIONS.groundItems, {
      restore: (_, record) => ground.spawnFromSave(record.id, {
        ...SAVE_CATALOG.items[record.components.stack!.itemId], ...record.components.stack! }, new THREE.Vector3(...record.transform.position)),
      debugSpawn: id => ground.spawnFromSave(`dug:${id}`, { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, player.position),
      exportRecords: () => ground.exportRecords().map(record => ({ prefabId: 'ground_item', record })),
      dispose: () => ground.dispose(),
    });
    try {
      expect((await executeDebugCommand(`c_spawn("${ITEM}"); c_give("${ITEM}")`, inventory, id => registry.spawn(id))).ok).toBe(true);
      let json = '';
      const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
      expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
        json = serializeSave(template, { entities: { ground_item: ground.exportRecords() }, inventory: inventory.exportState(),
          elapsedSeconds: 0, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
      })).ok).toBe(true);
      const saved = deserializeSave(json, SAVE_CATALOG);
      expect(saved.world.entities.ground_item.map(record => record.components.stack!.itemId)).toEqual([ITEM]);
      expect(JSON.stringify(saved.players.local)).toContain(ITEM);
    } finally { registry.dispose(); inventory.dispose(); world.dispose(); }
  });

  it('draws the phase clip on the ground, also in a visual made after the phase changed', async () => {
    const s = setup();
    const assets = new GroundItemAssets();
    s.inventory.add(ITEM, 1);
    const entity = s.inventory.extract(SLOT, 1)!;
    s.world.nightmareclock!.SetPhase('wild');
    await flush();
    const factory = createGroundItemFactory({ sprites: new SpriteResources(undefined, undefined, assets) } as GroundPrefabContext);
    const visual = factory.create({ ...entity.snapshot(), name: '铥矿徽章', icon: 'nightmare_timepiece.tex' }, entity);
    try {
      await visual.display.artLoaded();
      await flush();
      expect(entity.sprite.currentAnimation).toBe('idle_3');
      const mesh = visual.model.children[0].children[0].children[0] as THREE.Mesh;
      expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
    } finally { visual.dispose(); entity.destroy(); assets.dispose(); s.dispose(); }
  });
});
