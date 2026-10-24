import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RockManager } from '../../prefab/src/rocks';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { getSpriteErosion } from '../src/spriteErosion';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => vi.stubGlobal('fetch', async (url: string) =>
  new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), drops: string[] = [];
  const manager = new RockManager(scene, '/dst/data/anim', { scheduler,
    prepareSpawn: async definition => ({ spawn: () => { drops.push(definition.itemId); return true; }, dispose() {} }),
  });
  return { scene, scheduler, manager, drops, dispose: () => { manager.dispose(); scheduler.dispose(); } };
}

it('mines moon rocks in six hits and cave-in boulders in three, preserving surviving identity and resetting work on load', async () => {
  const s = setup(), restored = setup();
  try {
    await s.manager.spawn('rock_moon', new THREE.Vector3(3, 0, 4));
    const boulder = await s.manager.spawn('cavein_boulder', new THREE.Vector3(6, 0, 4));
    const [moon, cavein] = s.manager.mineTargets;
    performToolWork('MINE', cavein.entity, {});
    expect(cavein.entity.components.workable!.GetWorkLeft()).toBe(2);
    expect(boulder.userData.animationController.currentAnimation).toBe('idle');
    const surviving = s.manager.exportRecords().find(record => record.prefabId === 'cavein_boulder')!;
    await restored.manager.spawn(surviving.prefabId, new THREE.Vector3(...surviving.record.transform.position), surviving.record);
    expect(restored.manager.exportRecords()[0]).toEqual(surviving);
    expect(restored.manager.mineTargets[0].entity.components.workable!.GetWorkLeft()).toBe(3);
    vi.spyOn(Math, 'random').mockReturnValue(.9);
    for (let i = 0; i < 2; i++) performToolWork('MINE', cavein.entity, {});
    expect(s.drops).toEqual(['rocks', 'rocks']);
    expect(cavein.isValid()).toBe(false);
    for (let i = 0; i < 6; i++) performToolWork('MINE', moon.entity, {});
    expect(s.drops.slice(2)).toEqual(['rocks', 'flint', 'moonrocknugget', 'moonrocknugget']);
    expect(s.manager.exportRecords()).toEqual([]);
    expect(s.manager.mineTargets).toEqual([]);
  } finally { s.dispose(); restored.dispose(); }
});

it('breaks a moon shell after its minerals drop, synchronously spawns one orb and removes the unsaved shell at the erosion deadline', async () => {
  const s = setup();
  try {
    const model = await s.manager.spawn('rock_moon_shell', new THREE.Vector3(3, 0, 4));
    const [mine] = s.manager.mineTargets;
    vi.spyOn(Math, 'random').mockReturnValue(.9);
    for (let i = 0; i < 5; i++) performToolWork('MINE', mine.entity, {});
    expect(model.userData.animationController.currentAnimation).toBe('low');
    expect(s.manager.exportRecords().map(record => record.prefabId)).toEqual(['rock_moon_shell']);
    const finished = vi.fn(() => {
      expect(s.drops).toEqual(['rocks', 'flint', 'moonrocknugget', 'moonrocknugget', 'moonrocknugget']);
      expect(s.manager.exportRecords().map(record => record.prefabId)).toEqual(['moonrockseed']);
    });
    model.addEventListener('workfinished' as never, finished);
    performToolWork('MINE', mine.entity, {});
    expect(finished).toHaveBeenCalledOnce();
    expect(model.userData.tags).toContain('NOCLICK');
    expect(model.userData.animationController.currentAnimation).toBe('break');
    expect(s.manager.exportRecords()[0].record.transform.position).toEqual([3, 0, 4]);
    expect(s.manager.mineTargets).toEqual([]);
    expect(performToolWork('MINE', mine.entity, {})).toBe(false);
    const state = model.userData.rockMiningState;
    expect(state.breakDelay.peek()).toEqual({ status: 'scheduled', endTime: 2 });
    s.scheduler.advance(2.5); s.manager.update(0, new THREE.Quaternion());
    expect(getSpriteErosion(model.children[0])).toBeCloseTo(.5); // the drawn sprite carries the erosion
    expect(s.scene.children).toContain(model);
    s.scheduler.advance(.5); // No rendering or presentation effect is needed to remove it.
    expect(s.scene.children).not.toContain(model);
    expect(state.erosion.peek().status).toBe('stopped');
    expect(s.manager.exportRecords().map(record => record.prefabId)).toEqual(['moonrockseed']);
  } finally { s.dispose(); }
});

it('cancels shell removal timers on scene disposal without touching an injected scheduler', async () => {
  const s = setup();
  try {
    const shell = await s.manager.spawn('rock_moon_shell', new THREE.Vector3());
    const [target] = s.manager.mineTargets;
    for (let i = 0; i < 6; i++) performToolWork('MINE', target.entity, {});
    s.manager.dispose();
    s.scheduler.advance(10);
    expect(s.scene.children).toEqual([]);
    expect(shell.userData.rockMiningState.breakDelay.peek().status).toBe('stopped');
    let ran = false; s.scheduler.schedule(0, () => { ran = true; }); s.scheduler.advance(0);
    expect(ran).toBe(true);
  } finally { s.dispose(); }
});
