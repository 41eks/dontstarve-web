import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createSignal } from '@dontstarve-web/signals';
import { MushroomPlantManager } from '../../prefab/src/mushroom_plant';
import { GroundItemManager } from '../../../src/groundItems';
import { createInventoryStore } from '../../../src/inventory';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { bindTestWorld } from './worldContentFixture';

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
  const mushrooms = new MushroomPlantManager(scene, '/dst/data/anim', { rain, prepareSpawn: (definition, fling) => ground.prepareSpawn(definition, fling) });
  const advance = (seconds: number) => { scheduler.advance(seconds); mushrooms.update(seconds, new THREE.Quaternion()); };
  return { inventory, scheduler, world, rain, ground, mushrooms, advance,
    dispose: () => { mushrooms.dispose(); ground.dispose(); inventory.dispose(); world.unbind(); scheduler.dispose(); } };
}
const picker = (inventory: ReturnType<typeof createInventoryStore>) => ({ giveItem: (id: string, count: number) => inventory.add(id, count) });

it('opens at night, is picked for a blue_cap, regrows after rainy periods and keeps its rain count in saves', async () => {
  const s = setup();
  try {
    const model = await s.mushrooms.spawn(new THREE.Vector3(3, 0, 4));
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

    const restored = new MushroomPlantManager(new THREE.Scene(), '/dst/data/anim', { rain: s.rain, prepareSpawn: (d, f) => s.ground.prepareSpawn(d, f) });
    try {
      await restored.spawn(new THREE.Vector3(...record.transform.position), record);
      expect(restored.exportRecords()[0].record.components).toEqual(record.components);
    } finally { restored.dispose(); }
  } finally { s.dispose(); }
}, 20000);

it('digs an unpicked mushroom into two blue_caps without releasing a neighbouring mushroom’s shared art', async () => {
  const s = setup();
  try {
    const model = await s.mushrooms.spawn(new THREE.Vector3(1, 0, 1));
    const neighbour = await s.mushrooms.spawn(new THREE.Vector3(2, 0, 1));
    const geometry = (model.children[0].children[0] as THREE.Mesh).geometry;
    expect((neighbour.children[0].children[0] as THREE.Mesh).geometry).toBe(geometry);
    const disposed = vi.fn(); geometry.addEventListener('dispose', disposed);
    const neighbourRecord = s.mushrooms.exportRecords()[1];
    const [dig] = s.mushrooms.getDigTargets();
    expect(performToolWork('DIG', dig.entity, {})).toBe(true);
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
    const red = await s.mushrooms.spawn(new THREE.Vector3(1, 0, 1), undefined, 'red_mushroom');
    const green = await s.mushrooms.spawn(new THREE.Vector3(2, 0, 1), undefined, 'green_mushroom');
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
