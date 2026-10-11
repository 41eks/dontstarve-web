import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResearchLabPlacement, RESEARCH_LAB_IDS, RESEARCH_LAB_HAMMER_LOOT } from '../../prefab/src/scienceprototyper';
import type { WorldContext } from '../../prefab/src/worldContext';
import type { TransientSpriteAnimationController } from '../src/sprite';
import { PlaySound } from '../../prefab/src/sound';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn() }));
beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(
    new URL(`../../../public${String(url)}`, import.meta.url),
  )));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { createElement: () => ({ setAttribute() {}, style: {} }), body: { appendChild() {} } });
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

async function setup(id: typeof RESEARCH_LAB_IDS[number], skinId?: string) {
  const dropLoot = vi.fn();
  const world = { scene: new THREE.Scene(), player: new THREE.Object3D(), camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(), renderer: { domElement: new EventTarget() }, dropLoot } as unknown as WorldContext;
  world.player.position.set(100, 0, 100);
  const placement = new ResearchLabPlacement(world, () => true);
  const model = await placement.spawnFromSave(id, {
    id: `test_${id}`, transform: { position: [3, 0, 4], rotationY: 0 },
    components: { building: { state: 'idle', ...(skinId ? { skinId } : {}) } },
  });
  const animation = () => model.userData.animationController as TransientSpriteAnimationController;
  const finish = () => { for (let i = 0; i < 80; i++) placement.update(1 / 30); };
  return { placement, model, world, animation, finish, dropLoot };
}

it.each(['researchlab'] as const)('%s fires hit/finish callbacks once and removes its record on hit four', async (id) => {
  const { placement, model, world, animation, finish, dropLoot } = await setup(id);
  try {
    const target = placement.hammerTargets[0];
    const before = placement.exportRecords();
    const disposeGeometry = vi.spyOn((model.children[0].children[0] as THREE.Mesh).geometry, 'dispose');
    for (let i = 0; i < 3; i++) {
      target.playHit();
      expect(animation().currentAnimation).toBe('hit');
      expect(placement.exportRecords()).toEqual(before);
      expect(dropLoot).not.toHaveBeenCalled();
      finish();
      expect(animation().currentAnimation).toBe('idle');
    }
    target.playHit();
    expect(dropLoot).toHaveBeenCalledExactlyOnceWith(RESEARCH_LAB_HAMMER_LOOT[id], new THREE.Vector3(3, 0, 4));
    expect(PlaySound).toHaveBeenCalledTimes(2);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/common/destroy_wood', new THREE.Vector3(3, 0, 4));
    expect(model.parent).toBeNull();
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(target.isValid()).toBe(false);
    expect(placement.hammerTargets).toEqual([]);
    expect(placement.reskinTargets).toEqual([]);
    expect(placement.exportRecords()).toEqual([]);
    const effect = world.scene.children.find((model) => model.name === 'collapse_small')!;
    expect(effect.userData).toMatchObject({ persists: false, tags: ['FX', 'NOCLICK'] });
    expect(effect.position.toArray()).toEqual([3, 0, 4]);
    expect(placement.renderEntities.map(({ object }) => object)).toEqual([effect]);
    target.playHit();
    expect(dropLoot).toHaveBeenCalledOnce();
    finish();
    expect(effect.parent).toBeNull();
    expect(placement.renderEntities).toEqual([]);
  } finally { placement.dispose(); }
});

it('preserves work through reskinning and restores proximity after hits', async () => {
  const { placement, model, world, animation, finish, dropLoot } = await setup('researchlab2', 'researchlab2_pod');
  try {
    world.player.position.copy(model.position);
    placement.update(0);
    expect(animation().currentAnimation).toBe('proximity_loop');
    placement.hammerTargets[0].playHit();
    finish();
    expect(animation().currentAnimation).toBe('proximity_loop');
    const prepared = await placement.reskinTargets[0].prepareNextSkin();
    expect(prepared.apply()).toBe(true);
    prepared.dispose();
    for (let i = 0; i < 2; i++) { placement.hammerTargets[0].playHit(); finish(); }
    expect(dropLoot).not.toHaveBeenCalled();
    placement.hammerTargets[0].playHit();
    expect(model.parent).toBeNull();
    expect(dropLoot).toHaveBeenCalledOnce();
    const effect = world.scene.children[0];
    const effectMesh = effect.children[0].children[0] as THREE.Mesh;
    const disposeMaterial = vi.spyOn((effectMesh.material as THREE.Material[])[0], 'dispose');
    placement.dispose();
    await Promise.resolve();
    expect(effect.parent).toBeNull();
    expect(disposeMaterial).toHaveBeenCalledOnce();
  } finally { placement.dispose(); }
});

it('matches unburnt Lua recipe salvage quantities', () => {
  expect(RESEARCH_LAB_HAMMER_LOOT).toEqual({
    researchlab: [{ itemId: 'goldnugget', count: 1 }, { itemId: 'log', count: 2 }, { itemId: 'rocks', count: 2 }],
    researchlab2: [{ itemId: 'boards', count: 2 }, { itemId: 'cutstone', count: 1 }, { itemId: 'transistor', count: 1 }],
    researchlab3: [{ itemId: 'livinglog', count: 2 }, { itemId: 'purplegem', count: 1 }, { itemId: 'nightmarefuel', count: 4 }],
    researchlab4: [{ itemId: 'rabbit', count: 2 }, { itemId: 'boards', count: 2 }, { itemId: 'tophat', count: 1 }],
  });
});
