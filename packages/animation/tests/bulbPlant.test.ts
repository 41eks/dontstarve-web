import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BulbPlantController, BulbPlantManager, bulbPlantLight, bulbPlantRegrowTime, BULB_PLANT_LIGHT,
  type BulbPlantVariant, type BulbPlantSaveState } from '../../prefab/src/bulb_plant';
import { getPrefabLocalLight, setPrefabLocalLight } from '../../prefab/src/localLight';
import { DstLocalLighting } from '../../../src/dstLocalLighting';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(variant: BulbPlantVariant = 'single', saved?: BulbPlantSaveState) {
  const model = new THREE.Group();
  const animation = { update: vi.fn(), playOnce: vi.fn(), start: vi.fn() };
  let light = 1;
  const controller = new BulbPlantController(model, animation, { getLightLevel: () => light }, variant, saved, () => 0);
  return { model, animation, controller, setLight: (value: number) => { light = value; } };
}

describe('flower_cave source light cycle', () => {
  it('uses source overshoot/settling and drain curves for all plant sizes', () => {
    expect(bulbPlantLight(true, 0)).toBeNull();
    expect(bulbPlantLight(false, 1)).toBeNull();
    expect(bulbPlantLight(true, 1)).toEqual(BULB_PLANT_LIGHT);
    expect(bulbPlantLight(true, 0.33)).toMatchObject({ radius: 9 * 1.33, intensity: 0.8, falloff: 0.4 });
    expect(bulbPlantLight(false, 0.5)).toMatchObject({ radius: 4.5, intensity: 0.4, falloff: 0.75 });
    expect(bulbPlantLight(true, 1, 'springy')?.radius).toBe(9);
    expect(bulbPlantLight(true, 1, 'double')?.radius).toBe(13.5);
    expect(bulbPlantLight(true, 1, 'triple')?.radius).toBe(13.5);
  });

  it('waits on wake, turns on in light, drains after 94 seconds and recharges after 114', () => {
    const s = setup();
    s.controller.update(0.9);
    expect(s.controller.lightState).toBe('CHARGED');
    s.controller.update(0.2);
    expect(s.controller.lightState).toBe('ON');
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('recharge', expect.any(Function));
    s.controller.update(3.9);
    expect(getPrefabLocalLight(s.model)).toEqual(BULB_PLANT_LIGHT);
    s.controller.update(90);
    expect(s.controller.lightState).toBe('RECHARGING');
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('drain', expect.any(Function));
    s.controller.update(4);
    expect(getPrefabLocalLight(s.model)).toBeUndefined();
    s.setLight(0);
    s.controller.update(110);
    expect(s.controller.lightState).toBe('CHARGED');
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('revive', expect.any(Function));
    expect(s.controller.exportState('single')).toEqual({ variant: 'single', lightState: 'CHARGED' });
  });

  it('observes LightWatcher hysteresis and does not turn off just because ambient becomes dark', () => {
    const s = setup();
    s.setLight(0);
    s.controller.update(2);
    s.setLight(0.06);
    s.controller.update(1);
    expect(s.controller.lightState).toBe('CHARGED');
    s.setLight(0.075);
    s.controller.update(4);
    expect(s.controller.lightState).toBe('ON');
    s.setLight(0);
    s.controller.update(1);
    expect(s.controller.lightState).toBe('ON');
    expect(getPrefabLocalLight(s.model)).toEqual(BULB_PLANT_LIGHT);
  });

  it('restores full ON light and remaining timers, then cleans up light and stale callbacks', () => {
    const s = setup('double', { variant: 'double', lightState: 'ON', remainingSeconds: 2 });
    expect(getPrefabLocalLight(s.model)?.radius).toBe(13.5);
    s.controller.update(2);
    expect(s.controller.lightState).toBe('RECHARGING');
    const complete = s.animation.playOnce.mock.calls.at(-1)![1] as () => void;
    s.controller.dispose();
    complete();
    s.controller.update(100);
    expect(getPrefabLocalLight(s.model)).toBeUndefined();
    expect(s.animation.start).not.toHaveBeenCalled();
  });
});

describe('flower_cave harvesting and regrowth', () => {
  it.each([
    ['single', 1, 1440], ['springy', 1, 1440], ['double', 2, 2160], ['triple', 3, 2880],
  ] as const)('picks %s for %i fruit and regrows after %i seconds', (variant, count, seconds) => {
    const s = setup(variant);
    s.controller.update(5);
    const full = vi.fn(() => false);
    const before = s.controller.exportState(variant);
    expect(s.controller.tryPick(full)).toBe(false);
    expect(full).toHaveBeenCalledWith(count);
    expect(s.controller.exportState(variant)).toEqual(before);
    expect(getPrefabLocalLight(s.model)).toBeDefined();

    const give = vi.fn(() => true);
    expect(s.controller.tryPick(give)).toBe(true);
    expect(give).toHaveBeenCalledWith(count);
    expect(getPrefabLocalLight(s.model)).toBeUndefined();
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('picking', expect.any(Function));
    expect(s.controller.tryPick(give)).toBe(false);
    expect(give).toHaveBeenCalledTimes(1);
    expect(s.controller.exportState(variant)).toEqual({
      variant, lightState: 'RECHARGING', picked: true, regrowSeconds: seconds,
    });

    s.controller.update(seconds - 0.25);
    expect(s.controller.canPick).toBe(false);
    s.controller.update(0.25);
    expect(s.controller.canPick).toBe(true);
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('grow', expect.any(Function));
    expect(s.controller.exportState(variant)).toEqual({ variant, lightState: 'RECHARGING', remainingSeconds: 114 });
    expect(s.controller.tryPick(give)).toBe(true);
    expect(give).toHaveBeenCalledTimes(2);
  });

  it('restores picked plants without light or picking until the saved regrow timer expires', () => {
    const s = setup('double', { variant: 'double', lightState: 'RECHARGING', picked: true, regrowSeconds: 2 });
    expect(s.controller.canPick).toBe(false);
    expect(getPrefabLocalLight(s.model)).toBeUndefined();
    s.controller.update(1.5);
    expect(s.controller.exportState('double')).toEqual({
      variant: 'double', lightState: 'RECHARGING', picked: true, regrowSeconds: 0.5,
    });
    s.controller.update(0.5);
    expect(s.controller.canPick).toBe(true);
    expect(s.controller.lightState).toBe('RECHARGING');
  });

  it('allows harvesting unlit mature plants and invalidates a pending light animation callback', () => {
    const s = setup();
    s.setLight(0);
    expect(s.controller.tryPick(() => true)).toBe(true);
    expect(s.controller.exportState('single').lightState).toBe('CHARGED');
    expect(s.model.userData.bulbPlantPicked).toBe(true);
    const lit = setup();
    lit.controller.update(2);
    const rechargeComplete = lit.animation.playOnce.mock.calls.at(-1)![1] as () => void;
    lit.controller.tryPick(() => true);
    rechargeComplete();
    expect(lit.animation.start).not.toHaveBeenCalled();
  });
});

describe('lightmap sampling for LightWatcher', () => {
  it('samples ambient and existing lights with the renderer falloff and excludes the plant itself', () => {
    const scene = new THREE.Scene();
    const plant = new THREE.Group();
    const lantern = new THREE.Group();
    scene.add(plant, lantern);
    const lighting = new DstLocalLighting();
    lighting.setAmbientColour(new THREE.Vector3());
    setPrefabLocalLight(plant, BULB_PLANT_LIGHT);
    lighting.prepareScene(scene);
    expect(lighting.sampleLightLevel(new THREE.Vector3(), plant)).toBe(0);
    setPrefabLocalLight(lantern, { radius: 9, intensity: 0.8, falloff: 0.5, colour: [1, 1, 1] });
    lighting.prepareScene(scene);
    expect(lighting.sampleLightLevel(new THREE.Vector3(9, 0, 0), plant)).toBeCloseTo(0.4);
    expect(lighting.sampleLightLevel(new THREE.Vector3(27, 0, 0), plant)).toBe(0);
    setPrefabLocalLight(lantern, null);
    expect(lighting.sampleLightLevel(new THREE.Vector3(), plant)).toBe(0);
    lighting.setAmbientColour(new THREE.Vector3(0.1, 0.1, 0.1));
    expect(lighting.sampleLightLevel(new THREE.Vector3(), plant)).toBeCloseTo(0.1);
    lighting.setTorchOwner(lantern);
    expect(lighting.sampleLightLevel(new THREE.Vector3(), plant)).toBeGreaterThan(0.1);
  });
});

describe('real plant archives, spawning and saving', () => {
  it('loads each source build and animation, shares atlases and restores prefab sizes and state', async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(
      `../../../public/dst/data/anim/${String(url).split('/').at(-1)}`, import.meta.url))));
    const scene = new THREE.Scene();
    const manager = new BulbPlantManager(scene, '/anim', { getLightLevel: () => 1 }, () => 0);
    const single = await manager.spawn('flower_cave', new THREE.Vector3(1, 50, 2));
    const duplicate = await manager.spawn('flower_cave', new THREE.Vector3(2, 0, 2));
    const double = await manager.spawn('flower_cave_double', new THREE.Vector3(3, 0, 4));
    const triple = await manager.spawn('flower_cave_triple', new THREE.Vector3(5, 0, 6));
    const springy = await manager.spawn('flower_cave', new THREE.Vector3(8, 0, 9), {
      id: 'e_springy', transform: { position: [8, 0, 9], rotationY: 0 },
      components: { bulbPlant: { variant: 'springy', lightState: 'ON', remainingSeconds: 50 } },
    });
    const mesh = (model: THREE.Group) => model.children[0].children[0] as THREE.Mesh;
    const material = (model: THREE.Group) => (mesh(model).material as THREE.MeshBasicMaterial[])[0];
    expect(single.position.toArray()).toEqual([1, 0, 2]);
    expect(material(single).map).toBe(material(duplicate).map);
    expect(material(single).map).not.toBe(material(double).map);
    for (let i = 0; i < 80; i++) manager.update(0.1, new THREE.Quaternion());
    for (const model of [single, double, triple, springy]) {
      expect(model.children[0].children).toHaveLength(1);
      expect(mesh(model).geometry.drawRange.count).toBeGreaterThan(0);
      expect(material(model).forceSinglePass).toBe(true);
    }
    expect(getPrefabLocalLight(single)?.radius).toBe(9);
    expect(getPrefabLocalLight(double)?.radius).toBe(13.5);
    expect(getPrefabLocalLight(triple)?.radius).toBe(13.5);
    const records = manager.exportRecords();
    expect(records.find(p => p.prefabId === 'flower_cave_double')!.record.components.bulbPlant.variant).toBe('double');
    const saved = records.find(p => p.record.id === 'e_springy')!;
    const restored = await manager.spawn(saved.prefabId, new THREE.Vector3(...saved.record.transform.position), saved.record);
    expect(restored.userData.entityId).toBe(saved.record.id);
    expect(restored.userData.bulbPlantVariant).toBe('springy');
    expect(getPrefabLocalLight(restored)).toEqual(BULB_PLANT_LIGHT);
    expect(manager.renderEntities.every(p => p.footPosition === p.object.position)).toBe(true);
    // All four archives must supply picking/picked and grow clips, including springy.
    for (const model of [single, double, triple, springy]) {
      expect(model.userData.bulbPlantController.tryPick(() => true)).toBe(true);
    }
    for (let i = 0; i < 80; i++) manager.update(0.1, new THREE.Quaternion());
    const pickedRecord = manager.exportRecords().find(p => p.record.id === 'e_springy')!;
    const pickedRestored = await manager.spawn(pickedRecord.prefabId, new THREE.Vector3(8, 0, 9), pickedRecord.record);
    expect(pickedRestored.userData.bulbPlantPicked).toBe(true);
    expect(getPrefabLocalLight(pickedRestored)).toBeUndefined();
    for (const model of [single, double, triple, springy]) {
      expect(mesh(model).geometry.drawRange.count).toBeGreaterThan(0);
      model.userData.bulbPlantController.update(bulbPlantRegrowTime(model.userData.bulbPlantVariant));
      expect(model.userData.bulbPlantController.canPick).toBe(true);
    }
    for (let i = 0; i < 80; i++) manager.update(0.1, new THREE.Quaternion());
    manager.dispose();
    expect(scene.children).toHaveLength(0);
    expect(getPrefabLocalLight(single)).toBeUndefined();
  });
});
