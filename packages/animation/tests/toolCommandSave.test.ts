import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { GroundItemManager } from '../../../src/groundItems';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { createPickupInventory } from './pickupFixture';
import { equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { performPickupAction, createPickupDoer } from '../../stategraphs/src/pickup';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('spawns/gives tool and wall-loot IDs, then exports and reloads identities, positions, quantities and uses', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const inventory = createPickupInventory();
  const scene = new THREE.Scene(), player = new THREE.Group();
  player.position.set(3, 0, -6);
  const manager = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
    { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer, '/dst/data/databundles/images.zip',
    inventory, '/dst/data/anim', player);
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    debugSpawn: id => manager.spawnFromSave(`spawn:${id}`, { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, player.position),
    restore: (_prefab, record) => manager.spawnFromSave(record.id,
      { ...SAVE_CATALOG.items[record.components.stack!.itemId], ...record.components.stack! }, new THREE.Vector3(...record.transform.position)),
    exportRecords: () => manager.exportRecords().map(record => ({ prefabId: 'ground_item', record })),
    dispose: () => manager.dispose(),
  });
  const restoredInventory = createPickupInventory();
  let restored: GroundItemManager | undefined;
  try {
    const ids = ['dreadstone', 'wagpunk_bits', 'hammer', 'bugnet', 'reskin_tool', 'pickaxe', 'goldenpickaxe'];
    for (const id of ids) {
      expect((await executeDebugCommand(`c_spawn("${id}")`, inventory, prefab => registry.spawn(prefab))).ok).toBe(true);
      expect((await executeDebugCommand(`c_give("${id}", ${id === 'dreadstone' || id === 'wagpunk_bits' ? 3 : 1})`, inventory)).ok).toBe(true);
    }
    const hammer = manager.entities.get('spawn:hammer')!;
    expect(hammer.components.finiteuses.use(1)).toBe(true);
    expect(hammer.hasTag('HAMMER_tool')).toBe(true);
    const pickaxe = manager.entities.get('spawn:pickaxe')!;
    expect(pickaxe.components.finiteuses.useForAction('MINE')).toBe(true);
    const golden = manager.entities.get('spawn:goldenpickaxe')!;
    expect(golden.components.finiteuses.useForAction('MINE')).toBe(true);
    const change = await manager.reskinTargets.find(target => target.id === golden.id)!.prepareNextSkin();
    expect(change.apply()).toBe(true);
    change.dispose();
    const skinId = golden.skinId;
    expect(skinId).toBeDefined();
    const hand = equipmentSlotAddress('hand');
    const pickup = () => performPickupAction(manager.renderEntities.find(({ object }) => object.userData.entityId === golden.id)!
      .object.userData.pickupTarget, createPickupDoer(player, inventory));
    expect(pickup()).toBe(true);
    expect(inventory.getEntity(hand)).toBe(golden);
    expect(await manager.drop({ ...SAVE_CATALOG.items.goldenpickaxe, ...golden.snapshot() }, player.position,
      () => inventory.extract(hand, 1, golden) ?? false)).toBe(true);
    expect(golden.components.finiteuses.remaining).toBe(32.75);
    expect(golden.skinId).toBe(skinId);
    expect(pickup()).toBe(true);
    inventory.getEntity(inventorySlotAddress(5))!.components.finiteuses.useForAction('MINE');
    const before = registry.exportRecords(), held = inventory.exportState();
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
      json = serializeSave(template, { entities: before, inventory: held, elapsedSeconds: 12.5,
        playerTransform: { position: [3, 0, -6], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG);
    expect(saved.world.entities).toEqual(before);
    restoredInventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    restored = new GroundItemManager(new THREE.Scene(), new THREE.PerspectiveCamera(),
      { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer, '/dst/data/databundles/images.zip',
      restoredInventory, '/dst/data/anim', player);
    for (const record of saved.world.entities.ground_item) await restored.spawnFromSave(record.id,
      { ...SAVE_CATALOG.items[record.components.stack!.itemId], ...record.components.stack! }, new THREE.Vector3(...record.transform.position));
    expect(restored.exportRecords()).toEqual(before.ground_item);
    expect(restored.entities.get('spawn:hammer')!.components.finiteuses.remaining).toBe(74);
    expect(restored.entities.get('spawn:hammer')!.hasTag('HAMMER_tool')).toBe(true);
    expect(restored.entities.get('spawn:pickaxe')!.components.finiteuses.remaining).toBe(32);
    expect(restoredInventory.getEntity(hand)!.snapshot()).toEqual(golden.snapshot());
    expect(restoredInventory.getEntity(hand)!.components.finiteuses.remaining).toBe(32.75);
    expect(restoredInventory.getEntity(hand)!.hasTag('MINE_tool')).toBe(true);
    for (let index = 0; index < ids.length; index++) {
      expect(restoredInventory.getEntity(inventorySlotAddress(index))!.snapshot())
        .toEqual(inventory.getEntity(inventorySlotAddress(index))!.snapshot());
    }
  } finally { registry.dispose(); restored?.dispose(); inventory.dispose(); restoredInventory.dispose(); }
});
