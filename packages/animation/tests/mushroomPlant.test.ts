import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { MushroomPlantManager } from '../../prefab/src/mushroom_plant';
import { GroundItemManager } from '../../../src/groundItems';
import { createInventoryStore } from '../../../src/inventory';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { bindTestWorld, drawn } from './worldContentFixture';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function setup() {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const inventory = createInventoryStore([]), scene = new THREE.Scene(), scheduler = new GameTimeScheduler();
  const ground = new GroundItemManager(scene, new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', new THREE.Group());
  const world = bindTestWorld(scheduler), rain = createSignal<'none' | 'rain' | 'snow'>('none');
  const mushrooms = new MushroomPlantManager(scene, '/dst/data/anim', { rain, spawnGroundItem: (definition, position, options) => ground.spawnGroundItem(definition, position, options) });
  const advance = (seconds: number) => { scheduler.advance(seconds); mushrooms.update(seconds, new THREE.Quaternion()); };
  return { inventory, scheduler, world, rain, ground, mushrooms, advance,
    dispose: () => { mushrooms.dispose(); ground.dispose(); inventory.dispose(); world.unbind(); scheduler.dispose(); } };
}
const picker = (inventory: ReturnType<typeof createInventoryStore>) => ({ giveItem: (id: string, count: number) => inventory.add(id, count) });

it('opens at night, is picked for a blue_cap, regrows after rainy periods and keeps its rain count in saves', async () => {
  const s = setup();
  try {
    const model = await drawn(s.mushrooms.spawn(new THREE.Vector3(3, 0, 4)));
    const pickable = model.userData.components.pickable;
    // Daytime: still in the ground, so it cannot be picked.
    expect(pickable.pick(picker(s.inventory))).toBe(false);
    s.world.cycle.set('night');
    await settle();
    s.advance(10);
    expect(pickable.pick(picker(s.inventory))).toBe(true);
    expect(s.inventory.count('blue_cap')).toBe(1);

    // Dry periods do not count; rainy ones do, and the saved record keeps the remaining count.
    s.advance(100);
    const { record } = s.mushrooms.exportRecords()[0];
    expect(record.components.pickable?.picked).toBe(true);
    expect(record.components.mushroom?.rain).toBeGreaterThan(0);
    s.rain.set('rain');
    for (let i = 0; i < 40 && !pickable.canBePicked; i++) s.advance(30);
    expect(pickable.canBePicked).toBe(true);
    expect(s.mushrooms.exportRecords()[0].record.components.pickable).toEqual({});

    const restored = new MushroomPlantManager(new THREE.Scene(), '/dst/data/anim', { rain: s.rain, spawnGroundItem: (definition, position, options) => s.ground.spawnGroundItem(definition, position, options) });
    try {
      await drawn(restored.spawn(new THREE.Vector3(...record.transform.position), record));
      expect(restored.exportRecords()[0].record.components).toEqual(record.components);
    } finally { restored.dispose(); }
  } finally { s.dispose(); }
}, 20000);

it('digs an unpicked mushroom into two blue_caps without releasing a neighbouring mushroom’s shared art', async () => {
  const s = setup();
  try {
    // Both are spawned before their shared art arrives, so they rest on the same frame.
    const [model, neighbour] = await Promise.all([s.mushrooms.spawn(new THREE.Vector3(1, 0, 1)), s.mushrooms.spawn(new THREE.Vector3(2, 0, 1))].map(drawn));
    const geometry = (model.children[0].children[0].children[0] as THREE.Mesh).geometry;
    expect((neighbour.children[0].children[0].children[0] as THREE.Mesh).geometry).toBe(geometry);
    const disposed = vi.fn(); geometry.addEventListener('dispose', disposed);
    const neighbourRecord = s.mushrooms.exportRecords()[1];
    const [dig] = s.mushrooms.getDigTargets();
    expect(performToolWork('DIG', dig.entity!, {})).toBe(true);
    await vi.waitFor(() => expect(s.ground.exportRecords().map(r => r.components.stack?.itemId)).toEqual(['blue_cap', 'blue_cap']));
    expect(s.mushrooms.exportRecords()).toEqual([neighbourRecord]);
    expect(disposed).not.toHaveBeenCalled();
    s.mushrooms.dispose();
    expect(disposed).toHaveBeenCalledOnce();
  } finally { s.dispose(); }
}, 20000);

it('opens red mushrooms by day and green mushrooms at dusk, each yielding its own cap and keeping its prefab id in saves', async () => {
  const s = setup();
  try {
    const red = await drawn(s.mushrooms.spawn(new THREE.Vector3(1, 0, 1), undefined, 'red_mushroom'));
    const green = await drawn(s.mushrooms.spawn(new THREE.Vector3(2, 0, 1), undefined, 'green_mushroom'));
    // Day: red is already open at construction; green waits in the ground.
    expect(green.userData.components.pickable.pick(picker(s.inventory))).toBe(false);
    expect(red.userData.components.pickable.pick(picker(s.inventory))).toBe(true);
    expect(s.inventory.count('red_cap')).toBe(1);
    s.world.cycle.set('dusk');
    await settle();
    s.advance(10);
    expect(green.userData.components.pickable.pick(picker(s.inventory))).toBe(true);
    expect(s.inventory.count('green_cap')).toBe(1);
    expect(s.mushrooms.exportRecords().map(({ prefabId }) => prefabId).sort()).toEqual(['green_mushroom', 'red_mushroom']);
  } finally { s.dispose(); }
});

it('turns static billboards only when the camera rotation signal changes and leaves their subtree alone otherwise', async () => {
  const s = setup();
  try {
    const scene = s.mushrooms['scene'] as THREE.Scene;
    const model = await drawn(s.mushrooms.spawn(new THREE.Vector3(3, 0, 4)));
    // The resident root holds the origin; the drawn sprite is its first child and its visual the first grandchild.
    const sprite = model.children[0], visual = sprite.children[0];
    scene.updateMatrixWorld();
    let visits = 0;
    const original = visual.updateMatrixWorld;
    visual.updateMatrixWorld = function (force) { visits++; original.call(this, force); };
    scene.updateMatrixWorld(); scene.updateMatrixWorld();
    expect(visits).toBe(0);

    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
    s.world.camerarotation.set(turned);
    await settle();
    expect(sprite.quaternion.equals(turned)).toBe(true);
    scene.updateMatrixWorld();
    expect(visits).toBe(1);
    expect(model.matrixWorld.elements[12]).toBeCloseTo(3);
    expect(sprite.matrixWorld.elements[2]).toBeCloseTo(-Math.sin(Math.PI / 4));

    // The same rotation again, as the host update passes it every frame, does not wake the subtree.
    s.mushrooms.update(0, turned); scene.updateMatrixWorld();
    expect(visits).toBe(1);
  } finally { s.dispose(); }
});

it('releases the mushroom sprite outside the tickingarea and keeps its pose and save record while unloaded', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const scheduler = new GameTimeScheduler(), world = bindTestWorld(scheduler), awake = createSignal(true);
  const inventory = createInventoryStore([]);
  const ground = new GroundItemManager(new THREE.Scene(), new THREE.PerspectiveCamera(), { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', new THREE.Group());
  const mushrooms = new MushroomPlantManager(new THREE.Scene(), '/dst/data/anim', { rain: createSignal<'none' | 'rain' | 'snow'>('none'),
    tickingarea: () => createMemo(() => awake.get()), spawnGroundItem: (definition, position, options) => ground.spawnGroundItem(definition, position, options) });
  const meshes = (model: THREE.Object3D) => { let count = 0; model.traverse(object => { if ((object as THREE.Mesh).isMesh) count++; }); return count; };
  try {
    const model = await drawn(mushrooms.spawn(new THREE.Vector3(3, 0, 4)));
    await settle();
    expect(meshes(model)).toBe(1);
    const record = mushrooms.exportRecords()[0].record;

    awake.set(false);
    await settle();
    expect(meshes(model)).toBe(0);
    expect(model.position.toArray()).toEqual([3, 0, 4]);
    expect(mushrooms.exportRecords()[0].record).toEqual(record);

    awake.set(true);
    await settle();
    expect(meshes(model)).toBe(1);
  } finally { mushrooms.dispose(); ground.dispose(); inventory.dispose(); world.unbind(); scheduler.dispose(); }
}, 20000);
