import { findActionEntity } from '../../prefab/src/actionEntity';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { withEntity } from './entityFixture';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResearchLabPlacement, RESEARCH_LAB_IDS, RESEARCH_LAB_HAMMER_LOOT } from '../../prefab/src/scienceprototyper';
import type { WorldContext } from '../../prefab/src/worldContext';
import type { TransientSpriteAnimationController } from '../src/sprite';
import { Builder } from '../../componets/src/builder';
import { actionEntity, FindEntities } from '../../prefab/src/actionEntity';
import { WORLD_SCALE } from '../../prefab/src/standardcomponents';
import { PlaySound } from '../../prefab/src/sound';
import { prefabInstance } from '../../prefab/src/prefabInstance';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn(), isPlaying: () => true })) }));
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
  const model = placement.spawnFromSave(id, {
    id: `test_${id}`, transform: { position: [3, 0, 4], rotationY: 0 },
    components: { building: { state: 'idle', ...(skinId ? { skinId } : {}) } },
  });
  const builder = new Builder(actionEntity(withEntity(world.player as THREE.Group, 'waxwell'), 'waxwell'), {
    findEntities: (...args) => FindEntities(...args), researchMachineDistance: 4 * WORLD_SCALE,
  });
  const animation = () => prefabInstance(model)!.sprite as TransientSpriteAnimationController;
  const finish = () => { for (let i = 0; i < 80; i++) placement.update(1 / 30); };
  // The display loads the lab's art, and its collapse fx with it; one-shot clips play out once they are drawn.
  await vi.waitFor(() => expect(animation().loaded).toBe(true));
  return { placement, model, world, animation, finish, dropLoot, builder };
}

it.each(['researchlab'] as const)('%s fires hit/finish callbacks once and removes its record on hit four', async (id) => {
  const { placement, model, world, animation, finish, dropLoot, builder } = await setup(id);
  try {
    const target = placement.hammerTargets[0];
    const before = placement.exportRecords();
    // Frame geometry changes with the clip, so observe the release rather than one frame's geometry.
    const disposeGeometry = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
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
    expect(disposeGeometry).toHaveBeenCalled();
    expect(target.isValid()).toBe(false);
    expect(placement.hammerTargets).toEqual([]);
    expect(placement.reskinTargets).toEqual([]);
    expect(placement.exportRecords()).toEqual([]);
    const effect = world.scene.children.find((model) => model.name === 'collapse_small')!;
    expect(prefabInstance(effect)!.persists).toBe(false);
    expect(prefabInstance(effect)!.listTags()).toEqual(['FX', 'NOCLICK']);
    expect(effect.position.toArray()).toEqual([3, 0, 4]);
    expect(placement.renderEntities.map(({ object }) => object)).toEqual([effect]);
    target.playHit();
    expect(dropLoot).toHaveBeenCalledOnce();
    finish();
    expect(effect.parent).toBeNull();
    expect(placement.renderEntities).toEqual([]);
  } finally { builder.dispose(); placement.dispose(); }
});

it('preserves work through reskinning and restores proximity after hits', async () => {
  const { placement, model, world, animation, finish, dropLoot, builder } = await setup('researchlab2', 'researchlab2_pod');
  try {
    world.player.position.copy(model.position);
    builder.OnUpdate();
    placement.update(0);
    expect(animation().currentAnimation).toBe('proximity_loop');
    placement.hammerTargets[0].playHit();
    finish();
    expect(animation().currentAnimation).toBe('proximity_loop');
    const prepared = await placement.reskinTargets[0].prepareNextSkin();
    const prototyper = (findActionEntity(model)?.components ?? prefabInstance(model)!.components).prototyper;
    expect(prepared.apply()).toBe(true);
    expect((findActionEntity(model)?.components ?? prefabInstance(model)!.components).prototyper).toBe(prototyper);
    expect(prototyper.on).toBe(true);
    prepared.dispose();
    for (let i = 0; i < 2; i++) { placement.hammerTargets[0].playHit(); finish(); }
    expect(dropLoot).not.toHaveBeenCalled();
    placement.hammerTargets[0].playHit();
    expect(model.parent).toBeNull();
    expect(dropLoot).toHaveBeenCalledOnce();
    const effect = world.scene.children[0];
    let effectMesh!: THREE.Mesh;
    effect.traverse(object => { if (object instanceof THREE.Mesh) effectMesh ??= object; });
    const disposeMaterial = vi.spyOn((effectMesh.material as THREE.Material[])[0], 'dispose');
    placement.dispose();
    await Promise.resolve();
    expect(effect.parent).toBeNull();
    expect(disposeMaterial).toHaveBeenCalledOnce();
  } finally { builder.dispose(); placement.dispose(); }
});

it('matches unburnt Lua recipe salvage quantities', () => {
  expect(RESEARCH_LAB_HAMMER_LOOT).toEqual({
    researchlab: [{ itemId: 'goldnugget', count: 1 }, { itemId: 'log', count: 2 }, { itemId: 'rocks', count: 2 }],
    researchlab2: [{ itemId: 'boards', count: 2 }, { itemId: 'cutstone', count: 1 }, { itemId: 'transistor', count: 1 }],
    researchlab3: [{ itemId: 'livinglog', count: 2 }, { itemId: 'purplegem', count: 1 }, { itemId: 'nightmarefuel', count: 4 }],
    researchlab4: [{ itemId: 'rabbit', count: 2 }, { itemId: 'boards', count: 2 }, { itemId: 'tophat', count: 1 }],
  });
});

it('queues magic station transitions across reskinning, then rebuilds transient use state on load', async () => {
  const { placement, model, world, animation, builder } = await setup('researchlab3');
  let restored: ResearchLabPlacement | undefined;
  try {
    world.player.position.copy(actionEntity(model, 'researchlab3').getPosition());
    placement.update(0);
    expect(animation().currentAnimation).toBe('idle'); // Placement does not select a station.
    builder.OnUpdate();
    expect(animation().currentAnimation).toBe('proximity_pre');
    const component = (findActionEntity(model)?.components ?? prefabInstance(model)!.components).prototyper;
    const sound = vi.mocked(PlaySound).mock.results.at(-1)!.value;
    const prepared = await placement.reskinTargets[0].prepareNextSkin();
    expect(prepared.apply()).toBe(true);
    prepared.dispose();
    expect((findActionEntity(model)?.components ?? prefabInstance(model)!.components).prototyper).toBe(component);
    for (let i = 0; i < 300; i++) placement.update(1 / 30);
    expect(animation().currentAnimation).toBe('proximity_loop');
    expect(sound.stop).not.toHaveBeenCalled();
    const record = placement.exportRecords()[0].record;
    expect(record.components).not.toHaveProperty('prototyper');
    world.player.position.x += 4 * WORLD_SCALE + .01;
    builder.OnUpdate();
    expect(component.on).toBe(false);
    expect(animation().currentAnimation).toBe('proximity_loop'); // PushAnimation waits for the current pass.
    expect(sound.stop).toHaveBeenCalledOnce();
    for (let i = 0; i < 300; i++) placement.update(1 / 30);
    expect(animation().currentAnimation).toBe('idle');
    placement.dispose();

    restored = new ResearchLabPlacement(world, () => true);
    const loaded = await restored.spawnFromSave('researchlab3', record);
    expect((findActionEntity(loaded)?.components ?? prefabInstance(loaded)!.components).prototyper.on).toBe(false);
    world.player.position.copy(actionEntity(loaded, 'researchlab3').getPosition());
    builder.OnUpdate();
    expect((findActionEntity(loaded)?.components ?? prefabInstance(loaded)!.components).prototyper.on).toBe(true);
    expect(builder.accessible_tech_trees.peek().MAGIC).toBe(3);
    expect(restored.exportRecords()[0].record).toEqual(record);
    restored.dispose();
    restored = new ResearchLabPlacement(world, () => true);
    const burnt = await restored.spawnFromSave('researchlab3', { ...record,
      components: { ...record.components, building: { ...record.components.building!, burnt: true } } });
    builder.OnUpdate();
    expect((findActionEntity(burnt)?.components ?? prefabInstance(burnt)!.components).prototyper).toBeUndefined();
    expect(actionEntity(burnt, 'researchlab3').hasTag('prototyper')).toBe(false);
    expect(builder.current_prototyper).toBeUndefined();
    expect(builder.accessible_tech_trees.peek().MAGIC).toBe(0);
  } finally { builder.dispose(); placement.dispose(); restored?.dispose(); }
});
