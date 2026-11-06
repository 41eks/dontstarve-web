import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { BindTileMapSize, DisposeTileStates, GetTileStateAtPoint } from '../../componets/src/tileManager';
import { createMemo, createSignal, type TileStateQuery } from '../../signals/src';
import { bindTestWorld } from './worldContentFixture';
import { mushtreePrefabs, type MushtreeInstance, type MushtreeSpawnId } from '../../prefab/src/mushtree';
import { FireFxHost } from '../../prefab/src/treeFire';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { PlacementSaveRecord } from '../../prefab/src/saveRecord';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { createInventoryStore } from '../../../src/inventory';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { createClusterSaveZip } from '../../../src/save/download';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { workTargets } from './workTargets';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function setup(season: 'summer' | 'autumn' | 'winter' = 'autumn', tickingarea?: TileStateQuery) {
  const scheduler = new GameTimeScheduler(), bound = bindTestWorld(scheduler, tickingarea), seasonSignal = bound.season;
  seasonSignal.set({ season, progress: 0 });
  const ash: THREE.Vector3[] = [], drops: { itemId: string; count: number }[] = [];
  const scene = new THREE.Scene(), displays = new PrefabDisplayGroup(scene), fire = FireFxHost.create('/dst/data/anim');
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { tickingarea });
  prefabs.register(mushtreePrefabs({ scheduler, fire, tickingarea, getWatchWorldContent: bound.getWatchWorldContent,
    worldEvents: { emit: (_name: string, position: THREE.Vector3) => ash.push(position) } as never,
    dropLoot: items => drops.push(...items), spawnPrefab: (id, position) => prefabs.spawn(id, position) }));
  const registry = new EntityRegistry([], prefabs, () => new THREE.Vector3(12, 0, -6)), inventory = createInventoryStore([]);
  registry.registerPrefabs(PREFAB_DEFINITIONS.mushtrees);
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  return { scheduler, seasonSignal, ash, drops, scene, prefabs, registry, inventory,
    spawn: (id: MushtreeSpawnId, position: THREE.Vector3, saved?: Pick<PlacementSaveRecord, 'id' | 'components'>) => prefabs.spawn(id, position, saved) as MushtreeInstance,
    record: () => prefabs.exportRecords()[0].record,
    find: (id: string) => scene.children.map(model => prefabInstance<PrefabInstance>(model)!).find(inst => inst?.prefab === id),
    save: () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
      playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG),
    dispose() { registry.dispose(); prefabs.dispose(); displays.dispose(); fire.dispose(); inventory.dispose(); bound.unbind(); scheduler.dispose(); } };
}

it('loads a burnt tree as ash and releases its independent burnt FX on game time without animation updates', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  const awake = createSignal(true), s = setup('autumn', () => createMemo(() => awake.get()));
  try {
    const tree = s.spawn('mushtree_moon', new THREE.Vector3(5, 0, 7), { id: 'burnt-mushroom', components: { mushtree: { burnt: true } } });
    expect(tree.status.peek()).toBe('removed');
    expect(s.prefabs.exportRecords()).toEqual([]);
    expect(s.ash).toEqual([new THREE.Vector3(5, 0, 7)]);
    const fx = s.find('mushtree_moon_burntfx')!;
    expect(fx.listTags().filter(tag => tag !== 'tickingarea')).toEqual(['FX']);
    expect(fx.persists).toBe(false);
    awake.set(false); await settle();
    expect(fx.status.peek()).toBe('asleep');
    s.scheduler.advance(10);
    expect(fx.status.peek()).toBe('removed');
    awake.set(true); await settle();
    expect(s.scene.children).toEqual([]);
  } finally { s.dispose(); }
});

it('chops a moon mushtree into a diggable stump, drops catalogued loot, and keeps the stump through c_save and reload', async () => {
  const s = setup(); let zip!: Uint8Array, records!: ReturnType<EntityRegistry['exportRecords']>;
  try {
    expect((await executeDebugCommand('c_spawn("mushtree_moon")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    const tree = s.find('mushtree_moon') as MushtreeInstance;
    expect(tree.listTags().filter(tag => tag !== 'tickingarea')).toEqual(['blocker', 'cavedweller', 'mushtree', 'plant', 'shelter', 'tree', 'canlight']);
    expect(tree.minimap.icon).toBe('mushtree_moon.png');
    await prefabDisplay(tree.transform.model)!.artLoaded();
    const axe = s.inventory.entities.create({ itemId: 'axe', count: 1 });
    const [chop] = workTargets('CHOP');
    for (let i = 0; i < 14; i++) expect(performToolWork('CHOP', chop.entity, {}, axe)).toBe(true);
    expect(workTargets('DIG')).toEqual([]);
    expect(performToolWork('CHOP', chop.entity, {}, axe)).toBe(true);
    // moon_cap has no ground item yet, so only the two logs are dropped.
    expect(s.drops).toEqual([{ itemId: 'log', count: 2 }]);
    expect(tree.minimap.icon).toBe('mushroom_tree_stump.png');
    expect(tree.hasTag('shelter')).toBe(false);
    expect(workTargets('DIG')).toHaveLength(1);
    records = s.registry.exportRecords();
    const [record] = records.mushtree_moon;
    expect(record.components).toEqual({ mushtree: { stump: true, decay: expect.any(Number) } });
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, async () => {
      zip = await createClusterSaveZip(s.save(), 'forest');
    })).ok).toBe(true);
    s.drops.length = 0;
    expect(workTargets('DIG')[0].work()).toBe(true);
    expect(s.drops).toEqual([{ itemId: 'log', count: 1 }]);
    expect(s.prefabs.exportRecords()).toEqual([]);
  } finally { s.dispose(); }
  const files = unzipSync(zip), text = strFromU8(files['Cluster_1/Master.json']);
  const exported = JSON.parse(text) as { session: { playerFile: string } };
  const { player } = JSON.parse(strFromU8(files[`Cluster_1/${exported.session.playerFile}`])) as { player: unknown };
  const saved = deserializeSave(text, SAVE_CATALOG, player), second = setup();
  try {
    expect(saved.world.entities.mushtree_moon).toEqual(records.mushtree_moon);
    await second.registry.restoreAll({ mushtree_moon: saved.world.entities.mushtree_moon });
    const tree = second.find('mushtree_moon') as MushtreeInstance;
    expect(tree.stump).toBe(true);
    expect(tree.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_stump', loop: true });
    expect(second.registry.exportRecords()).toEqual(records);
  } finally { second.dispose(); }
}, 30000);

it('a _stump spawn is a stump from its first frame, with no body', async () => {
  const s = setup();
  try {
    const stump = s.spawn('mushtree_tall_stump', new THREE.Vector3(1, 0, 2));
    expect(stump.prefab).toBe('mushtree_tall');
    expect(stump.stump).toBe(true);
    expect(stump.physicsBody).toBeUndefined();
    expect(s.record().components.mushtree).toMatchObject({ stump: true });
    expect(s.record().components.growable?.stage).toBeGreaterThanOrEqual(1);
  } finally { s.dispose(); }
});

it('blooms a medium mushtree in summer, grows by stage and restores the saved build and growth', async () => {
  const s = setup('summer');
  try {
    s.spawn('mushtree_medium', new THREE.Vector3(1, 0, 2));
    expect(s.record().components.mushtree?.treestate).toBe('bloom');
    // Leaving summer: the tree returns to normal after a random delay of up to three segments plus the change animation.
    s.seasonSignal.set({ season: 'autumn', progress: 0 });
    await settle();
    s.scheduler.advance(95);
    expect(s.record().components.mushtree?.treestate).toBe('normal');

    const record = s.record();
    expect(record.components.growable?.stage).toBeGreaterThanOrEqual(1);
    const restored = setup('summer');
    try {
      restored.spawn('mushtree_medium', new THREE.Vector3(...record.transform.position), record);
      // OnLoad: the saved normal build, then summer blooms it again after the random delay.
      expect(restored.record().components.mushtree?.treestate).toBe('normal');
      expect(restored.record().components.growable).toEqual(record.components.growable);
    } finally { restored.dispose(); }
  } finally { s.dispose(); }
}, 20000);

it('blooms a tall mushtree in winter only and carries webbable', async () => {
  const s = setup('winter');
  try {
    const tree = s.spawn('mushtree_tall', new THREE.Vector3(1, 0, 2));
    expect(s.record().components.mushtree?.treestate).toBe('bloom');
    expect(tree.minimap.icon).toBe('mushroom_tree.png');
    expect(tree.hasTag('webbable')).toBe(true);
  } finally { s.dispose(); }
}, 20000);

it('a chopped tree stops following the season but its stump keeps following the ticking area', async () => {
  const player = createSignal<THREE.Vector3 | undefined>(new THREE.Vector3());
  const stopGrid = BindTileMapSize(960);
  // One query for the season gate and the entity's activity, as worldState binds it.
  const tickingarea = GetTileStateAtPoint(player as never);
  const s = setup('autumn', tickingarea);
  try {
    const tree = s.spawn('mushtree_medium', new THREE.Vector3(5, 0, 7));
    await prefabDisplay(tree.transform.model)!.artLoaded();
    const axe = s.inventory.entities.create({ itemId: 'axe', count: 1 });
    const [chop] = workTargets('CHOP');
    while (performToolWork('CHOP', chop.entity, {}, axe));
    expect(s.record().components.mushtree?.stump).toBe(true);
    player.set(new THREE.Vector3(400, 0, 0));
    await settle();
    expect(tree.status.peek()).toBe('asleep');
    player.set(new THREE.Vector3());
    await settle();
    expect(tree.status.peek()).toBe('active');
  } finally { s.dispose(); DisposeTileStates(player as never); stopGrid(); }
});
