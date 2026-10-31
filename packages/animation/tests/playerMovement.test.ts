import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { expect, it } from 'vitest';
import { Locomotor } from '../../prefab/src/locomotor';
import type { PlayerBody } from '../../../src/types/Player';

it('stops at the land/ocean boundary and slides along the shore', () => {
  const body = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(0.5) }) as PlayerBody;
  const locomotor = new Locomotor(body, { footprintRadius: 0.5, isPassable: (x) => x < 4 });
  const dt = 1 / 30;
  body.position.set(3, 0, 0);
  locomotor.update(16, dt, new THREE.Vector3(1, 0, 0));
  expect(body.velocity.x).toBe(0);
  body.position.set(3.5, 0, 0);
  locomotor.update(16, dt, new THREE.Vector3(1, 0, 1));
  expect(body.velocity.x).toBe(0);
  expect(body.velocity.z).toBeGreaterThan(0);
  body.position.set(0, 0, 0);
  locomotor.update(16, dt, new THREE.Vector3(1, 0, 0));
  expect(body.velocity.x).toBeGreaterThan(0);
});
