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
});

describe('real fireflies archive and ground transfers', () => {
  function assets() {
    vi.stubGlobal('fetch', async () => new Response(await readFile(
      new URL('../../../public/dst/data/anim/fireflies.zip', import.meta.url))));
  }

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
