import { prefabInstance } from '../../prefab/src/prefabInstance';
import { findActionEntity } from '../../prefab/src/actionEntity';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { displayLights } from '../../display/src/displaySprites';
import { createTestArea, useTestTileMap } from './tileMapFixture';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEvergreenForest } from '../../prefab/src/evergreens';
import { createDeciduousForest } from '../../prefab/src/deciduoustrees';
import { createMoonTreeManager } from '../../prefab/src/moontree';
import { FlowerPlanting } from '../../prefab/src/flower';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Lighter } from '../../componets/src/lighter';
import { collectEquippedActions, performLightAction, performToolWork, type ComponentActionEntity } from '../../stategraphs/src/componentactions';
import { EventEmitter, createSignal, type SeasonState } from '@dontstarve-web/signals';
import type { WorldContext, WorldEvents } from '../../prefab/src/worldContext';

useTestTileMap();
let area: ReturnType<typeof createTestArea>;
beforeEach(async () => { area = createTestArea(); await area.ready; });
afterEach(() => area.dispose());

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(stop => stop()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function ashEvents() {
  const worldEvents = new EventEmitter<WorldEvents>();
  const ashSpawned = vi.fn();
  cleanups.push(worldEvents.on('spawnAsh', ashSpawned));
  return { worldEvents, ashSpawned };
}

/** A torch-like tool: only its lighter component matters to the LIGHT action. */
function torch(): ComponentActionEntity {
  const tags = new Set<string>();
  const inst: ComponentActionEntity = { prefab: 'torch', isRemoved: false, components: {},
    hasTag: tag => tags.has(tag), addTag: tag => { tags.add(tag); }, removeTag: tag => { tags.delete(tag); } };
  inst.components.lighter = new Lighter(inst);
  return inst;
}
const doer = (): ComponentActionEntity => ({ prefab: 'wilson', isRemoved: false, components: {},
  hasTag: () => false, addTag() {}, removeTag() {} });
const light = (target: ComponentActionEntity) => {
  const tool = torch();
  expect(collectEquippedActions(tool, target, true)).toEqual(['LIGHT']);
  return performLightAction(tool, target, doer());
};
/** Presentation effects (fire art) run on the signal queue, after the synchronous domain change. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const fires = (scene: THREE.Object3D) => { let count = 0; scene.traverse(child => { if (lookupPrefabInstance(child)?.prefab === 'fire') count++; }); return count; };
const prefabsIn = (scene: THREE.Object3D, prefab: string) => {
  const found: NonNullable<ReturnType<typeof lookupPrefabInstance>>[] = [];
  scene.traverse(child => { const instance = lookupPrefabInstance(child); if (instance?.prefab === prefab) found.push(instance); });
  return found;
};

/** The lights the renderer reads at `model`. */
const lightsAt = (model: THREE.Object3D) => [...displayLights()].filter(listed => listed.model === model).map(({ light }) => light);

async function evergreens(random = () => .5) {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), dropLoot = vi.fn();
  const { worldEvents, ashSpawned } = ashEvents();
  const forest = await createEvergreenForest('/dst/data/anim', { camera: new THREE.PerspectiveCamera(), scene, scheduler,
    physics: new CANNON.World(), dropLoot, worldEvents, tickingarea: area.query }, random);
  scene.add(forest.group);
  await area.visit(new THREE.Vector3());
  return { scene, scheduler, forest, dropLoot, ashSpawned };
}

it('lights an evergreen with a torch, burns it for 45 seconds, then leaves one charcoal chop and survives save/load', async () => {
  const s = await evergreens();
  try {
    const tree = s.forest.spawn('evergreen_normal', new THREE.Vector3(3, 0, 0));
    const icon = lookupPrefabInstance(tree.model!)!.minimap;
    expect(icon).toMatchObject({ icon: 'evergreen.png', priority: -1 });
    const model = tree.model!, target = findActionEntity(model) as ComponentActionEntity;
    expect(light(target)).toBe(true); await flush();
    expect(fires(s.scene)).toBe(1); expect(target.hasTag('fire')).toBe(true); expect(target.hasTag('canlight')).toBe(false);
    // SetFXLevel(5): fire.lua's fifth level draws level4, and firefx_light, parented to the tree, is listed at the tree.
    expect(prefabsIn(s.scene, 'fire')[0].sprite.currentAnimation).toBe('level4');
    expect(lightsAt(model).map(light => light.falloff)).toEqual([.2]);
    s.scheduler.advance(44);
    expect(target.hasTag('burnt')).toBe(false);
    // A burning tree is saved as burnt, without a growth timer.
    expect(s.forest.exportRecords()[0].components).toEqual({ evergreen: { burnt: true }, growable: { stage: 2 } });
    s.scheduler.advance(1); await flush();
    expect(fires(s.scene)).toBe(0); expect(lightsAt(model)).toEqual([]); expect(target.hasTag('burnt')).toBe(true);
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('burnt_normal');
    expect(icon.icon).toBe('evergreen_burnt.png');
    // burnt_changes follow .5 seconds later: no burnable, shelter or growth, and a single chop.
    expect(target.components.burnable).toBeDefined();
    s.scheduler.advance(.5);
    expect(target.components.burnable).toBeUndefined(); expect(target.components.propagator).toBeUndefined();
    expect(target.hasTag('shelter')).toBe(false); expect(target.hasTag('canlight')).toBe(false);
    expect(target.components.workable!.GetWorkLeft()).toBe(1);
    const record = s.forest.exportRecords()[0];
    expect(record.components).toEqual({ evergreen: { burnt: true }, growable: { stage: 2 } });
    // onpineconetask runs once, ten seconds after burning; the 10% pinecone does not drop at random()=.5.
    s.scheduler.advance(10);
    expect(s.dropLoot).not.toHaveBeenCalled();
    expect(s.forest.exportRecords()[0].components.evergreen).toEqual({ burnt: true, burntcone: true });

    const restored = await evergreens();
    try {
      const reloaded = restored.forest.spawn('evergreen', new THREE.Vector3(3, 0, 0), record);
      expect(prefabInstance(reloaded.model!)!.sprite.currentAnimation).toBe('burnt_normal');
      expect(findActionEntity(reloaded.model!).components.burnable).toBeUndefined();
      expect(restored.forest.exportRecords()[0]).toEqual(record);
    } finally { restored.forest.dispose(); }

    expect(performToolWork('CHOP', target, {})).toBe(true);
    expect(s.dropLoot).toHaveBeenCalledWith([{ itemId: 'charcoal', count: 1 }], tree.position);
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('chop_burnt_normal');
    expect(performToolWork('CHOP', target, {})).toBe(false);
    for (let i = 0; i < 60; i++) s.forest.update(1 / 30, new THREE.Quaternion());
    expect(s.forest.entities).toEqual([]);
  } finally { s.forest.dispose(); }
});

it('burns an evergreen stump to ash and removes it, and finishes a burning tree as burnt when it unloads', async () => {
  const s = await evergreens();
  try {
    const stumpTree = s.forest.spawn('evergreen_short', new THREE.Vector3(2, 0, 0));
    const stump = findActionEntity(stumpTree.model!) as ComponentActionEntity;
    expect(performToolWork('CHOP', stump, {})).toBe(true); expect(stump.components.workable!.WorkedBy({}, 4)).toBe(true);
    expect(stump.hasTag('stump')).toBe(true);
    expect(light(stump)).toBe(true); await flush();
    expect(fires(s.scene)).toBe(1);
    // The save of a burning stump is still the stump.
    expect(s.forest.exportRecords()[0].components.evergreen).toEqual({ stump: true });
    s.scheduler.advance(10); await flush();
    expect(s.ashSpawned).toHaveBeenCalledWith(new THREE.Vector3(2, 0, 0));
    expect(s.forest.entities).toEqual([]); expect(stump.isRemoved).toBe(true); expect(fires(s.scene)).toBe(0);

    const tree = s.forest.spawn('evergreen_tall', new THREE.Vector3(4, 0, 0));
    const target = findActionEntity(tree.model!) as ComponentActionEntity;
    expect(light(target)).toBe(true); await flush();
    await area.visit(new THREE.Vector3(500, 0, 0)); await flush(); // OnEntitySleep
    expect(fires(s.scene)).toBe(0);
    expect(s.forest.exportRecords()[0].components).toEqual({ evergreen: { burnt: true }, growable: { stage: 3 } });
    await area.visit(new THREE.Vector3());
    expect(prefabInstance(s.forest.entities[0].model!)!.sprite.currentAnimation).toBe('burnt_tall');
  } finally { s.forest.dispose(); }
});

it('burns a deciduous tree, keeps its season-independent burnt save, and drops charcoal when chopped', async () => {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), dropLoot = vi.fn();
  const season = createSignal<SeasonState>({ season: 'summer', progress: .5 });
  const forest = await createDeciduousForest('/dst/data/anim', { camera: new THREE.PerspectiveCamera(), scene, scheduler, season,
    physics: new CANNON.World(), dropLoot, worldEvents: new EventEmitter<WorldEvents>(), tickingarea: area.query, secondsUntilNextDay: now => 480 - now % 480 }, () => .5);
  scene.add(forest.group); await area.visit(new THREE.Vector3());
  try {
    const tree = forest.spawn('deciduoustree_normal', new THREE.Vector3(3, 0, 0));
    const target = findActionEntity(tree.model!) as ComponentActionEntity;
    expect(light(target)).toBe(true); await flush(); expect(fires(scene)).toBe(1);
    scheduler.advance(45.5); await flush();
    expect(fires(scene)).toBe(0);
    expect(prefabInstance(tree.model!)!.sprite.currentAnimation).toBe('burnt_normal');
    expect(target.hasTag('shelter')).toBe(false); expect(target.hasTag('cattoyairborne')).toBe(false);
    const { components } = forest.exportRecords()[0];
    expect(components.deciduoustree.burnt).toBe(true); expect(components.deciduoustree.stump).toBeUndefined();
    expect(components.growable).toEqual({ stage: 2 });
    season.set({ season: 'autumn', progress: .5 }); await flush(); // leaves no longer change on a burnt tree
    expect(forest.exportRecords()[0].components.deciduoustree.leaf_state).toBe(components.deciduoustree.leaf_state);
    expect(performToolWork('CHOP', target, {})).toBe(true);
    expect(dropLoot).toHaveBeenCalledWith([{ itemId: 'charcoal', count: 1 }], tree.position);
  } finally { forest.dispose(); }
});

it('burns a moon tree for its size-scaled time and keeps burnt state through unloading, save and chopping', async () => {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), dropLoot = vi.fn();
  const forest = await createMoonTreeManager('/dst/data/anim', { camera: new THREE.PerspectiveCamera(), scene, scheduler, dropLoot, worldEvents: new EventEmitter<WorldEvents>(), tickingarea: area.query }, () => .5);
  await area.visit(new THREE.Vector3());
  try {
    const tree = forest.spawn('moon_tree_tall', new THREE.Vector3(3, 0, 0));
    const target = findActionEntity(tree.model!) as ComponentActionEntity;
    expect(light(target)).toBe(true); await flush();
    expect(fires(scene)).toBe(1);
    scheduler.advance(67); expect(target.hasTag('burnt')).toBe(false); // TREE_BURN_TIME * 1.5
    scheduler.advance(1);
    expect(prefabInstance(tree.model!)!.sprite.currentAnimation).toBe('burnt_tall');
    scheduler.advance(.5);
    expect(target.components.burnable).toBeUndefined(); expect(target.components.workable!.GetWorkLeft()).toBe(1);
    expect(forest.exportState(tree)).toEqual({ moonTree: { size: 'tall', burnt: true }, growable: { stage: 3 },
      moonTreeTimer: { timers: { decay: { timeleft: 14399, initial_time: 14400, paused: false } } } });
    expect(lookupPrefabInstance(tree.model!)!.minimap.icon).toBe('moon_tree_burnt.png');
    await area.visit(new THREE.Vector3(500, 0, 0)); await area.visit(new THREE.Vector3());
    expect(prefabInstance(tree.model!)!.sprite.currentAnimation).toBe('burnt_tall');
    expect(performToolWork('CHOP', findActionEntity(tree.model!), {})).toBe(true);
    expect(dropLoot).toHaveBeenCalledWith([{ itemId: 'charcoal', count: 1 }], tree.position);
    for (let i = 0; i < 60; i++) forest.update(1 / 30);
    expect(forest.entities).toEqual([]);
  } finally { forest.dispose(); }
});

it('burns a planted flower to ash, leaving it out of the save while it burns', async () => {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler();
  const { worldEvents, ashSpawned } = ashEvents();
  const world = { scene, player: new THREE.Group(), ground: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    renderer: { domElement: new EventTarget() }, createCursorLabel: () => ({ show() {}, hide() {}, update() {} }) } as unknown as WorldContext;
  const flowers = new FlowerPlanting(world, Math.random, { scheduler, worldEvents });
  try {
    const model = await flowers.spawnFromSave('flower-1', 'f1', new THREE.Vector3(3, 0, 4));
    const target = findActionEntity(model) as ComponentActionEntity;
    expect(light(target)).toBe(true); await flush();
    expect(fires(scene)).toBe(1); expect(flowers.exportRecords()).toEqual([]);
    scheduler.advance(10); await flush();
    expect(ashSpawned).toHaveBeenCalledWith(new THREE.Vector3(3, 0, 4));
    expect(fires(scene)).toBe(0); expect(model.parent).toBeNull(); expect(target.isRemoved).toBe(true);
    expect(flowers.exportRecords()).toEqual([]);
  } finally { flowers.dispose(); }
});
