import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { GrassManager } from '../../prefab/src/grass';
import { PlantDeployment } from '../../prefab/src/plantDeployment';
import { TurfDeployment } from '../../prefab/src/turfDeployment';
import type { TurfMap } from '../../prefab/src/turfMap';
import { setModelTag } from '../../prefab/src/prefabInstance';
import { createInventoryStore } from '../../../src/inventory';
import { cursorSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { createSignal } from '../../signals/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { getActionString } from '../../stategraphs/src/actions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { bindTestWorld, drawn, plantInstance } from './worldContentFixture';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { workTargets } from './workTargets';
import type { WorldContext } from '../../prefab/src/worldContext';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** A cursor-held stack, the shared picker and a pointer over `ground`, hitting `hit` when set. */
async function setup(item: string, ground: THREE.Vector3, hit: { model?: THREE.Object3D } = {}) {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const scene = new THREE.Scene(), player = new THREE.Group(), canvas = new EventTarget();
  const scheduler = new GameTimeScheduler();
  bindTestWorld(scheduler);
  const inventory = createInventoryStore([]);
  expect((await executeDebugCommand(`c_give("${item}",2)`, inventory)).ok).toBe(true);
  expect(inventory.transfer(inventorySlotAddress(0), cursorSlotAddress(), 2)).toBe(true);
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockImplementation(() => ground.clone());
  vi.spyOn(PointerRaycaster.prototype, 'pickMouseTarget').mockImplementation(() =>
    (hit.model ? { object: hit.model } : undefined) as unknown as THREE.Intersection);
  const world = { scene, player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    cameraFacing: createSignal(1), cameraHeading: createSignal(0), renderer: { domElement: canvas } as unknown as THREE.WebGLRenderer,
    mouseActions: new PlayerActionPicker(new PointerRaycaster({ camera: new THREE.PerspectiveCamera(), renderer: { domElement: canvas } as unknown as THREE.WebGLRenderer })),
  } as unknown as WorldContext;
  const graph = new WilsonStateGraph({ playAnimation: () => 1, playSound: () => {}, stopSound: () => {}, setCasting: () => {}, onStateChanged: () => {} });
  const locomotor = { destination: undefined, goToPoint: vi.fn(() => true), stop: vi.fn() };
  const source = () => {
    const address = cursorSlotAddress(), entity = inventory.getEntity(address);
    if (!entity) return undefined;
    const isValid = () => inventory.getEntity(address) === entity && !entity.isRemoved;
    return { entity, isValid, take: () => isValid() ? inventory.extract(address, 1, entity) ?? undefined : undefined,
      putBack: (back: typeof entity) => { inventory.receiveAt(address, back); },
      returnActiveItem: () => { inventory.returnCursor(); } };
  };
  const rightClick = () => {
    const event = Object.assign(new Event('pointerdown', { cancelable: true }), { button: 2, clientX: 0, clientY: 0 });
    canvas.dispatchEvent(event);
    return event;
  };
  return { scene, player, world, inventory, scheduler, graph, locomotor, source, rightClick,
    held: () => inventory.get(cursorSlotAddress())?.count ?? 0 };
}

function grassDeployment(s: Awaited<ReturnType<typeof setup>>) {
  const grasses = new GrassManager(s.scene, '/dst/data/anim', { spawnGroundItem: vi.fn() as never });
  const deployment = new PlantDeployment(s.world, s.graph, s.locomotor, s.source, {
    plants: { grass: grasses }, canPlant: point => point.x >= 0,
  });
  return { grasses, deployment };
}

it('right-clicking valid ground plants dug_grass barren at frame six, keeps the stack held and survives c_save', async () => {
  const s = await setup('dug_grass', new THREE.Vector3(2, 0, 0)), { grasses, deployment } = grassDeployment(s);
  try {
    const event = s.rightClick();
    expect(event.defaultPrevented).toBe(true);
    deployment.update(); s.graph.update(5 / 30);
    expect(grasses.exportRecords()).toEqual([]);
    s.graph.update(1 / 30);
    expect(s.held()).toBe(1);
    const [record] = grasses.exportRecords(), planted = workTargets('DIG', s.scene)[0].model;
    expect(record.transform.position).toEqual([2, 0, 0]);
    expect(record.components.pickable).toMatchObject({ transplanted: true });
    const pickable = plantInstance(planted).components.pickable;
    expect(pickable.IsBarren()).toBe(true);

    let json = '';
    const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => {
      json = serializeSave(template, { entities: { grass: grasses.exportRecords() },
        inventory: s.inventory.exportState(), elapsedSeconds: 0, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG);
    const reloaded = new GrassManager(s.scene, '/dst/data/anim', { spawnGroundItem: vi.fn() as never });
    const model = await drawn(reloaded.spawn(new THREE.Vector3(2, 0, 0), saved.world.entities.grass[0]));
    expect(plantInstance(model).components.pickable.IsBarren()).toBe(true);
    reloaded.dispose();
  } finally { deployment.dispose(); grasses.dispose(); s.inventory.dispose(); s.scheduler.dispose(); }
});

it('right-clicking invalid ground returns the whole held stack instead of walking', async () => {
  const s = await setup('dug_grass', new THREE.Vector3(-1, 0, 0)), { grasses, deployment } = grassDeployment(s);
  try {
    expect(s.rightClick().defaultPrevented).toBe(true);
    deployment.update();
    expect(s.held()).toBe(0);
    expect(s.inventory.get(inventorySlotAddress(0))).toMatchObject({ itemId: 'dug_grass', count: 2 });
    expect(s.locomotor.goToPoint).not.toHaveBeenCalled();
  } finally { deployment.dispose(); grasses.dispose(); s.inventory.dispose(); s.scheduler.dispose(); }
});

it('an entity under the mouse replaces the point deploy unless it does not catch the mouse', async () => {
  const hit: { model?: THREE.Object3D } = {};
  const s = await setup('dug_grass', new THREE.Vector3(2, 0, 0), hit), { grasses, deployment } = grassDeployment(s);
  try {
    // The tuft is far from the ground point the pointer ray lands on, so spacing alone would allow planting there.
    const model = hit.model = await drawn(grasses.spawn(new THREE.Vector3(60, 0, 60)));
    // Another controller's action on the entity stays with that controller and keeps the item.
    const stopRepair = s.world.mouseActions!.register(() => [{ action: { action: 'REPAIR' }, button: 'right', model, source: 'inventory' }]);
    expect(s.rightClick().defaultPrevented).toBe(false);
    expect(s.held()).toBe(2);
    stopRepair();

    setModelTag(model, 'ignoremouseover', true);
    s.rightClick(); deployment.update();
    expect(s.locomotor.stop).toHaveBeenCalled();
    deployment.cancel();
    expect(s.held()).toBe(2);
    setModelTag(model, 'ignoremouseover', false);

    expect(s.rightClick().defaultPrevented).toBe(true);
    expect(s.held()).toBe(0);
    expect(grasses.exportRecords()).toHaveLength(1);
  } finally { deployment.dispose(); grasses.dispose(); s.inventory.dispose(); s.scheduler.dispose(); }
});

it('an active build placer keeps the right click and the held item', async () => {
  const s = await setup('dug_grass', new THREE.Vector3(-1, 0, 0)), { grasses, deployment } = grassDeployment(s);
  try {
    s.world.mouseActions!.registerPlacer(() => true);
    expect(s.rightClick().defaultPrevented).toBe(false);
    expect(s.held()).toBe(2);
  } finally { deployment.dispose(); grasses.dispose(); s.inventory.dispose(); s.scheduler.dispose(); }
});

it('turfs share the routing: Place Ground on dirt, returned off it', async () => {
  const s = await setup('turf_road', new THREE.Vector3(6, 0, 6));
  let dirt = true;
  const turf = { canPlaceTurf: () => dirt, tileCenter: (point: THREE.Vector3) => point } as unknown as TurfMap;
  const deployment = new TurfDeployment(s.world, turf, s.graph, s.locomotor, s.source);
  try {
    expect(getActionString(s.world.mouseActions!.getMouseActions().right!)).toBe('放置地皮');
    s.rightClick();
    expect(s.held()).toBe(2);
    deployment.cancel();
    dirt = false;
    expect(s.rightClick().defaultPrevented).toBe(true);
    expect(s.held()).toBe(0);
  } finally { deployment.dispose(); s.inventory.dispose(); s.scheduler.dispose(); }
});
