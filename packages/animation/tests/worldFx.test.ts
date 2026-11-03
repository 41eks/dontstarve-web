import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prefabDisplay } from '../../display/src/prefabDisplay';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { WorldFx, type WorldFxPrefab } from '../../prefab/src/world_fx';

beforeEach(() => vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
afterEach(() => vi.unstubAllGlobals());

async function spawned(fx: WorldFx, prefab: WorldFxPrefab, position = new THREE.Vector3()) {
  const before = new Set(fx.renderEntities.map(({ object }) => object));
  fx.spawn(prefab, position);
  const model = fx.renderEntities.find(({ object }) => !before.has(object))!.object;
  await prefabDisplay(model)!.artLoaded();
  const mesh = () => {
    let found: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]> | undefined;
    model.traverse(object => { if (object instanceof THREE.Mesh) found = object as typeof found; });
    return found!;
  };
  return { model, mesh, instance: prefabInstance(model)! };
}

it('turns a spawned fx to the camera while it plays, with the entity unturned at its foot point', async () => {
  const scene = new THREE.Scene(), fx = new WorldFx(scene);
  const turned = (radians: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), radians);
  try {
    const { model, mesh } = await spawned(fx, 'wortox_portal_jumpin_fx', new THREE.Vector3(3, 0, 6));
    for (const camera of [turned(Math.PI / 2), turned(-Math.PI / 4)]) {
      fx.update(1 / 60, camera);
      scene.updateMatrixWorld();
      // The art's own scale flips y, so its axes are compared rather than a decomposed rotation.
      const across = new THREE.Vector3(1, 0, 0).transformDirection(mesh().matrixWorld);
      expect(across.distanceTo(new THREE.Vector3(1, 0, 0).applyQuaternion(camera))).toBeCloseTo(0);
    }
    for (let frame = 0; frame < 5; frame++) fx.update(1 / 15, turned(-Math.PI / 4));
    scene.updateMatrixWorld();
    const origin = mesh().getWorldPosition(new THREE.Vector3());
    expect(Math.hypot(origin.x - 3, origin.z - 6)).toBeLessThan(1);
    expect(model.position.toArray()).toEqual([3, 0, 6]);
    expect(model.quaternion.angleTo(new THREE.Quaternion())).toBe(0);
  } finally { fx.dispose(); }
});

it('removes an fx at animover, or the frames its source waits after it', async () => {
  const scene = new THREE.Scene(), fx = new WorldFx(scene), rotation = new THREE.Quaternion();
  const advance = (frames: number) => { for (let frame = 0; frame < frames; frame++) fx.update(1 / 30, rotation); };
  try {
    const portal = await spawned(fx, 'wortox_portal_jumpin_fx');
    const frames = portal.instance.sprite.numFrames;
    expect(frames).toBeGreaterThan(0);
    advance(frames + 1);
    expect(portal.instance.isRemoved).toBe(false);
    expect(portal.instance.sprite.currentAnimation).toBe('wortox_portal_jumpin');
    advance(2);
    expect(portal.instance.isRemoved).toBe(true);
    expect(fx.renderEntities).toEqual([]);
    expect(scene.children).toEqual([]);

    const explosion = await spawned(fx, 'lightning_rod_fx');
    advance(explosion.instance.sprite.numFrames + 1);
    expect(explosion.instance.isRemoved).toBe(true);
    expect(scene.children).toEqual([]);
  } finally { fx.dispose(); }
});

it('draws the source tint, alpha, scale and final offset, and is released with the spawner', async () => {
  const scene = new THREE.Scene(), fx = new WorldFx(scene);
  const dressed = async (prefab: WorldFxPrefab) => {
    const { mesh, instance } = await spawned(fx, prefab);
    fx.update(0, new THREE.Quaternion());
    return { mesh: mesh(), instance };
  };
  try {
    const sanity = await dressed('sanity_raise');
    expect(sanity.mesh.material[0].opacity).toBeCloseTo(.5);
    expect(sanity.mesh.material[0].transparent).toBe(true);
    const smoke = await dressed('die_fx');
    expect(smoke.mesh.material[0].color.r).toBeCloseTo(90 / 255);
    const lightning = await dressed('lightning');
    expect(lightning.mesh.parent!.scale.x).toBeCloseTo(.04);
    const portal = await dressed('wortox_portal_jumpout_fx');
    expect(portal.mesh.material[0].polygonOffset).toBe(true);
    expect(portal.instance.persists).toBe(false);
    expect(portal.instance.hasTag('FX')).toBe(true);
    fx.dispose();
    for (const { instance } of [sanity, smoke, lightning, portal]) expect(instance.isRemoved).toBe(true);
    expect(scene.children).toEqual([]);
  } finally { fx.dispose(); }
});
