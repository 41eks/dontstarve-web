import { readFile } from 'node:fs/promises';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prefabDisplay, PrefabDisplayGroup, SpriteState } from '../../display/src';
import { findActionEntity } from '../../prefab/src/actionEntity';
import { CAMPFIRE_ID } from '../../prefab/src/campfire';
import { NIGHT_LIGHT_ID } from '../../prefab/src/nightlight';
import { PIG_HOUSE_ID } from '../../prefab/src/pighouse';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { reskinEntity } from '../../prefab/src/reskin_tool';
import type { WorldContext } from '../../prefab/src/worldContext';
import { createSignal } from '../../signals/src';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { PlaceableBuildingPlacement } from '../../../src/placeableBuilding';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import definitions from '../../prefab/src/definitions.json';

const cleanups: (() => void)[] = [];
let fetched: string[] = [];
beforeEach(() => {
  fetched = [];
  vi.stubGlobal('fetch', async (url: string) => { fetched.push(url); return new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))); });
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
  const collapse = vi.fn(), dropLoot = vi.fn();
  const world = { physics, scene, player: new THREE.Object3D(), ground: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    cameraFacing: createSignal(8), cameraHeading: createSignal(45), renderer: { domElement: canvas },
    createCursorLabel: () => ({ show() {}, hide() {}, update() {} }), fx: { collapse }, dropLoot } as unknown as WorldContext;
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { physics });
  const placement = new PlaceableBuildingPlacement(world, () => true, undefined, prefabs);
  cleanups.push(() => { placement.dispose(); prefabs.dispose(); displays.dispose(); });
  return { canvas, scene, physics, displays, prefabs, placement, collapse, dropLoot };
}

it('builds through its placer in the selected skin, and onbuilt plays the placing clip', async () => {
  const { placement, canvas, prefabs } = setup();
  const spawn = vi.spyOn(prefabs, 'spawn'), playOnce = vi.spyOn(SpriteState.prototype, 'playOnce');
  await placement.begin(CAMPFIRE_ID, 'campfire_cabin');
  canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0 }));
  const campfire = spawn.mock.results[0].value as PrefabInstance;
  expect(campfire.position.toArray()).toEqual([3, 0, 4]);
  expect(campfire.skinId).toBe('campfire_cabin');
  expect(playOnce).toHaveBeenCalledExactlyOnceWith('place');
  await expect(placement.begin(NIGHT_LIGHT_ID, 'not_a_skin')).rejects.toThrow('skin');
});

it('takes its source hammer work, drops its loot and collapses', async () => {
  const { prefabs, physics, displays, collapse, dropLoot } = setup();
  const house = prefabs.spawn(PIG_HOUSE_ID, new THREE.Vector3(1, 0, 2));
  expect(house.hasTag('structure')).toBe(true);
  await prefabDisplay(house.transform.model)!.artLoaded();
  displays.update(1 / 30);
  const workable = findActionEntity(house.transform.model)!.components.workable!;
  expect(workable.GetWorkAction()).toBe('HAMMER');
  expect(physics.bodies[0].shapes[0]).toBeDefined();
  workable.WorkedBy({ hasTag: () => false } as never, 3);
  expect(house.sprite.sprite.peek().clip.name).toBe('hit');
  workable.WorkedBy({ hasTag: () => false } as never, 1);
  expect(house.isRemoved).toBe(true);
  expect(collapse).toHaveBeenCalledWith('big', house.position, 'wood');
  expect(dropLoot).toHaveBeenCalled();
  expect(physics.bodies).toHaveLength(0);
});

it('reskins through its target, draws the skin build and keeps it through the building save shape', async () => {
  const { prefabs, placement, displays } = setup();
  const house = prefabs.spawn(PIG_HOUSE_ID, new THREE.Vector3(1, 0, 2));
  const target = findActionEntity(house.transform.model)!.reskinTarget!;
  expect(prefabs.exportRecords()[0].record.components).toEqual({ building: {} });
  expect(reskinEntity(target)).toBe(true);
  const { skinId } = house;
  expect(Object.keys(definitions.animatedBuildings.pighouse.skinArchives)).toContain(skinId);
  const [{ record }] = prefabs.exportRecords();
  expect(record.components).toEqual({ building: { skinId } });
  expect(PREFAB_DEFINITIONS.buildings.prefabIds).toContain(PIG_HOUSE_ID);

  const restored = prefabInstance(placement.spawnFromSave(PIG_HOUSE_ID, { ...record, id: 'restored' }) as THREE.Group)!;
  expect(restored.skinId).toBe(skinId);
  await prefabDisplay(restored.transform.model)!.artLoaded();
  displays.update(1 / 30);
  expect(fetched.some(url => url.endsWith(definitions.animatedBuildings.pighouse.skinArchives[skinId as keyof typeof definitions.animatedBuildings.pighouse.skinArchives]))).toBe(true);
});
