import { prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { MarbleShrubManager } from '../../prefab/src/marbleshrub';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { MarbleBeanSaplingManager } from '../../prefab/src/marblebean_sapling';
import { GroundItemManager } from '../../../src/groundItems';
import { createInventoryStore } from '../../../src/inventory';
import { inventorySlotAddress } from '../../inventory/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { bindTestWorld } from './worldContentFixture';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const inventory = createInventoryStore([]), scene = new THREE.Scene(), player = new THREE.Group(), physics = new CANNON.World();
  const scheduler = new GameTimeScheduler();
  const ground = new GroundItemManager(scene, new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
  const spawnGroundItem: GroundItemManager['spawnGroundItem'] = (definition, position, options) => ground.spawnGroundItem(definition, position, options);
  const { snowLevel, getWatchWorldContent } = bindTestWorld(scheduler);
  const shrubs = new MarbleShrubManager(scene, { scheduler, physics, getWatchWorldContent, spawnGroundItem });
  const saplings = new MarbleBeanSaplingManager(scene, { scheduler, shrubs, spawnGroundItem });
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.marbleShrubs, {
    restore: (_, record) => shrubs.spawn('marbleshrub', new THREE.Vector3(...record.transform.position),
      { id: record.id, transform: record.transform, components: { growable: record.components.growable!, marbleShrub: record.components.marbleShrub! } }),
    debugSpawn: id => shrubs.spawn(id, player.position),
    exportRecords: () => shrubs.exportRecords().map(record => ({ prefabId: 'marbleshrub', record })), dispose: () => shrubs.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.marbleBeanSaplings, {
    restore: (_, record) => saplings.spawn(new THREE.Vector3(...record.transform.position), record),
    debugSpawn: () => saplings.spawn(player.position),
    exportRecords: () => saplings.exportRecords().map(record => ({ prefabId: 'marblebean_sapling', record })), dispose: () => saplings.dispose(),
  });
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    restore: () => { throw new Error('unused'); },
    debugSpawn: id => ground.spawnFromSave(`command:${id}`, { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, player.position),
    exportRecords: () => ground.exportRecords().map(record => ({ prefabId: 'ground_item', record })), dispose: () => ground.dispose(),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: { marbleshrub: shrubs.exportRecords(), marblebean_sapling: saplings.exportRecords(), ground_item: ground.exportRecords() },
    inventory: inventory.exportState(), elapsedSeconds: scheduler.now, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  const advance = (seconds: number) => {
    scheduler.advance(seconds); shrubs.update(seconds, new THREE.Quaternion()); saplings.update(seconds, new THREE.Quaternion());
  };
  return { snowLevel, inventory, scene, scheduler, ground, shrubs, saplings, registry, save, advance,
    dispose: () => { registry.dispose(); inventory.dispose(); scheduler.dispose(); } };
}

const dropped = (s: ReturnType<typeof setup>) => s.ground.exportRecords().map(record => record.components.stack?.itemId).sort();

it('plants a marblebean, digs it back up, and grows it into a mineable shrub that survives save/load', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  const s = setup(), restored = setup();
  try {
    expect((await executeDebugCommand('c_give("marblebean",3)', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    const point = new THREE.Vector3(12, 0, 24);
    const item = s.inventory.extract(inventorySlotAddress(0), 1, s.inventory.getEntity(inventorySlotAddress(0))!)!;
    expect(item.components.deployable!.mode).toBe('PLANT');
    expect(item.components.deployable!.Deploy(point, { position: point, PushEvent: vi.fn() }, {
      canDeployPlant: () => true, deployPlant: () => s.saplings.transplant(point),
    })).toBe(true);
    expect(s.inventory.count('marblebean')).toBe(2);
    // The shovel's DIG finishes the one-work sapling and drops its only loot, then cancels growth.
    const [dig] = s.saplings.digTargets;
    expect(dig.dig()).toBe(true);
    await vi.waitFor(() => expect(dropped(s)).toEqual(['marblebean']));
    expect(s.saplings.digTargets).toEqual([]);

    await s.saplings.spawn(point);
    s.advance(224); expect(s.shrubs.exportRecords()).toEqual([]);
    s.advance(1);
    // GetRandomWithVariance at .5 gives 225 s; growfromseed rolls shape 2 and colour .75, and only the shrub remains.
    expect(s.saplings.exportRecords()).toEqual([]);
    const [grown] = s.shrubs.exportRecords();
    expect(grown.components).toEqual({ growable: { stage: 1, time: 2700 }, marbleShrub: { shapenumber: 2, color: .75 } });
    s.advance(2700 * 2);
    expect(s.shrubs.exportRecords()[0].components.growable.stage).toBe(3);

    // marbleshrub<shape>.png, MiniMapEntity priority -1; the snow layer adds geometry once the level reaches .015.
    const model = s.shrubs.mineTargets[0].model;
    const minimap = prefabInstance(model)!.minimap.peek();
    expect([minimap.icon, minimap.priority, model.position.x]).toEqual(['marbleshrub2.png', -1, 12]);
    const sprite = prefabInstance(model)!.sprite;
    // growfromseed spawns the shrub at once; its display draws it once the art has loaded.
    await prefabDisplay(model).artLoaded();
    const vertices = () => { let count = 0; model.traverse(o => { if (o instanceof THREE.Mesh) count += o.geometry.drawRange.count === Infinity ? o.geometry.index?.count ?? 0 : o.geometry.drawRange.count; }); return count; };
    const bare = vertices();
    s.snowLevel.set(.02);
    // Appearance declarations update synchronously; the display applies them on its own schedule.
    expect(sprite.sprite.peek().appearance.get('archive-hidden:snow')).toMatchObject({ hidden: false });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(vertices()).toBeGreaterThan(bare);
    s.snowLevel.set(0);
    expect(sprite.sprite.peek().appearance.get('archive-hidden:snow')).toMatchObject({ hidden: true });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(vertices()).toBe(bare);

    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG), record = saved.world.entities.marbleshrub[0];
    await restored.shrubs.spawn('marbleshrub', new THREE.Vector3(...record.transform.position),
      { id: record.id, transform: record.transform, components: { growable: record.components.growable!, marbleShrub: record.components.marbleShrub! } });
    expect(restored.shrubs.exportRecords()).toEqual([s.shrubs.exportRecords()[0]]);

    // Tall shrubs need ten works; the pickaxe MINE roll at exactly .5 keeps the marble branch.
    const pickaxe = s.inventory.entities.create({ itemId: 'pickaxe', count: 1 });
    const [mine] = s.shrubs.mineTargets;
    for (let i = 0; i < 9; i++) expect(performToolWork('MINE', mine.entity, {}, pickaxe)).toBe(true);
    expect(s.shrubs.exportRecords()).toHaveLength(1);
    expect(performToolWork('MINE', mine.entity, {}, pickaxe)).toBe(true);
    expect(s.shrubs.mineTargets).toEqual([]); expect(s.shrubs.exportRecords()).toEqual([]);
    s.shrubs.dispose();
    expect(prefabInstance(model)!.status.peek()).toBe('removed');
    const removedAppearance = sprite.sprite.peek();
    s.snowLevel.set(.02);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sprite.sprite.peek()).toBe(removedAppearance);
    await vi.waitFor(() => expect(dropped(s)).toEqual(['marble', 'marble', 'marblebean']));
  } finally { s.dispose(); restored.dispose(); }
}, 20000);
