import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { bindTestWorld } from './worldContentFixture';
import { MushtreeManager, type MushtreeWorld } from '../../prefab/src/mushtree';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { createInventoryStore } from '../../../src/inventory';
import { performToolWork } from '../../stategraphs/src/componentactions';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function world(season: 'summer' | 'autumn' | 'winter' = 'autumn') {
  const scheduler = new GameTimeScheduler(), bound = bindTestWorld(scheduler), seasonSignal = bound.season;
  seasonSignal.set({ season, temperature: 20 });
  const ash: THREE.Vector3[] = [], drops: { itemId: string; count: number }[] = [];
  const mushWorld = { scheduler, scene: new THREE.Scene(), getWatchWorldContent: bound.getWatchWorldContent, worldEvents: { emit: (_name: string, position: THREE.Vector3) => ash.push(position) },
    dropLoot: (items: { itemId: string; count: number }[]) => drops.push(...items) } as unknown as MushtreeWorld;
  return { scheduler, seasonSignal, ash, drops, mushWorld };
}

it('chops a moon mushtree into a diggable stump, drops catalogued loot, and keeps the stump through save/load', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const { mushWorld, drops, scheduler } = world(), scene = new THREE.Scene(), inventory = createInventoryStore([]);
  const trees = new MushtreeManager(scene, mushWorld);
  try {
    const model = await trees.spawn('mushtree_moon', new THREE.Vector3(5, 0, 7));
    const mesh = model.children[0].children[0] as THREE.Mesh;
    expect(mesh.visible).toBe(false); // Idle is drawn by the shared instance batch.
    expect(trees.miniMapEntities.map(({ icon }) => icon)).toEqual(['mushtree_moon.png']);
    const axe = inventory.entities.create({ itemId: 'axe', count: 1 });
    const [chop] = trees.getChopTargets();
    for (let i = 0; i < 14; i++) expect(performToolWork('CHOP', chop.entity, {}, axe)).toBe(true);
    expect(mesh.visible).toBe(true); // Working uses the ordinary shared-frame mesh.
    for (let i = 0; i < 100 && mesh.visible; i++) trees.update(.1, new THREE.Quaternion());
    expect(mesh.visible).toBe(false); // Completing work rejoins idle instancing.
    expect(trees.getDigTargets()).toEqual([]);
    expect(performToolWork('CHOP', chop.entity, {}, axe)).toBe(true);
    expect(mesh.visible).toBe(true);
    // moon_cap has no ground item yet, so only the two logs are dropped.
    expect(drops).toEqual([{ itemId: 'log', count: 2 }]);
    const [dig] = trees.getDigTargets();
    expect(trees.miniMapEntities.map(({ icon }) => icon)).toEqual(['mushroom_tree_stump.png']);

    const [{ prefabId, record }] = trees.exportRecords();
    expect(prefabId).toBe('mushtree_moon');
    expect(record.components.mushtree?.stump).toBe(true);
    const restored = new MushtreeManager(new THREE.Scene(), world().mushWorld);
    try {
      await restored.spawn('mushtree_moon', new THREE.Vector3(...record.transform.position), record);
      expect(restored.exportRecords()[0].record.components.mushtree).toEqual({ stump: true, decay: record.components.mushtree!.decay });
    } finally { restored.dispose(); }

    drops.length = 0;
    expect(dig.dig()).toBe(true);
    expect(drops).toEqual([{ itemId: 'log', count: 1 }]);
    expect(trees.exportRecords()).toEqual([]);
    scheduler.advance(1);
  } finally { trees.dispose(); inventory.dispose(); }
}, 20000);

it('blooms a medium mushtree in summer, grows by stage and restores the saved build and growth', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const { mushWorld, scheduler, seasonSignal } = world('summer');
  const trees = new MushtreeManager(new THREE.Scene(), mushWorld);
  try {
    await trees.spawn('mushtree_medium', new THREE.Vector3(1, 0, 2));
    expect(trees.exportRecords()[0].record.components.mushtree?.treestate).toBe('bloom');
    // Leaving summer: the tree returns to normal after a random delay of up to three segments plus the change animation.
    seasonSignal.set({ season: 'autumn', temperature: 20 });
    await new Promise(resolve => setTimeout(resolve, 0));
    scheduler.advance(95);
    expect(trees.exportRecords()[0].record.components.mushtree?.treestate).toBe('normal');

    const { record } = trees.exportRecords()[0];
    expect(record.components.growable?.stage).toBeGreaterThanOrEqual(1);
    const restored = new MushtreeManager(new THREE.Scene(), world('summer').mushWorld);
    try {
      await restored.spawn('mushtree_medium', new THREE.Vector3(...record.transform.position), record);
      // OnLoad: saved normal build, then summer blooms it again after the random delay.
      expect(restored.exportRecords()[0].record.components.growable).toEqual(record.components.growable);
    } finally { restored.dispose(); }
  } finally { trees.dispose(); }
}, 20000);

it('blooms a tall mushtree in winter only and carries webbable', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const { mushWorld } = world('winter');
  const trees = new MushtreeManager(new THREE.Scene(), mushWorld);
  try {
    const model = await trees.spawn('mushtree_tall', new THREE.Vector3(1, 0, 2));
    expect(trees.exportRecords()[0].record.components.mushtree?.treestate).toBe('bloom');
    expect(trees.miniMapEntities.map(({ icon }) => icon)).toEqual(['mushroom_tree.png']);
    expect(model.userData.actionEntity.hasTag('webbable')).toBe(true);
  } finally { trees.dispose(); }
}, 20000);
