import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { LootFling } from '../../prefab/src/lootFling';

const transform = (x = 0, z = 0) => ({ position: new Vector3(x, 0, z), rotationY: 0 });

it('uses Lua random direction, speed, vertical variance and collision-radius offset', () => {
  const samples = [0.25, 0.5, 0.75];
  const entityTransform = transform(10, 20);
  const fling = new LootFling(entityTransform, 0.4, () => samples.shift()!);
  expect(fling.position.x).toBeCloseTo(10);
  expect(fling.position.z).toBeCloseTo(20 - (0.4 + 0.5) * 3);
  expect(fling.velocity.x).toBeCloseTo(0);
  expect(fling.velocity.z).toBeCloseTo(-3);
  expect(fling.velocity.y).toBeCloseTo(30); // (8 + 4 * 0.5) * scene scale 3
  fling.update(0.1);
  expect(fling.height).toBeGreaterThan(0);
  expect(fling.position.z).toBeLessThan(17.3);
  expect(fling.position.y).toBe(0);
  // A teleport changes the integration origin; no private trajectory position
  // can overwrite the entity on the next step.
  entityTransform.position.set(50, 0, 60);
  fling.update(0.1);
  expect(entityTransform.position.x).toBeCloseTo(50);
  expect(entityTransform.position.z).toBeCloseTo(59.7);
});

it('returns to the ground, rebounds and settles independently of frame subdivision', () => {
  const fine = new LootFling(transform(), 0.4, () => 0.5);
  const coarse = new LootFling(transform(), 0.4, () => 0.5);
  for (let i = 0; i < 300; i++) {
    fine.update(1 / 60);
    expect(fine.height).toBeGreaterThanOrEqual(0);
    expect(fine.position.y).toBe(0);
  }
  coarse.update(5);
  expect(fine.settled).toBe(true);
  expect(coarse.settled).toBe(true);
  expect(fine.position.x).toBeCloseTo(coarse.position.x);
  expect(fine.position.z).toBeCloseTo(coarse.position.z);
  expect(fine.height).toBe(0);
  expect(fine.velocity.length()).toBe(0);
  const landing = fine.position.clone();
  fine.update(100);
  expect(fine.position).toEqual(landing);

  const bouncing = new LootFling(transform(), 0.4, () => 0.5);
  bouncing.update(0.54); // first impact at 2 * 24 / 90 seconds
  expect(bouncing.height).toBeGreaterThan(0);
  expect(bouncing.velocity.y).toBeGreaterThan(0);
});
