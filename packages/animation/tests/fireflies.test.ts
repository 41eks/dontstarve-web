import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirefliesAssets, FirefliesController, FIREFLIES_LIGHT } from '../../prefab/src/fireflies';
import { getPrefabLightOverride, getPrefabLocalLight } from '../../prefab/src/localLight';
import { intersectSpriteEntities } from '../../prefab/src/pointerRaycaster';
import { GroundItemManager } from '../../../src/groundItems';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(night = true, position = new THREE.Vector3(10, 0, 0), random = () => 0) {
  const model = new THREE.Group();
  model.add(new THREE.Group());
  const animation = { start: vi.fn(), playOnce: vi.fn(), update: vi.fn() };
  let players = [position];
  const controller = new FirefliesController(model, animation,
    { isNight: () => night, getPlayerPositions: () => players }, random);
  return { model, animation, controller, setNight: (value: boolean) => { night = value; },
    setPlayers: (value: THREE.Vector3[]) => { players = value; },
    tick: (seconds: number) => { for (let i = 0; i < Math.round(seconds * 100); i++) controller.update(0.01); } };
}

describe('source fireflies light and proximity', () => {
  it('fades in at night and uses the source radius, intensity, colour and falloff', () => {
    const s = setup();
    s.controller.place(false);
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('swarm_pre', expect.any(Function));
    expect(s.controller.clickable).toBe(true);
    expect(s.controller.workable).toBe(true);
    s.tick(1.5);
    expect(s.controller.intensity).toBeCloseTo(0.25);
    s.tick(1.6);
    expect(getPrefabLocalLight(s.model)).toEqual(FIREFLIES_LIGHT);
    expect(getPrefabLightOverride(s.model)).toBe(1);
    const complete = s.animation.playOnce.mock.calls[0][1] as () => void;
    complete();
    expect(s.animation.start).toHaveBeenLastCalledWith('swarm_loop');
  });

  it('fades out at 3 units, keeps NET briefly and reappears only after 5 units', () => {
    const s = setup();
    s.controller.place(false);
    s.tick(3.1);
    s.setPlayers([new THREE.Vector3(3, 0, 0)]);
    s.tick(0.4);
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('swarm_pst', expect.any(Function));
    expect(s.controller.intensity).toBeLessThan(0.5);
    s.tick(0.4);
    expect(s.controller.clickable).toBe(false);
    expect(s.model.userData.tags).toContain('NOCLICK');
    expect(s.controller.workable).toBe(true);
    expect(getPrefabLocalLight(s.model)).toBeUndefined();
    s.tick(1.6);
    expect(s.controller.workable).toBe(false);
    s.setPlayers([new THREE.Vector3(4.9, 0, 0)]);
    s.tick(1);
    expect(s.controller.intensity).toBe(0);
    s.setPlayers([new THREE.Vector3(5, 0, 0)]);
    s.tick(0.1);
    expect(s.controller.intensity).toBeGreaterThan(0);
    expect(s.controller.workable).toBe(true);
  });

  it('waits 2–3 seconds after a phase change and briefly lights dropped swarms in daytime', () => {
    const s = setup(false);
    s.controller.place(false);
    s.tick(4);
    expect(s.controller.intensity).toBe(0);
    s.setNight(true);
    s.tick(1.9);
    expect(s.controller.intensity).toBe(0);
    s.tick(0.2);
    expect(s.controller.intensity).toBeGreaterThan(0);
    const drop = setup(false, new THREE.Vector3());
    drop.controller.place(true);
    drop.tick(1);
    expect(drop.controller.intensity).toBeGreaterThan(0);
    drop.tick(2);
    expect(drop.controller.clickable).toBe(false);
    expect(getPrefabLocalLight(drop.model)).toBeUndefined();
  });

  it('reverses a fade without restarting the light at zero and removes light on disposal', () => {
    const s = setup();
    s.controller.place(false);
    s.tick(3.1);
    s.setPlayers([new THREE.Vector3()]);
    s.tick(0.3);
    const value = s.controller.intensity;
    s.setPlayers([]);
    s.tick(0.1);
    expect(s.controller.intensity).toBeGreaterThan(value);
    const stale = s.animation.playOnce.mock.calls[1][1] as () => void;
    stale();
    expect(s.model.children[0].visible).toBe(true);
    s.controller.dispose();
    s.tick(5);
    expect(getPrefabLocalLight(s.model)).toBeUndefined();
    expect(s.controller.workable).toBe(false);
  });

  it('ray-tests the full swarm bounds including gaps between particles', () => {
    const group = new THREE.Group();
    group.userData.rayTestOnBB = true;
    for (const x of [-1, 1]) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial());
      mesh.position.x = x;
      group.add(mesh);
    }
    group.updateWorldMatrix(true, true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
    expect(ray.intersectObjects([group], true)).toHaveLength(0);
    expect(intersectSpriteEntities(ray, [group])[0].object).toBe(group);
  });
});

describe('real fireflies archive and ground transfers', () => {
  function assets() {
    vi.stubGlobal('fetch', async () => new Response(await readFile(
      new URL('../../../public/dst/data/anim/fireflies.zip', import.meta.url))));
  }

  it('plays all original swarm clips with merged art and a source-origin light', async () => {
    assets();
    const visual = await new FirefliesAssets('/anim').create({ isNight: () => true, getPlayerPositions: () => [] });
    visual.model.position.set(8, 0, 9);
    visual.model.dispatchEvent({ type: 'onload' });
    for (let i = 0; i < 50; i++) visual.update(0.1);
    const mesh = visual.model.children[0].children[0] as THREE.Mesh;
    expect(visual.model.children[0].children).toHaveLength(1);
    expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
    expect((mesh.material as THREE.MeshBasicMaterial[]).every(m => m.forceSinglePass)).toBe(true);
    expect(getPrefabLocalLight(visual.model)).toEqual(FIREFLIES_LIGHT);
    visual.model.dispatchEvent({ type: 'onputininventory' });
    visual.update(0.1);
    expect(getPrefabLocalLight(visual.model)).toBeUndefined();
    expect(visual.controller.workable).toBe(false);
    visual.model.dispatchEvent({ type: 'ondropped' });
    for (let i = 0; i < 50; i++) visual.update(0.1);
    expect(getPrefabLocalLight(visual.model)).toEqual(FIREFLIES_LIGHT);
    visual.dispose();
    expect(getPrefabLocalLight(visual.model)).toBeUndefined();
  });

  it('splits live drops, prevents bare-hand pickup, captures atomically and restores dark daytime swarms', async () => {
    assets();
    const scene = new THREE.Scene();
    const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
    const pickup = vi.fn(() => false);
    const manager = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
      { domElement: canvas } as unknown as THREE.WebGLRenderer, 'images.zip', pickup, '/anim', new THREE.Group(), undefined,
      { isNight: () => true, getPlayerPositions: () => [] });
    const definition = { itemId: 'fireflies', count: 2, name: '萤火虫', icon: 'fireflies.tex' };
    expect(await manager.drop(definition, new THREE.Vector3(8, 0, 9), () => false)).toBe(false);
    expect(scene.children).toHaveLength(0);
    expect(await manager.drop(definition, new THREE.Vector3(8, 0, 9), () => true)).toBe(true);
    expect(manager.exportRecords().map(r => r.components.stack!.count)).toEqual([1, 1]);
    const records = manager.exportRecords();
    const [target] = manager.netCaptureTargets;
    expect(target.capture()).toBe(false);
    expect(scene.children).toHaveLength(2);
    pickup.mockReturnValue(true);
    expect(target.capture()).toBe(true);
    expect(pickup).toHaveBeenLastCalledWith({ ...definition, count: 1 }, 'net', target.position.clone());
    expect(target.capture()).toBe(false);
    expect(getPrefabLocalLight(target.model)).toBeUndefined();
    expect(manager.exportRecords()).toHaveLength(1);
    const dark = new GroundItemManager(new THREE.Scene(), new THREE.PerspectiveCamera(),
      { domElement: canvas } as unknown as THREE.WebGLRenderer, 'images.zip', pickup, '/anim', new THREE.Group());
    const restored = await dark.spawnFromSave(records[0].id, { ...definition, count: 1 }, new THREE.Vector3(8, 0, 9));
    expect(dark.exportRecords()).toEqual([records[0]]);
    expect(getPrefabLocalLight(restored)).toBeUndefined();
    expect(dark.netCaptureTargets[0].isValid()).toBe(false);
    dark.update(5, new THREE.Quaternion());
    expect(dark.exportRecords()).toHaveLength(1);
  });
});
