import { prefabDisplay } from '@dontstarve-web/display';
import { createTestWorldFx } from './worldFxFixture';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { withEntity } from './entityFixture';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RESEARCH_LAB_IDS } from '../../prefab/src/scienceprototyper';
import { managedBuildings } from './managedBuildings';
import type { WorldContext } from '../../prefab/src/worldContext';
import { Builder } from '../../componets/src/builder';
import { actionEntity, findActionEntity } from '../../prefab/src/actionEntity';
import { WORLD_SCALE } from '../../prefab/src/standardcomponents';
import { PlaySound } from '../../prefab/src/sound';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { reskinEntity } from '../../prefab/src/reskin_tool';
import { workTargets } from './workTargets';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { FireFxHost } from '../../prefab/src/treeFire';
import { PrefabDisplayGroup } from '../../display/src';
import { createSignal } from '../../signals/src';
import { InventoryStore } from '../../inventory/src';
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PlaceableBuildingPlacement } from '../../../src/placeableBuilding';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';

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
  const scene = new THREE.Scene(), fx = createTestWorldFx(scene);
  const world = { scene, fx, player: new THREE.Object3D(), camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(), renderer: { domElement: new EventTarget() }, dropLoot } as unknown as WorldContext;
  world.player.position.set(100, 0, 100);
  const placement = managedBuildings(world);
  const model = placement.spawnFromSave(id, {
    id: `test_${id}`, transform: { position: [3, 0, 4], rotationY: 0 },
    components: { building: { ...(skinId ? { skinId } : {}) } },
  }) as THREE.Group;
  // The builder searches the world its player is in; a test that reloads into a new world moves it there.
  const sim = { current: placement.prefabs };
  const builder = new Builder(actionEntity(withEntity(world.player as THREE.Group, 'waxwell'), 'waxwell'), {
    findEntities: (...args) => sim.current.FindEntities(...args) as never, researchMachineDistance: 4 * WORLD_SCALE,
  });
  const animation = () => prefabInstance<PrefabInstance>(model)!.sprite;
  const reskinTarget = () => findActionEntity(model)!.reskinTarget!;
  const finish = () => { for (let i = 0; i < 80; i++) { placement.update(1 / 30); fx.update(1 / 30, world.camera.quaternion); } };
  // The display loads the lab art; standalone collapse effects load from their own shared owner.
  await vi.waitFor(() => expect(animation().loaded).toBe(true));
  return { placement, model, world, fx, animation, finish, dropLoot, builder, reskinTarget, sim };
}

it.each(['researchlab'] as const)('%s fires hit/finish callbacks once and removes its record on hit four', async (id) => {
  const { placement, model, world, fx, animation, finish, dropLoot, builder, reskinTarget } = await setup(id);
  try {
    const target = workTargets('HAMMER')[0], reskin = reskinTarget();
    const before = placement.exportRecords();
    // Frame geometry changes with the clip, so observe the release rather than one frame's geometry.
    const disposeGeometry = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    for (let i = 0; i < 3; i++) {
      target.work();
      expect(animation().currentAnimation).toBe('hit');
      expect(placement.exportRecords()).toEqual(before);
      expect(dropLoot).not.toHaveBeenCalled();
      finish();
      expect(animation().currentAnimation).toBe('idle');
    }
    target.work();
    const dropped = dropLoot.mock.calls.flatMap(([items]) => items.flatMap(({ itemId, count }: { itemId: string; count: number }) => Array(count).fill(itemId)));
    expect(dropped.sort()).toEqual(['goldnugget', 'log', 'log', 'rocks', 'rocks']);
    expect(dropLoot.mock.calls.every(([, position]) => position.equals(new THREE.Vector3(3, 0, 4)))).toBe(true);
    expect(PlaySound).toHaveBeenCalledTimes(2);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/common/destroy_wood', new THREE.Vector3(3, 0, 4));
    // The display leaves the scene in its status effect, after the entity's removal.
    expect(prefabInstance(model)!.isRemoved).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(model.parent).toBeNull();
    expect(disposeGeometry).toHaveBeenCalled();
    expect(target.isValid()).toBe(false);
    expect(workTargets('HAMMER')).toEqual([]);
    expect(reskinEntity(reskin)).toBe(false);
    expect(placement.exportRecords()).toEqual([]);
    const effect = world.scene.children.find((model) => model.name === 'collapse_small')!;
    expect(prefabInstance(effect)!.persists).toBe(false);
    expect([...prefabInstance(effect)!.listTags()].sort()).toEqual(['FX', 'NOCLICK']);
    expect(effect.position.toArray()).toEqual([3, 0, 4]);
    expect(fx.renderEntities.map(({ object }) => object)).toEqual([effect]);
    dropLoot.mockClear();
    target.work();
    expect(dropLoot).not.toHaveBeenCalled();
    await prefabDisplay(effect)!.artLoaded();
    finish();
    expect(effect.parent).toBeNull();
    expect(fx.renderEntities).toEqual([]);
  } finally { builder.dispose(); placement.dispose(); fx.dispose(); }
});

it('preserves work through reskinning and restores proximity after hits', async () => {
  const { placement, model, world, fx, animation, finish, dropLoot, builder, reskinTarget } = await setup('researchlab2', 'researchlab2_pod');
  try {
    world.player.position.copy(model.position);
    builder.EvaluateTechTrees();
    placement.update(0);
    expect(animation().currentAnimation).toBe('proximity_loop');
    workTargets('HAMMER')[0].work();
    finish();
    expect(animation().currentAnimation).toBe('proximity_loop');
    const prototyper = prefabInstance(model)!.components.prototyper;
    expect(reskinEntity(reskinTarget())).toBe(true);
    expect(prefabInstance(model)!.components.prototyper).toBe(prototyper);
    expect(prototyper!.on).toBe(true);
    for (let i = 0; i < 2; i++) { workTargets('HAMMER')[0].work(); finish(); }
    expect(dropLoot).not.toHaveBeenCalled();
    workTargets('HAMMER')[0].work();
    // The display leaves the scene in its status effect, after the entity's removal.
    expect(prefabInstance(model)!.isRemoved).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(model.parent).toBeNull();
    expect(dropLoot).toHaveBeenCalled();
    const effect = world.scene.children[0];
    await prefabDisplay(effect)!.artLoaded();
    let effectMesh!: THREE.Mesh;
    effect.traverse(object => { if (object instanceof THREE.Mesh) effectMesh ??= object; });
    const disposeMaterial = vi.spyOn((effectMesh.material as THREE.Material[])[0], 'dispose');
    fx.dispose();
    await Promise.resolve();
    expect(effect.parent).toBeNull();
    expect(disposeMaterial).toHaveBeenCalledOnce();
  } finally { builder.dispose(); placement.dispose(); fx.dispose(); }
});

it('queues magic station transitions across reskinning, then rebuilds transient use state on load', async () => {
  const { placement, model, world, animation, builder, reskinTarget, sim } = await setup('researchlab3');
  let restored: ReturnType<typeof managedBuildings> | undefined;
  try {
    world.player.position.copy(actionEntity(model, 'researchlab3').getPosition());
    placement.update(0);
    expect(animation().currentAnimation).toBe('idle'); // Placement does not select a station.
    builder.EvaluateTechTrees();
    expect(animation().currentAnimation).toBe('proximity_pre');
    const component = prefabInstance(model)!.components.prototyper;
    const sound = vi.mocked(PlaySound).mock.results.at(-1)!.value;
    expect(reskinEntity(reskinTarget())).toBe(true);
    expect(prefabInstance(model)!.components.prototyper).toBe(component);
    for (let i = 0; i < 300; i++) placement.update(1 / 30);
    expect(animation().currentAnimation).toBe('proximity_loop');
    expect(sound.stop).not.toHaveBeenCalled();
    const record = placement.exportRecords()[0].record;
    expect(record.components).not.toHaveProperty('prototyper');
    world.player.position.x += 4 * WORLD_SCALE + .01;
    builder.EvaluateTechTrees();
    expect(component!.on).toBe(false);
    expect(animation().currentAnimation).toBe('proximity_loop'); // PushAnimation waits for the current pass.
    expect(sound.stop).toHaveBeenCalledOnce();
    for (let i = 0; i < 300; i++) placement.update(1 / 30);
    expect(animation().currentAnimation).toBe('idle');
    placement.dispose();

    restored = managedBuildings(world);
    sim.current = restored.prefabs;
    const loaded = restored.spawnFromSave('researchlab3', record) as THREE.Group;
    expect(prefabInstance(loaded)!.components.prototyper!.on).toBe(false);
    world.player.position.copy(actionEntity(loaded, 'researchlab3').getPosition());
    builder.EvaluateTechTrees();
    expect(prefabInstance(loaded)!.components.prototyper!.on).toBe(true);
    expect(builder.accessible_tech_trees.peek().MAGIC).toBe(3);
    expect(restored.exportRecords()[0].record).toEqual(record);
    // DefaultBurntStructureFn kills idlesound itself: onturnoff returns early once the station is burnt.
    const idlesound = vi.mocked(PlaySound).mock.results.at(-1)!.value;
    const lab = prefabInstance(loaded)!;
    lab.components.burnable!.onburnt!(lab);
    expect(idlesound.stop).toHaveBeenCalledOnce();
    expect(lab.components.prototyper).toBeUndefined();
    restored.dispose();
    restored = managedBuildings(world);
    sim.current = restored.prefabs;
    const burnt = restored.spawnFromSave('researchlab3', { ...record,
      components: { ...record.components, building: { ...record.components.building!, burnt: true } } }) as THREE.Group;
    builder.EvaluateTechTrees();
    expect(prefabInstance(burnt)!.components.prototyper).toBeUndefined();
    expect(actionEntity(burnt, 'researchlab3').hasTag('prototyper')).toBe(false);
    expect(builder.current_prototyper).toBeUndefined();
    expect(builder.accessible_tech_trees.peek().MAGIC).toBe(0);
  } finally { builder.dispose(); placement.dispose(); restored?.dispose(); }
});

it('c_spawn then c_save reloads a research lab as a prototyper in the building save shape', async () => {
  const scheduler = new GameTimeScheduler(), fire = FireFxHost.create();
  const registryFor = () => {
    const scene = new THREE.Scene(), displays = new PrefabDisplayGroup(scene);
    const world = { scene, player: new THREE.Object3D(), ground: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
      cameraFacing: createSignal(8), cameraHeading: createSignal(45), renderer: { domElement: new EventTarget() }, scheduler, fire,
      createCursorLabel: () => ({ show() {}, hide() {}, update() {} }) } as unknown as WorldContext;
    const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {});
    const placement = new PlaceableBuildingPlacement(world, () => true, undefined, prefabs);
    const registry = new EntityRegistry([], prefabs);
    registry.register(PREFAB_DEFINITIONS.buildings, {
      restore: (id, record) => placement.spawnFromSave(id, record), debugSpawn: id => placement.spawn(id),
      exportRecords: () => placement.exportRecords(), dispose: () => placement.dispose(),
    });
    return { registry, prefabs, dispose: () => { registry.dispose(); prefabs.dispose(); displays.dispose(); } };
  };
  const first = registryFor(), restored = registryFor(), inventory = new InventoryStore([], SAVE_CATALOG.items);
  try {
    expect((await executeDebugCommand('c_spawn("researchlab4")', inventory, prefab => first.registry.spawn(prefab))).ok).toBe(true);
    const template = deserializeSave(await readFile(new URL('../../../public/saves/initial-world.json', import.meta.url), 'utf8'), SAVE_CATALOG);
    let exported = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      exported = serializeSave(template, { entities: { ...template.world.entities, ...first.registry.exportRecords() },
        inventory: inventory.exportState(), playerTransform: { position: [0, 0, 0], rotationY: 0 }, elapsedSeconds: 0 }, SAVE_CATALOG);
    })).ok).toBe(true);
    const records = deserializeSave(exported, SAVE_CATALOG).world.entities.researchlab4;
    expect(records).toHaveLength(1);
    expect(records[0].components).toEqual({ building: {} });
    await restored.registry.restoreAll({ researchlab4: records });
    expect(restored.registry.exportRecords().researchlab4).toEqual(records);
    const [lab] = restored.prefabs.instances('researchlab4');
    expect(lab.hasTag('level4')).toBe(true);
    expect(lab.components.prototyper!.GetTechTrees().MAGIC).toBe(2);
  } finally { first.dispose(); restored.dispose(); inventory.dispose(); fire.dispose(); scheduler.dispose(); }
});
