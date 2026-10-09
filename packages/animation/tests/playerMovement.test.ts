import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { Locomotor } from '../../prefab/src/locomotor';
import { updateMovement } from '../../../src/updatePlayerMovement';
import { FIXED_TIMESTEP, MAX_SUBSTEPS } from '../../../src/physicsTiming';
import type { PlayerBody } from '../../../src/types/Player';

vi.mock('../../../src/InputManager', () => ({ input: { isPressed: () => false, isManualMovement: () => false, isActionInterrupting: () => false } }));

it('pursues a fleeing creature at low frame rates with the actual physics substep budget', () => {
  const body = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(0.5), linearDamping: 0 }) as PlayerBody;
  body.canJump = true;
  const world = new CANNON.World();
  world.addBody(body);
  const player = new THREE.Group();
  const locomotor = new Locomotor(body);
  const update = updateMovement(new THREE.PerspectiveCamera(), player, body, locomotor);
  const target = new THREE.Vector3(8, 0, 0);
  let approached = false;
  for (let frame = 0; frame < 40; frame++) {
    locomotor.goToPoint(target);
    update(16, 0.5);
    world.step(FIXED_TIMESTEP, 0.5, MAX_SUBSTEPS);
    target.x += 4 * 0.1; // ButterflyController caps its behavior step at 0.1 s.
    if (target.x - body.position.x <= 1) { approached = true; break; }
  }
  expect(approached).toBe(true);
  // The last step still slows to avoid running through the destination.
  const finish = new THREE.Vector3(body.position.x + 0.3, 0, 0);
  locomotor.goToPoint(finish);
  update(16, 0.5);
  world.step(FIXED_TIMESTEP, 0.5, MAX_SUBSTEPS);
  expect(body.position.x).toBeCloseTo(finish.x);
});
