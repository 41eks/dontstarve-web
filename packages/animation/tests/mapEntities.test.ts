import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IsDeployPointClear, IsGroundTargetBlocked } from '../../prefab/src/mapEntities';
import { TurfMap } from '../../prefab/src/turfMap';
import { farmFixture } from './farmFixture';
import { mapEntities, placeEntity } from './mapEntitiesFixture';

beforeEach(() => vi.stubGlobal('window', new EventTarget()));
afterEach(() => vi.unstubAllGlobals());

it('blocks ground targets by the registered blocker ring, including blockers centred beyond the query range', () => {
  const ents = mapEntities(),
    origin = new THREE.Vector3();
  const hole = placeEntity(ents, new THREE.Vector3(24, 0, 0));
  try {
    expect(IsGroundTargetBlocked(ents, origin, 1.5)).toBe(false);
    // EntityScript:SetGroundTargetBlockerRadius tags the entity and widens every map query to reach its centre.
    hole.ground_target_blocker_radius = 24;
    hole._groundhole_innerradius = 3;
    expect(hole.hasTag('groundtargetblocker')).toBe(true);
    expect(IsGroundTargetBlocked(ents, origin, 1.5)).toBe(true);
    expect(IsGroundTargetBlocked(ents, hole.position, 1.5)).toBe(false);
    expect(IsGroundTargetBlocked(ents, new THREE.Vector3(-1.5, 0, 0), 1.5)).toBe(false);
    hole.ground_target_blocker_radius = undefined;
    expect(hole.hasTag('groundtargetblocker')).toBe(false);
    expect(IsGroundTargetBlocked(ents, origin, 1.5)).toBe(false);
  } finally {
    ents.dispose();
    hole.remove();
  }
});

it('finds deploy blockers where their transform now is, skipping the deployed inst, ignored, hidden and placer entities', () => {
  const ents = mapEntities(),
    point = new THREE.Vector3();
  const deploying = placeEntity(ents, point, [], 'pinecone');
  const rock = placeEntity(ents, new THREE.Vector3(1, 0, 0));
  const clear = () => IsDeployPointClear(ents, point, deploying, 2);
  try {
    expect(IsDeployPointClear(ents, point, undefined, 2)).toBe(false);
    expect(clear()).toBe(false);
    // A position write moves the entity in the world's one spatial index; nothing else has to follow it.
    rock.setPosition(30, 0, 0);
    expect(clear()).toBe(true);
    rock.setPosition(1, 0, 0);
    expect(clear()).toBe(false);
    for (const tag of ['NOBLOCK', 'INLIMBO', 'placer']) {
      rock.addTag(tag);
      expect(clear()).toBe(true);
      rock.removeTag(tag);
    }
    rock.Hide();
    expect(clear()).toBe(true);
    rock.remove();
    expect(clear()).toBe(true);
    // deploy_smart_radius reaches past the deploy spacing: radius + spacing / 2.
    const pond = placeEntity(ents, new THREE.Vector3(6, 0, 0));
    expect(clear()).toBe(true);
    pond.deploySmartRadius = 5.5;
    expect(clear()).toBe(false);
    pond.remove();
  } finally {
    ents.dispose();
    deploying.remove();
  }
});

it('keeps an asleep entity blocking its tile for the plow until it is removed', () => {
  const farm = farmFixture(new THREE.Scene(), new TurfMap(96)),
    origin = new THREE.Vector3();
  const tree = placeEntity(farm.prefabs, new THREE.Vector3(11.99, 0, 11.99), [], 'evergreen');
  try {
    expect(farm.map.canDeploy(origin)).toBe(false);
    tree.setActive(false);
    expect(farm.map.canDeploy(origin)).toBe(false);
    expect(farm.map.canDeploy(origin, tree)).toBe(true);
    tree.remove();
    expect(farm.map.canDeploy(origin)).toBe(true);
  } finally {
    tree.remove();
    farm.dispose();
  }
});
