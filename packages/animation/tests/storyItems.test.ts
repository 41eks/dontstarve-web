import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { GroundItemManager } from '../../../src/groundItems';
import { createInventoryStore } from '../../../src/inventory';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import ground_catalog from '../../prefab/src/groundItems.json' with { type: 'json' };
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const ART_IDS = ['foliage', 'beardhair', 'cookingrecipecard', 'scrapbook_page', 'blueprint', 'trinket_1', 'trinket_46'];

it('exposes the loot prefabs with their own ground clips, icon atlases and stack sizes, and saves spawned ones', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
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
    expect(ground_catalog.items.trinket_32).toMatchObject({ animationArchive: 'trinkets.zip', bank: 'trinkets', animation: '32', icon: 'trinket_32.tex' });
    expect(SAVE_CATALOG.items.trinket_46.atlas).toBe('images/inventoryimages.xml');
    expect(ground_catalog.items.blueprint).toMatchObject({ bank: 'blueprint', animation: 'idle' });
    expect(Object.keys(ground_catalog.items.blueprint.inventoryImageVariants)).toEqual(['blueprint_rare.tex']);
    expect(SAVE_CATALOG.items.scrapbook_page.atlas).toBe('images/inventoryimages3.xml');
    expect(SAVE_CATALOG.items.cookingrecipecard.name).not.toContain('{');
    expect(inventory.getItemSpec('trinket_1').maxStack).toBe(40);
    expect(inventory.getItemSpec('blueprint').maxStack).toBe(1);
    expect(inventory.getItemSpec('cookingrecipecard').maxStack).toBe(1);
    const given = await executeDebugCommand(`${ART_IDS.map(id => `c_give("${id}", 1)`).join(';')}`, inventory);
    expect(given.ok).toBe(true);
    for (const id of ART_IDS) expect(inventory.count(id)).toBe(1);
    const spawned = await executeDebugCommand(['foliage', 'trinket_32', 'blueprint', 'scrapbook_page'].map(id => `c_spawn("${id}")`).join(';'),
      inventory, id => registry.spawn(id));
    expect(spawned.ok).toBe(true);
    expect(ground.reskinTargets).toHaveLength(4);
    expect(ground.renderEntities).toEqual([]);
    const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
    const saved = deserializeSave(serializeSave(template, { entities: { ground_item: ground.exportRecords() }, inventory: inventory.exportState(),
      elapsedSeconds: 0, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG), SAVE_CATALOG);
    expect(saved.world.entities.ground_item.map(record => record.components.stack!.itemId).sort())
      .toEqual(['blueprint', 'foliage', 'scrapbook_page', 'trinket_32']);
  } finally { registry.dispose(); inventory.dispose(); }
});
