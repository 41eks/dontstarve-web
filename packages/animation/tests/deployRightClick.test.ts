import { plantManager } from './plantManagerFixture';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { grassPrefabs } from '../../prefab/src/grass';
import { createDeployMap } from '../../prefab/src/deployMap';
import { placementEntities } from '../../prefab/src/placementEntities';
import { prefabInstance, setModelTag } from '../../prefab/src/prefabInstance';
import { createInventoryStore } from '../../../src/inventory';
import { cursorSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { createSignal } from '../../signals/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { getActionString } from '../../stategraphs/src/actions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { bindTestWorld, drawn, plantInstance } from './worldContentFixture';
import { deployActor, landTurf } from './deployActor';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { workTargets } from './workTargets';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import type { WorldContext } from '../../prefab/src/worldContext';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** A stack picked up from slot 2, the shared picker and a pointer over `pointer.ground`, hitting `pointer.model` when set. */
async function setup(item: string, ground: THREE.Vector3) {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const scene = new THREE.Scene(), player = new THREE.Group(), canvas = new EventTarget();
  const scheduler = new GameTimeScheduler();
  bindTestWorld(scheduler);
  const inventory = createInventoryStore([]);
  expect((await executeDebugCommand(`c_give("${item}",2)`, inventory)).ok).toBe(true);
  expect(inventory.transfer(inventorySlotAddress(0), inventorySlotAddress(2), 2)).toBe(true);
  expect(inventory.transfer(inventorySlotAddress(2), cursorSlotAddress(), 2)).toBe(true);
  const pointer: { ground: THREE.Vector3; model?: THREE.Object3D } = { ground };
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockImplementation(() => pointer.ground.clone());
  vi.spyOn(PointerRaycaster.prototype, 'pickMouseTarget').mockImplementation(() =>
    (pointer.model ? { object: pointer.model } : undefined) as unknown as THREE.Intersection);
  const renderer = { domElement: canvas } as unknown as THREE.WebGLRenderer;
  const world = { scene, player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(), renderer,
    cameraFacing: createSignal(1), cameraHeading: createSignal(0),
    mouseActions: new PlayerActionPicker(new PointerRaycaster({ camera: new THREE.PerspectiveCamera(), renderer })),
  } as unknown as WorldContext;
  const rightClick = () => {
    const event = Object.assign(new Event('pointerdown', { cancelable: true }), { button: 2, clientX: 0, clientY: 0 });
    canvas.dispatchEvent(event);
    return event;
  };
  return { scene, world, inventory, scheduler, pointer, rightClick, held: () => inventory.get(cursorSlotAddress())?.count ?? 0,
    dispose: () => { inventory.dispose(); scheduler.dispose(); } };
}

function grassActor(s: Awaited<ReturnType<typeof setup>>) {
  const grasses = plantManager(grassPrefabs, s.scene, { spawnGroundItem: vi.fn() as never });
  const map = createDeployMap({ turf: landTurf({ canDeployPlantAtPoint: (point: THREE.Vector3) => point.x >= 0 }),
    blockers: placementEntities(s.scene), spawnPrefab: (_prefab, position) => prefabInstance(grasses.spawn('grass', position).transform.model) as never });
  return { grasses, actor: deployActor(s.world, s.inventory, map) };
}

it('a right click walks, plants dug_grass barren at frame six, keeps the stack held and survives c_save', async () => {
  const s = await setup('dug_grass', new THREE.Vector3(2, 0, 0)), { grasses, actor } = grassActor(s);
  try {
    expect(s.rightClick().defaultPrevented).toBe(true);
    const walk = actor.locomotor.PushAction.mock.calls[0];
    expect(walk[0].target.getPosition().toArray()).toEqual([2, 0, 0]);
    walk[1]();
    actor.graph.update(5 / 30);
    expect(grasses.exportRecords().map(({ record }) => record)).toEqual([]);
    actor.graph.update(1 / 30);
    expect(s.held()).toBe(1);
    const [record] = grasses.exportRecords().map(({ record }) => record);
    expect(record.transform.position).toEqual([2, 0, 0]);
    expect(record.components.pickable).toMatchObject({ transplanted: true });
    expect(plantInstance(workTargets('DIG', s.scene)[0].model).components.pickable.IsBarren()).toBe(true);
    expect(actor.doer.PushEvent).toHaveBeenCalledWith('deployitem', { prefab: 'dug_grass' });

    let json = '';
    const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => {
      json = serializeSave(template, { entities: { grass: grasses.exportRecords().map(({ record }) => record) }, inventory: s.inventory.exportState(),
        elapsedSeconds: 0, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const reloaded = plantManager(grassPrefabs, s.scene, { spawnGroundItem: vi.fn() as never });
    const model = await drawn(reloaded.spawn('grass', new THREE.Vector3(2, 0, 0), deserializeSave(json, SAVE_CATALOG).world.entities.grass[0]).transform.model);
    expect(plantInstance(model).components.pickable.IsBarren()).toBe(true);
    reloaded.dispose();
  } finally { actor.controller.dispose(); grasses.dispose(); s.dispose(); }
});

it('no action at the pointer returns the whole held stack to the slot it came from', async () => {
  const s = await setup('dug_grass', new THREE.Vector3(-1, 0, 0)), { grasses, actor } = grassActor(s);
  try {
    expect(s.rightClick().defaultPrevented).toBe(true);
    expect(s.held()).toBe(0);
    expect(s.inventory.get(inventorySlotAddress(2))).toMatchObject({ itemId: 'dug_grass', count: 2 });
    expect(actor.locomotor.PushAction).not.toHaveBeenCalled();
  } finally { actor.controller.dispose(); grasses.dispose(); s.dispose(); }
});

it('an entity under the mouse replaces the point deploy unless it does not catch the mouse', async () => {
  const s = await setup('dug_grass', new THREE.Vector3(2, 0, 0)), { grasses, actor } = grassActor(s);
  try {
    // The tuft is far from the ground point the pointer ray lands on, so spacing alone would allow planting there.
    const model = s.pointer.model = await drawn(grasses.spawn('grass', new THREE.Vector3(60, 0, 60)).transform.model);
    // Another controller's action on the entity stays with that controller and keeps the item.
    const stopRepair = s.world.mouseActions!.register(() => [{ action: { action: 'REPAIR' }, button: 'right', model, source: 'inventory' }]);
    expect(s.rightClick().defaultPrevented).toBe(false);
    expect(s.held()).toBe(2);
    stopRepair();

    setModelTag(model, 'ignoremouseover', true);
    s.rightClick();
    expect(actor.locomotor.PushAction).toHaveBeenCalledTimes(1);
    actor.controller.cancel();
    expect(s.held()).toBe(2);
    setModelTag(model, 'ignoremouseover', false);

    expect(s.rightClick().defaultPrevented).toBe(true);
    expect(s.held()).toBe(0);
    expect(actor.locomotor.PushAction).toHaveBeenCalledTimes(1);
  } finally { actor.controller.dispose(); grasses.dispose(); s.dispose(); }
});

it('the registry spawns source prefab IDs for ondeploy and rejects unregistered ones', async () => {
  const s = await setup('dug_grass', new THREE.Vector3(2, 0, 0));
  const grasses = plantManager(grassPrefabs, s.scene, { spawnGroundItem: vi.fn() as never });
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.grasses, { restore: () => new THREE.Group(), debugSpawn: () => {}, exportRecords: () => [], dispose: () => {},
    spawnPrefab: { grass: position => grasses.spawn('grass', position).transform.model } });
  try {
    const inst = registry.SpawnPrefab('grass', new THREE.Vector3(6, 0, 6))!;
    expect(inst.prefab).toBe('grass');
    expect(inst.position.toArray()).toEqual([6, 0, 6]);
    expect(() => registry.SpawnPrefab('marsh_bush', new THREE.Vector3())).toThrow('marsh_bush');
  } finally { grasses.dispose(); s.dispose(); }
});

it('an active build placer keeps the right click and the held item', async () => {
  const s = await setup('dug_grass', new THREE.Vector3(-1, 0, 0)), { grasses, actor } = grassActor(s);
  try {
    s.world.mouseActions!.registerPlacer(() => true);
    expect(s.rightClick().defaultPrevented).toBe(false);
    expect(s.held()).toBe(2);
  } finally { actor.controller.dispose(); grasses.dispose(); s.dispose(); }
});

it('turfs share the DEPLOY path: the raw click is walked to, and a tile lost on the way fails only at the commit frame', async () => {
  const s = await setup('turf_road', new THREE.Vector3(7, 0, 8));
  let dirt = true;
  const setTile = vi.fn();
  const map = createDeployMap({ blockers: placementEntities(s.scene),
    turf: landTurf({ canPlaceTurf: () => dirt, setTile, tileCenter: () => ({ x: 6, z: 6 }) }) });
  const actor = deployActor(s.world, s.inventory, map);
  try {
    expect(getActionString(s.world.mouseActions!.getMouseActions().right!)).toBe('放置地皮');
    s.rightClick();
    const walk = actor.locomotor.PushAction.mock.calls[0];
    expect(walk[0].target.getPosition().toArray()).toEqual([7, 0, 8]);
    dirt = false;
    walk[1]();
    expect(actor.graph.stateName).toBe('doshortaction');
    actor.graph.update(6 / 30);
    expect(setTile).not.toHaveBeenCalled();
    expect(s.held()).toBe(2);

    dirt = true;
    actor.graph.update(1);
    s.rightClick();
    actor.locomotor.PushAction.mock.calls[1][1]();
    actor.graph.update(6 / 30);
    expect(setTile).toHaveBeenCalledOnce();
    expect(s.held()).toBe(1);

    dirt = false;
    actor.graph.update(1);
    expect(s.rightClick().defaultPrevented).toBe(true);
    expect(s.held()).toBe(0);
  } finally { actor.controller.dispose(); s.dispose(); }
});
