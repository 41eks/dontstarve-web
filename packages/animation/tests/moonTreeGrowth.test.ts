import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMoonTreeForest } from '../../prefab/src/moontree';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { FlowerPlanting } from '../../prefab/src/flower';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import type { WorldContext } from '../../prefab/src/worldContext';
import { PlaySound } from '../../prefab/src/sound';
import { bindTestWorld } from './worldContentFixture';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup() {
  const scheduler = new GameTimeScheduler(), camera = new THREE.PerspectiveCamera(), dropLoot = vi.fn();
  const { snowLevel, unbind } = bindTestWorld(scheduler);
  const forest = await createMoonTreeForest('/dst/data/anim', { positions: [], random: () => .5, loadRadius: 20 });
  let spring = false;
  forest.bindWorld({ camera, scene: new THREE.Scene(), spawnAsh: vi.fn(), scheduler, dropLoot, growthDuration: seconds => seconds * (spring ? .75 : 1) });
  forest.updateNearby(new THREE.Vector3());
  return { forest, scheduler, camera, dropLoot, snowLevel, setSpring: () => { spring = true; },
    dispose: () => { forest.dispose(); unbind(); scheduler.dispose(); } };
}

it('plants one moonbutterfly with original baby-tree art and cycles short/normal/tall work and growth, accelerating new spring tasks', async () => {
  const s = await setup(), canvas = new EventTarget(), scene = new THREE.Scene();
  scene.add(s.forest.group);
  const world = { scene, player: new THREE.Group(), camera: s.camera, ground: new THREE.Group(), renderer: { domElement: canvas } } as unknown as WorldContext;
  const canPlant = vi.fn(() => true);
  const planting = new FlowerPlanting(world, '/dst/data/anim', undefined, () => .5,
    { forest: s.forest, canPlant, getBlockers: () => [] });
  const point = new THREE.Vector3(3, 0, 4);
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(point);
  const take = vi.fn(() => true), click = () => canvas.dispatchEvent(Object.assign(new Event('pointerdown', { cancelable: true }), { button: 2 }));
  try {
    await planting.begin(take, 'moonbutterfly');
    window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' })); click();
    expect(take).not.toHaveBeenCalled();
    await planting.begin(take, 'moonbutterfly'); canPlant.mockReturnValue(false); click();
    expect(take).not.toHaveBeenCalled(); canPlant.mockReturnValue(true); click();
    expect(take).toHaveBeenCalledOnce();
    expect(s.forest.exportSaplings()[0].transform.position).toEqual(point.toArray());
    expect(s.forest.exportSaplings()[0].components.saplingTimer.timers.grow.timeleft).toBe(225);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/plant_tree', point);
    await planting.begin(take, 'moonbutterfly'); click();
    expect(take).toHaveBeenCalledOnce(); planting.cancel();
    s.scheduler.advance(225);
    expect(s.forest.exportSaplings()).toEqual([]);
    const tree = s.forest.entities[0];
    expect(s.forest.exportState(tree)).toEqual({ moonTree: { size: 'short' }, growable: { stage: 1, time: 450 } });
    expect(tree.model!.userData.animationController.currentAnimation).toBe('grow_seed_to_short');
    expect(s.forest.chopTargets[0].entity.components.workable!.GetWorkLeft()).toBe(8);
    expect(performToolWork('CHOP', s.forest.chopTargets[0].entity, {})).toBe(true);
    s.setSpring(); s.scheduler.advance(450);
    expect(s.forest.exportState(tree)).toEqual({ moonTree: { size: 'normal' }, growable: { stage: 2, time: 1125 } });
    expect(s.forest.chopTargets[0].entity.components.workable!.GetWorkLeft()).toBe(12);
    s.scheduler.advance(1125);
    expect(s.forest.exportState(tree).moonTree!.size).toBe('tall');
    expect(s.forest.chopTargets[0].entity.components.workable!.GetWorkLeft()).toBe(16);
    s.scheduler.advance(1125);
    expect(s.forest.exportState(tree)).toEqual({ moonTree: { size: 'short' }, growable: { stage: 1, time: 337 } });
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/forest/treeGrowFromWilt', tree.position);
  } finally { planting.dispose(); s.dispose(); }
});

it('keeps logical growth while unloaded and stops growth when chopping or digging plants', async () => {
  const s = await setup();
  try {
    const tree = s.forest.spawnTree('moon_tree_normal', new THREE.Vector3(3, 0, 0));
    s.forest.updateNearby(new THREE.Vector3(500, 0, 0));
    s.scheduler.advance(1600);
    expect(s.forest.exportState(tree).growable).toEqual({ stage: 2, time: 0, sleeptime: 1600 });
    s.forest.updateNearby(new THREE.Vector3());
    expect(s.forest.exportState(tree)).toEqual({ moonTree: { size: 'short' }, growable: { stage: 1, time: 250 } });
    const target = s.forest.chopTargets[0];
    expect(target.entity.components.workable!.WorkedBy({}, 8)).toBe(true);
    expect(s.forest.exportState(tree)).toEqual({ moonTree: { size: 'short', stump: true }, growable: { stage: 1 } });
    s.scheduler.advance(5000);
    expect(s.forest.digTargets[0].dig()).toBe(true);
    const sapling = s.forest.spawnSapling(new THREE.Vector3(5, 0, 0));
    expect(s.forest.digTargets[0].dig()).toBe(true);
    expect(sapling.userData.removed).toBe(true);
    expect(s.dropLoot).toHaveBeenLastCalledWith([{ itemId: 'twigs', count: 1 }], sapling.position);
    s.scheduler.advance(300);
    expect(s.forest.entities).toEqual([]);
    expect(s.forest.exportSaplings()).toEqual([]);
  } finally { s.dispose(); }
});

it('shows source snow art at the cover threshold, restores it on reload and releases unloaded tree effects', async () => {
  const s = await setup();
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const drawnIndices = (model: THREE.Group) => {
    let count = 0;
    model.traverse(object => { if (object instanceof THREE.Mesh) count += object.geometry.drawRange.count; });
    return count;
  };
  try {
    const tree = s.forest.spawnTree('moon_tree_tall', new THREE.Vector3(3, 0, 0));
    const model = tree.model!, bareIndices = drawnIndices(model);
    expect(model.userData.tags).toContain('SnowCovered');
    s.snowLevel.set(.014); await settle();
    expect(drawnIndices(model)).toBe(bareIndices);
    s.snowLevel.set(.015); await settle();
    expect(drawnIndices(model)).toBeGreaterThan(bareIndices);
    const oldAnimation = model.userData.animationController;
    const hide = vi.spyOn(oldAnimation, 'hideLayer');
    s.snowLevel.set(0);
    s.forest.updateNearby(new THREE.Vector3(500, 0, 0));
    await settle();
    expect(hide).not.toHaveBeenCalled();
    s.snowLevel.set(.5);
    s.forest.updateNearby(new THREE.Vector3());
    expect(tree.model).not.toBe(model);
    expect(drawnIndices(tree.model!)).toBeGreaterThan(bareIndices);
    s.snowLevel.set(0); await settle();
    expect(drawnIndices(tree.model!)).toBe(bareIndices);
    expect(hide).not.toHaveBeenCalled();
  } finally { s.dispose(); }
});
