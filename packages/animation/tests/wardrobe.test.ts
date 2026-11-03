import { readFile } from 'node:fs/promises';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prefabDisplay, PrefabDisplayGroup } from '../../display/src';
import { InventoryStore } from '../../inventory/src';
import { createSignal } from '../../signals/src';
import { findActionEntity } from '../../prefab/src/actionEntity';
import { PrefabEntityManager, PrefabInstance } from '../../prefab/src/prefabInstance';
import { WORLD_SCALE } from '../../prefab/src/tile';
import { WARDROBE_ID, wardrobePrefabs } from '../../prefab/src/wardrobe';
import type { WorldContext } from '../../prefab/src/worldContext';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PlaceableBuildingPlacement } from '../../../src/placeableBuilding';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';

const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { createElement: () => ({ setAttribute: vi.fn(), style: {} }), body: { appendChild: vi.fn() } });
  vi.spyOn(PointerRaycaster.prototype, 'trackPointer').mockImplementation(() => {});
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(new THREE.Vector3(3, 0, 4));
  vi.spyOn(PointerRaycaster.prototype, 'isOverGround', 'get').mockReturnValue(true);
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function setup() {
  const canvas = new EventTarget(), scene = new THREE.Scene(), physics = new CANNON.World(), displays = new PrefabDisplayGroup(scene);
  const world = { physics, scene, player: new THREE.Object3D(), ground: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    cameraFacing: createSignal(8), cameraHeading: createSignal(45), renderer: { domElement: canvas },
    createCursorLabel: () => ({ show() {}, hide() {}, update() {} }) } as unknown as WorldContext;
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { physics }, wardrobePrefabs());
  const consume = vi.fn(() => true), placement = new PlaceableBuildingPlacement(world, consume, undefined, prefabs);
  const registry = new EntityRegistry([], prefabs);
  registry.register(PREFAB_DEFINITIONS.buildings, {
    restore: (id, record) => placement.spawnFromSave(id, record), debugSpawn: id => placement.spawn(id),
    exportRecords: () => placement.exportRecords(), dispose: () => placement.dispose(),
  });
  cleanups.push(() => { registry.dispose(); prefabs.dispose(); displays.dispose(); });
  const click = (button = 0) => canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button }));
  return { physics, displays, prefabs, consume, placement, registry, click };
}

it('builds through its placer: a refused or cancelled build makes nothing, a commit spawns the building and fires onbuilt', async () => {
  const { physics, prefabs, consume, placement, click } = setup();
  const spawn = vi.spyOn(prefabs, 'spawn');
  const pushed = vi.spyOn(PrefabInstance.prototype, 'PushEvent');
  await placement.begin(WARDROBE_ID);
  click(2);
  click();
  expect(consume).not.toHaveBeenCalled();
  await placement.begin(WARDROBE_ID);
  consume.mockReturnValueOnce(false); click();
  expect(prefabs.exportRecords()).toEqual([]);
  click();
  expect(consume).toHaveBeenCalledTimes(2);
  const wardrobe = spawn.mock.results[0].value as PrefabInstance;
  expect(wardrobe.position.toArray()).toEqual([3, 0, 4]);
  expect(pushed.mock.contexts.filter((inst, index) => inst === wardrobe && pushed.mock.calls[index][0] === 'onbuilt')).toHaveLength(1);
  expect(physics.bodies[0].shapes.some(shape => shape instanceof CANNON.Sphere && shape.radius === .75 * WORLD_SCALE)).toBe(true);
  // The placer has gone: another click builds nothing.
  click();
  expect(spawn).toHaveBeenCalledOnce();
});

it('stands its sprite on the ground, and the greenstaff can deconstruct it', async () => {
  const { physics, prefabs, displays } = setup();
  const wardrobe = prefabs.spawn(WARDROBE_ID, new THREE.Vector3(1, 0, 2));
  await prefabDisplay(wardrobe.transform.model)!.artLoaded();
  displays.update(1 / 30);
  wardrobe.transform.model.updateWorldMatrix(true, true);
  expect(new THREE.Box3().setFromObject(wardrobe.transform.model).min.y).toBeCloseTo(0);
  const target = findActionEntity(wardrobe.transform.model)!.deconstructionTarget!;
  expect(target.isValid()).toBe(true);
  expect(target.removeOne()).toBe(true);
  expect(wardrobe.isRemoved).toBe(true);
  expect(target.isValid()).toBe(false);
  expect(physics.bodies).toHaveLength(0);
});

it('c_spawn wardrobes save in the building shape and reload', async () => {
  const { registry } = setup(), { registry: restored } = setup(), inventory = new InventoryStore([], SAVE_CATALOG.items);
  cleanups.push(() => inventory.dispose());
  expect((await executeDebugCommand('c_spawn("wardrobe")', inventory, prefab => registry.spawn(prefab))).ok).toBe(true);
  const template = deserializeSave(await readFile(new URL('../../../public/saves/initial-world.json', import.meta.url), 'utf8'), SAVE_CATALOG);
  let exported = '';
  expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
    exported = serializeSave(template, { entities: { ...template.world.entities, ...registry.exportRecords() }, inventory: inventory.exportState(),
      playerTransform: { position: [0, 0, 0], rotationY: 0 }, elapsedSeconds: 0 }, SAVE_CATALOG);
  })).ok).toBe(true);
  const records = deserializeSave(exported, SAVE_CATALOG).world.entities.wardrobe;
  expect(records).toHaveLength(1);
  expect(records[0].components).toEqual({ building: {} });
  await restored.restoreAll({ wardrobe: records });
  expect(restored.exportRecords().wardrobe).toEqual(records);
});
