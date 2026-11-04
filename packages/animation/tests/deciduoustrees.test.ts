import type { Growable } from '../../componets/src/growable';
import { findActionEntity } from '../../prefab/src/actionEntity';
import * as THREE from 'three';
import { createTestArea, useTestTileMap } from './tileMapFixture';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSignal, type GetWatchWorldContent, type SeasonState } from '../../signals/src';
import { DECIDUOUS_CLIP_FRAMES, type DeciduousInstance, deciduousPrefabs } from '../../prefab/src/deciduoustrees';
import { treeWorld } from './treeManagerFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { LootDropper } from '../../componets/src/lootdropper';
import { DeciduousTreeLeaves } from '../../prefab/src/deciduousTreeLeaves';
import { ArchiveSpriteAssets } from '../src/archiveSprite';
import { bindTestWorld, drawn } from './worldContentFixture';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { workTargets } from './workTargets';

useTestTileMap();
let area: ReturnType<typeof createTestArea>;
beforeEach(async () => { area = createTestArea(); await area.ready; });
afterEach(() => area.dispose());

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup(seasonName: SeasonState['season'] = 'summer', getWatchWorldContent?: GetWatchWorldContent) {
  const season = createSignal<SeasonState>({ season: seasonName, progress: .5 });
  const world = treeWorld(area.query, world => deciduousPrefabs(world, () => .5), { season, getWatchWorldContent,
    secondsUntilNextDay: (now: number) => 480 - now % 480, growthDuration: (time: number) => time * (season.peek().season === 'spring' ? .75 : 1) });
  return { ...world, season };
}
const leavesOf = (model: THREE.Object3D) => (prefabInstance(model) as unknown as DeciduousInstance).leaves.state;

it('cycles three source size banks, swaps seasonal leaves without sharing tint, and completes winter leaf removal through the scheduler while unloaded', async () => {
  const snowScheduler = new GameTimeScheduler(), world = bindTestWorld(snowScheduler);
  const s = await setup('summer', world.getWatchWorldContent), sharedDisposed = vi.fn();
  try {
    const tree = s.prefabs.spawn('deciduoustree_short', new THREE.Vector3(2, 0, 0));
    const work = workTargets('CHOP')[0].entity.components.workable!, model = tree.transform.model;
    const icon = prefabInstance(model)!.minimap;
    expect(icon).toMatchObject({ icon: 'tree_leaf.png', priority: -1 });
    const growth = (prefabInstance(model)!.components as { growable: Growable }).growable, leaves = leavesOf(model);
    expect(work.GetWorkLeft()).toBe(5);
    await drawn(model);
    expect((model.children[0].children[0].children[0] as THREE.Mesh).visible).toBe(false);
    expect((model.children[0].children[0].children[0] as THREE.Mesh).geometry.drawRange.count).toBeGreaterThan(0);
    const timer = growth.state.timer.peek(); s.scheduler.advance(100); expect(growth.state.timer.peek()).toBe(timer);
    s.scheduler.advance(350); expect(work.GetWorkLeft()).toBe(10);
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('grow_short_to_normal');
    s.scheduler.advance(1500); expect(work.GetWorkLeft()).toBe(15);
    s.season.set({ season: 'autumn', progress: .5 }); await new Promise(resolve => setTimeout(resolve, 0));
    expect(leaves.build.peek()).toBe('orange'); expect(leaves.leaf.peek()).toBe('colorful');
    expect(workTargets('CHOP')[0].entity.hasTag('shelter')).toBe(true);
    const geometry = (model.children[0].children[0].children[0] as THREE.Mesh).geometry;
    const materials = (model.children[0].children[0].children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial[];
    expect(materials.length).toBeGreaterThan(1);
    expect(materials.every(material => material.forceSinglePass && !material.depthWrite)).toBe(true);
    geometry.addEventListener('dispose', sharedDisposed);
    s.season.set({ season: 'winter', progress: .5 }); await new Promise(resolve => setTimeout(resolve, 0));
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('drop_leaves_tall');
    expect((model.children[0].children[0].children[0] as THREE.Mesh).visible).toBe(true);
    const completion = leaves.completionTimer.peek(); expect(completion.status).toBe('scheduled');
    await area.visit(new THREE.Vector3(500, 0, 0)); expect(sharedDisposed).not.toHaveBeenCalled();
    expect(prefabInstance(model)!.minimap).toBe(icon);
    const hidden = vi.spyOn(prefabInstance(model)!.sprite, 'setSymbolHidden');
    world.snowLevel.set(.02); await new Promise(resolve => setTimeout(resolve, 0));
    expect(hidden).not.toHaveBeenCalled();
    s.scheduler.advance(20);
    expect(leaves.build.peek()).toBe('barren'); expect(leaves.leaf.peek()).toBe('barren');
    await area.visit(new THREE.Vector3());
    expect(workTargets('CHOP')[0].entity.components.workable).toBe(work);
    const covered = (tree.transform.model.children[0].children[0].children[0] as THREE.Mesh).geometry.drawRange.count;
    expect(prefabInstance(tree.transform.model)!.listTags()).toContain('SnowCovered');
    world.snowLevel.set(0); await new Promise(resolve => setTimeout(resolve, 0));
    expect((tree.transform.model.children[0].children[0].children[0] as THREE.Mesh).geometry.drawRange.count).toBeLessThan(covered);
    expect(s.records()[0].components.deciduoustree).toMatchObject({ build: 'barren', leaf_state: 'barren' });
    expect((prefabInstance(tree.transform.model)!.components as { lootdropper: LootDropper }).lootdropper.GenerateLoot()).toEqual(['log', 'log', 'log']);
    s.season.set({ season: 'spring', progress: .5 }); await new Promise(resolve => setTimeout(resolve, 0)); s.scheduler.advance(20);
    expect(leaves.leaf.peek()).toBe('normal');
    expect(leavesOf(tree.transform.model)).toBe(leaves);
    growth.DoGrowth(); expect(work.GetWorkLeft()).toBe(5);
    expect(growth.OnSave()).toEqual({ stage: 1, time: 337 });
    expect(prefabInstance(tree.transform.model)!.sprite.currentAnimation).toBe('grow_tall_to_short');
  } finally { s.dispose(); world.unbind(); snowScheduler.dispose(); }
  expect(sharedDisposed).toHaveBeenCalledOnce();
});
it('shows growth settled while unloaded as its final stage without the transition animation', async () => {
  const s = await setup();
  try {
    const tree = s.prefabs.spawn('deciduoustree_short', new THREE.Vector3(2, 0, 0));
    const root = tree.transform.model, controller = prefabInstance(root)!.sprite, components = (findActionEntity(root)?.components ?? prefabInstance(root)!.components);
    await area.visit(new THREE.Vector3(1000, 0, 1000));
    // A sleeping tree keeps its root and state but leaves the scene graph until its tile wakes.
    expect(tree.transform.model).toBe(root); expect(root.parent).toBeNull();
    expect((findActionEntity(root)?.components ?? prefabInstance(root)!.components)).toBe(components); expect(controller.loaded).toBe(false);
    s.scheduler.advance(5000);
    await area.visit(new THREE.Vector3(2, 0, 0));
    await drawn(root);
    expect(root.parent).toBe(s.scene);
    expect(tree.transform.model).toBe(root); expect(prefabInstance(root)!.sprite).toBe(controller);
    expect((findActionEntity(root)?.components ?? prefabInstance(root)!.components)).toBe(components); expect(controller.loaded).toBe(true);
    const model = tree.transform.model;
    expect((prefabInstance(model)!.components as { growable: Growable }).growable.GetStage()).toBe(3);
    expect(prefabInstance(model)!.sprite.currentAnimation).not.toMatch(/^grow_/);
  } finally { s.dispose(); }
});
it('drops two autumn acorns, preserves a saved stump and its seasonal build, and cancels tasks when the stump is dug', async () => {
  const s = await setup('autumn');
  try {
    const tree = s.prefabs.spawn('deciduoustree_tall', new THREE.Vector3(1, 0, 0));
    const target = workTargets('CHOP')[0], work = target.entity.components.workable!;
    const leaves = leavesOf(tree.transform.model);
    expect(work.WorkedBy({ getPosition: () => new THREE.Vector3(3, 0, 0) }, 15)).toBe(true);
    expect(s.dropLoot.mock.calls[0][0]).toEqual([{ itemId: 'log', count: 3 }, { itemId: 'acorn', count: 2 }]);
    expect(target.isValid()).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 0)); expect(s.physics.bodies).toEqual([]);
    expect(leaves.dayTimer.peek()).toEqual({ status: 'stopped' });
    const record = s.records()[0];
    expect(record.components.growable).toEqual({ stage: 3 });
    const restored = await setup('winter');
    try {
      const loaded = restored.prefabs.spawn('deciduoustree', new THREE.Vector3(...record.transform.position), record);
      expect(restored.records()[0]).toEqual(record);
      expect(prefabInstance(loaded.transform.model)!.sprite.currentAnimation).toBe('stump_tall');
      const icon = prefabInstance(loaded.transform.model)!.minimap;
      expect(icon.icon).toBe('tree_leaf_stump.png');
      expect(workTargets('DIG', loaded.transform.model)[0].work()).toBe(true);
      expect(icon.enabled).toBe(false);
      expect(prefabInstance(loaded.transform.model)!.isRemoved).toBe(true);
      expect(restored.dropLoot).toHaveBeenLastCalledWith([{ itemId: 'log', count: 1 }], loaded.position);
      restored.scheduler.advance(5000); await area.visit(new THREE.Vector3());
      expect(restored.records()).toEqual([]);
    } finally { restored.dispose(); }
  } finally { s.dispose(); }
});
it('arms daily boundary tasks, preserves pending leaf-change time on load, and retains the literal Lua work-time deferral', () => {
  const scheduler = new GameTimeScheduler(), season = createSignal<SeasonState>({ season: 'autumn', progress: .9 });
  let lastWork: number | undefined;
  const owner = { lastWorkTime: () => lastWork, applyBuild: vi.fn(), updateLoot: vi.fn(), setShelter: vi.fn(),
    playTransition: vi.fn(() => 1), sway: vi.fn(), spawnLeafFx: vi.fn() };
  const world = { season, secondsUntilNextDay: (now: number) => 480 - now % 480,
    seasonCalendar: () => ({ remainingDays: 2, lengths: { autumn: 20, winter: 15, spring: 20, summer: 15 } }) };
  const leaves = new DeciduousTreeLeaves(scheduler, world, owner, () => .5);
  leaves.Initialize();
  const day = leaves.state.dayTimer.peek(); scheduler.advance(200); expect(leaves.state.dayTimer.peek()).toBe(day);
  scheduler.advance(280); expect(leaves.state.changeTimer.peek()).toEqual({ status: 'scheduled', endTime: 945 });
  const saved = leaves.OnSave(); leaves.dispose();
  const loaded = new DeciduousTreeLeaves(scheduler, world, owner, () => .5); loaded.Initialize(saved);
  expect(loaded.OnSave()).toEqual(saved);
  lastWork = 0; scheduler.advance(465);
  expect(loaded.state.changeTimer.peek()).toEqual({ status: 'scheduled', endTime: 956 });
  expect(loaded.state.leaf.peek()).toBe('colorful');
  loaded.Stop(); scheduler.advance(5000); expect(loaded.state.dayTimer.peek()).toEqual({ status: 'stopped' });
  expect(loaded.state.changeTimer.peek()).toEqual({ status: 'stopped' }); loaded.dispose();
});

it('retains an imported stump with no leaf target and its decay task while visuals unload and the save reloads', async () => {
  const s = await setup(), restored = await setup();
  try {
    s.prefabs.spawn('deciduoustree', new THREE.Vector3(), { id: 'dst-stump',
      transform: { position: [0, 0, 0], rotationY: 0 }, components: {
        deciduoustree: { stump: true, leaf_state: 'normal' }, growable: { stage: 1, sleeptime: 4805 },
        deciduousTimer: { timers: { decay: { timeleft: 10, initial_time: 200, paused: false } } },
      } });
    await area.visit(new THREE.Vector3(1000, 0, 1000));
    s.scheduler.advance(9);
    const [record] = s.records();
    expect(record.components.deciduoustree).toEqual({ stump: true, leaf_state: 'normal' });
    expect(record.components.deciduousTimer?.timers.decay.timeleft).toBe(1);
    restored.prefabs.spawn('deciduoustree', new THREE.Vector3(), record);
    restored.scheduler.advance(1);
    expect(restored.records()).toEqual([]);
    s.dispose();
    s.scheduler.advance(1);
    expect(s.records()).toHaveLength(0);
  } finally { s.dispose(); restored.dispose(); s.scheduler.dispose(); restored.scheduler.dispose(); }
});

it('declares the frames of the clips a leaf change waits on, as the source anims hold them', async () => {
  const assets = new ArchiveSpriteAssets('deciduoustree', '/dst/data/anim');
  const banks = await Promise.all(['short', 'normal', 'tall'].map(stage => assets.loadAnimation(`tree_leaf_${stage}.zip`)));
  const frames = new Map(banks.flatMap(bank => bank.animations).map(clip => [clip.name, clip.frames.length]));
  for (const [clip, count] of Object.entries(DECIDUOUS_CLIP_FRAMES)) expect([clip, frames.get(clip)]).toEqual([clip, count]);
  assets.dispose();
});
