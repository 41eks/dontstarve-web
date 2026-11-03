import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorldFx } from '../../prefab/src/world_fx';

beforeEach(() => vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
afterEach(() => vi.unstubAllGlobals());

it('turns a spawned world fx to the camera, and follows the camera while it plays', async () => {
  const scene = new THREE.Scene(), fx = new WorldFx(scene);
  await fx.prepare('wortox_portal_jumpin_fx');
  const turned = (radians: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), radians);
  try {
    fx.spawn('wortox_portal_jumpin_fx', new THREE.Vector3(3, 0, 6));
    const model = fx.renderEntities[0].object;
    const mesh = () => {
      let found: THREE.Mesh | undefined;
      model.traverse(object => { if (object instanceof THREE.Mesh) found = object; });
      return found!;
    };
    for (const camera of [turned(Math.PI / 2), turned(-Math.PI / 4)]) {
      fx.update(1 / 60, camera);
      scene.updateMatrixWorld();
      // The art's own scale flips y, so its axes are compared rather than a decomposed rotation.
      const across = new THREE.Vector3(1, 0, 0).transformDirection(mesh().matrixWorld);
      expect(across.distanceTo(new THREE.Vector3(1, 0, 0).applyQuaternion(camera))).toBeCloseTo(0);
    }
    // Later frames are drawn at the entity's place too: the art stays within a unit of its foot point horizontally.
    for (let frame = 0; frame < 5; frame++) fx.update(1 / 15, turned(-Math.PI / 4));
    scene.updateMatrixWorld();
    const origin = mesh().getWorldPosition(new THREE.Vector3());
    expect(Math.hypot(origin.x - 3, origin.z - 6)).toBeLessThan(1);
    // The entity itself stands at its foot point, unturned.
    expect(model.position.toArray()).toEqual([3, 0, 6]);
    expect(model.quaternion.angleTo(new THREE.Quaternion())).toBe(0);
  } finally { fx.dispose(); }
});
