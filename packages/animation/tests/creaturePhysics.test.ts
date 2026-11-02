import { expect, it } from 'vitest';
import * as CANNON from 'cannon-es';
import { ItemEntity } from '../../inventory/src';
import { Mole } from '../../prefab/src/mole';
import { LightFlier } from '../../prefab/src/lightflier';
import { createEmptyEntity } from '../../prefab/src/prefabInstance';
import { MakeCharacterPhysics, MakeObstaclePhysics } from '../../prefab/src/standardcomponents';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

it('keeps mole physics on its instance, collides with obstacles underground and restores character collisions above ground', async () => {
  const world = new CANNON.World();
  const item = new ItemEntity({ itemId: 'mole', count: 1 }), mole = new Mole(item);
  const player = createEmptyEntity('wilson'), obstacle = createEmptyEntity('rock1');
  mole.bindPhysics(world);
  MakeCharacterPhysics(player.instance, 75, .5); player.instance.bindPhysics(world);
  MakeObstaclePhysics(obstacle.instance, 1); obstacle.instance.bindPhysics(world);
  const body = item.physicsBody!, other = player.instance.physicsBody!, barrier = obstacle.instance.physicsBody!;
  const collides = (a: CANNON.Body, b: CANNON.Body) => !!((a.collisionFilterMask & b.collisionFilterGroup) && (b.collisionFilterMask & a.collisionFilterGroup));
  try {
    expect(body.mass).toBe(99999);
    expect(item.getPhysicsRadius(0)).toBe(1.5);
    expect(collides(body, barrier)).toBe(true);
    expect(collides(body, other)).toBe(false);
    mole.setAbove(); await settle();
    expect(item.physicsBody).toBe(body);
    expect(collides(body, other)).toBe(true);
    mole.setUnder(); await settle();
    expect(collides(body, other)).toBe(false);
    expect(collides(body, barrier)).toBe(true);
    item.remove();
    expect(world.bodies).not.toContain(body);
  } finally {
    mole.dispose(); item.destroy();
    for (const entity of [player, obstacle]) { entity.instance.remove(); entity.display.dispose(); }
  }
});

it('declares lightflier ghost physics on its instance and excludes obstacle collisions', () => {
  const world = new CANNON.World(), item = new ItemEntity({ itemId: 'lightflier', count: 1 }), fly = new LightFlier(item);
  const obstacle = createEmptyEntity('rock1');
  fly.bindPhysics(world);
  MakeObstaclePhysics(obstacle.instance, 1); obstacle.instance.bindPhysics(world);
  try {
    const body = item.physicsBody!, barrier = obstacle.instance.physicsBody!;
    expect(body.mass).toBe(1);
    expect(item.getPhysicsRadius(0)).toBe(1.5);
    expect(body.collisionFilterMask & barrier.collisionFilterGroup).toBe(0);
    item.remove();
    expect(world.bodies).not.toContain(body);
  } finally {
    fly.dispose(); item.destroy();
    for (const entity of [obstacle]) { entity.instance.remove(); entity.display.dispose(); }
  }
});
