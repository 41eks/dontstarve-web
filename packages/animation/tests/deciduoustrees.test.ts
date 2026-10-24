import { EventEmitter } from '@dontstarve-web/signals';
import type { WorldEvents } from '../../prefab/src/worldContext';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSignal, type SeasonState } from '../../signals/src';
import { createDeciduousForest } from '../../prefab/src/deciduoustrees';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { DeciduousTreeLeaves } from '../../prefab/src/deciduousTreeLeaves';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup(seasonName: SeasonState['season'] = 'summer') {
  const scheduler = new GameTimeScheduler(), season = createSignal<SeasonState>({ season: seasonName, progress: .5 });
  const physics = new CANNON.World(), dropLoot = vi.fn();
  const forest = await createDeciduousForest('/dst/data/anim', { scheduler, season, physics, camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene(), worldEvents: new EventEmitter<WorldEvents>(), dropLoot,
    secondsUntilNextDay: now => 480 - now % 480, growthDuration: time => time * (season.peek().season === 'spring' ? .75 : 1) }, () => .5, 20);
  return { forest, scheduler, season, physics, dropLoot };
}
it('cycles three source size banks, swaps seasonal leaves without sharing tint, and completes winter leaf removal through the scheduler while unloaded', async () => {
  const s = await setup();
  try {
    const tree = s.forest.spawn('deciduoustree_short', new THREE.Vector3(2, 0, 0));
    const work = s.forest.chopTargets[0].entity.components.workable!, model = tree.model!;
    const growth = model.userData.components.growable, leaves = model.userData.deciduoustreeState.leaves;
    expect(work.GetWorkLeft()).toBe(5);
    expect((model.children[0].children[0] as THREE.Mesh).geometry.drawRange.count).toBeGreaterThan(0);
    const timer = growth.state.timer.peek(); s.scheduler.advance(100); expect(growth.state.timer.peek()).toBe(timer);
    s.scheduler.advance(350); expect(work.GetWorkLeft()).toBe(10);
    expect(model.userData.animationController.currentAnimation).toBe('grow_short_to_normal');
    s.scheduler.advance(1500); expect(work.GetWorkLeft()).toBe(15);
    s.season.set({ season: 'autumn', progress: .5 }); await Promise.resolve();
    expect(leaves.build.peek()).toBe('orange'); expect(leaves.leaf.peek()).toBe('colorful');
    expect(s.forest.chopTargets[0].entity.hasTag('shelter')).toBe(true);
    const geometry = (model.children[0].children[0] as THREE.Mesh).geometry;
    const materials = (model.children[0].children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial[];
    expect(materials.length).toBeGreaterThan(1);
    expect(materials.every(material => material.forceSinglePass && !material.depthWrite)).toBe(true);
    const cleanup = vi.spyOn(geometry, 'dispose');
    s.season.set({ season: 'winter', progress: .5 }); await Promise.resolve();
    expect(model.userData.animationController.currentAnimation).toBe('drop_leaves_tall');
    const completion = leaves.completionTimer.peek(); expect(completion.status).toBe('scheduled');
    s.forest.updateNearby(new THREE.Vector3(500, 0, 0)); expect(cleanup).toHaveBeenCalledOnce();
    s.scheduler.advance(20);
    expect(leaves.build.peek()).toBe('barren'); expect(leaves.leaf.peek()).toBe('barren');
    s.forest.updateNearby(new THREE.Vector3());
    expect(s.forest.chopTargets[0].entity.components.workable).toBe(work);
    expect(s.forest.exportRecords()[0].components.deciduoustree).toMatchObject({ build: 'barren', leaf_state: 'barren' });
    expect(tree.model!.userData.components.lootdropper.GenerateLoot()).toEqual(['log', 'log', 'log']);
    s.season.set({ season: 'spring', progress: .5 }); await Promise.resolve(); s.scheduler.advance(20);
    expect(leaves.leaf.peek()).toBe('normal');
    expect(tree.model!.userData.deciduoustreeState.leaves).toBe(leaves);
    growth.DoGrowth(); expect(work.GetWorkLeft()).toBe(5);
    expect(growth.OnSave()).toEqual({ stage: 1, time: 337 });
    expect(tree.model!.userData.animationController.currentAnimation).toBe('grow_tall_to_short');
  } finally { s.forest.dispose(); }
});
it('drops two autumn acorns, preserves a saved stump and its seasonal build, and cancels tasks when the stump is dug', async () => {
  const s = await setup('autumn');
  try {
    const tree = s.forest.spawn('deciduoustree_tall', new THREE.Vector3(1, 0, 0));
    const target = s.forest.chopTargets[0], work = target.entity.components.workable!;
    const leaves = tree.model!.userData.deciduoustreeState.leaves;
    expect(work.WorkedBy({ getPosition: () => new THREE.Vector3(3, 0, 0) }, 15)).toBe(true);
    expect(s.dropLoot.mock.calls[0][0]).toEqual([{ itemId: 'log', count: 3 }, { itemId: 'acorn', count: 2 }]);
    expect(target.isValid()).toBe(false); expect(s.physics.bodies).toEqual([]);
    expect(leaves.dayTimer.peek()).toEqual({ status: 'stopped' });
    const record = s.forest.exportRecords()[0];
    expect(record.components.growable).toEqual({ stage: 3 });
    const restored = await setup('winter');
    try {
      const loaded = restored.forest.spawn('deciduoustree', new THREE.Vector3(...record.transform.position), record);
      expect(restored.forest.exportRecords()[0]).toEqual(record);
      expect(loaded.model!.userData.animationController.currentAnimation).toBe('stump_tall');
      expect(restored.forest.digTargets[0].dig()).toBe(true);
      expect(restored.dropLoot).toHaveBeenLastCalledWith([{ itemId: 'log', count: 1 }], loaded.position);
      restored.scheduler.advance(5000); restored.forest.updateNearby(new THREE.Vector3());
      expect(restored.forest.exportRecords()).toEqual([]); expect(restored.forest.entities).toEqual([]);
    } finally { restored.forest.dispose(); }
  } finally { s.forest.dispose(); }
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
