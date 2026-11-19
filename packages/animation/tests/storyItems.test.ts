import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { ItemWorldFixture, itemEntities } from './itemWorldFixture';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import ground_catalog from '../../prefab/src/groundItems.json' with { type: 'json' };
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { createInventoryStore } from './testInventory';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const ART_IDS = ['foliage', 'beardhair', 'cookingrecipecard', 'scrapbook_page', 'blueprint', 'trinket_1', 'trinket_46'];

it('exposes the loot prefabs with their own ground clips, icon atlases and stack sizes, and saves spawned ones', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const inventory = createInventoryStore([]), scene = new THREE.Scene(), player = new THREE.Group();
  const ground = new ItemWorldFixture(scene, new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.groundItems, ground.registration(() => player.position, id => `dug:${id}`));
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
    // Each spawned item lies awake in the scene, among the entries the renderer sorts.
    expect(ground.renderEntities).toHaveLength(4);
    const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
    const saved = deserializeSave(serializeSave(template, { entities: ground.exportEntities(), inventory: inventory.exportSaved(),
      elapsedSeconds: 0, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG), SAVE_CATALOG);
    expect(Object.keys(itemEntities(saved.world.entities)).sort())
      .toEqual(['blueprint', 'foliage', 'scrapbook_page', 'trinket_32']);
  } finally { registry.dispose(); inventory.dispose(); }
});
