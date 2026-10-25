import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { createEmptyEntity } from '../../prefab/src/prefabInstance';
import { WORLD_SCALE } from '../../prefab/src/tile';
import { SpatialIndex } from '../../prefab/src/spatialIndex';
import { placementEntities, syncPlacementEntity, isGroundTargetBlocked, registerPlacementTree } from '../../prefab/src/placementEntities';
import { actionEntity, disposeActionEntity } from '../../prefab/src/actionEntity';
import { FarmPlowPlacement } from '../../prefab/src/farm_plow';
import { TurfMap } from '../../prefab/src/turfMap';
import { ItemEntity } from '../../inventory/src';
import type { WorldContext } from '../../prefab/src/worldContext';

afterEach(() => vi.unstubAllGlobals());

it('ground target blocking uses source tags and ring radii, including blockers whose centre is outside the query range', () => {
  const scene = new THREE.Scene(), model = new THREE.Group();
  model.position.set(24, 0, 0);
  Object.assign(model.userData, { ground_target_blocker_radius: 24, _groundhole_innerradius: 3, tags: ['blocker'] });
  const entity = actionEntity(model, 'test-groundhole'); scene.add(model);
  const query = placementEntities(scene), point = new THREE.Vector3(0, 0, 0);
  try {
    expect(isGroundTargetBlocked(query, point, 1.5)).toBe(false);
    entity.addTag('groundhole');
    expect(isGroundTargetBlocked(query, point, 1.5)).toBe(true);
    expect(isGroundTargetBlocked(query, model.position, 1.5)).toBe(false);
    expect(isGroundTargetBlocked(query, new THREE.Vector3(-1.5, 0, 0), 1.5)).toBe(false);
    entity.removeTag('groundhole');
    expect(isGroundTargetBlocked(query, point, 1.5)).toBe(false);
  } finally { disposeActionEntity(model); model.removeFromParent(); }
});

it('visits local cells, stops at the first blocker and includes large smart radii across cell boundaries', () => {
  type Entry = { position: THREE.Vector3; radius: number };
  const positionOf = vi.fn((entry: Entry) => entry.position);
  const index = new SpatialIndex(positionOf, (entry: Entry) => entry.radius);
  for (let i = 0; i < 1000; i++) index.add({ position: new THREE.Vector3(1000 + i * 12, 0, 0), radius: 0 });
  const first = { position: new THREE.Vector3(-.1, 0, -.1), radius: 0 };
  index.add(first); index.add({ position: first.position.clone(), radius: 0 });
  positionOf.mockClear();
  const visit = vi.fn(() => true);
  expect(index.someNear(new THREE.Vector3(), 1, visit)).toBe(true);
  expect(visit).toHaveBeenCalledExactlyOnceWith(first);
  expect(positionOf).toHaveBeenCalledExactlyOnceWith(first);
  expect(index.someOnTile(new THREE.Vector3(-12, 0, -12), () => true)).toBe(true);
  expect(index.someOnTile(new THREE.Vector3(), () => true)).toBe(false);

  const wide = { position: new THREE.Vector3(30, 0, 0), radius: 29 };
  index.add(wide);
  expect(index.someNear(new THREE.Vector3(1, 0, 0), 1, entry => entry === wide)).toBe(true);
  wide.position.set(100, 0, 0); index.sync(wide);
  expect(index.someNear(new THREE.Vector3(1, 0, 0), 1, entry => entry === wide)).toBe(false);
  index.delete(first);
  index.clear();
  expect(index.someNear(new THREE.Vector3(), 100, () => true)).toBe(false);
});

it('tracks tags, movement, attachment, replacement and permanent removal without walking scene/render lists', () => {
  const scene = new THREE.Scene(), other = new THREE.Scene(), model = new THREE.Group();
  const item = new ItemEntity({ itemId: 'log', count: 1 });
  item.addTag('NOBLOCK');
  model.userData.getGroundPosition = () => item.transform.position;
  actionEntity(model, 'log', item); scene.add(model);
  const query = placementEntities(scene), position = new THREE.Vector3();
  const traversal = vi.spyOn(scene, 'traverse'), visit = vi.fn(() => true);
  let replacement: THREE.Group | undefined;
  try {
    expect(query.someNear(position, 1, visit)).toBe(false);
    expect(visit).not.toHaveBeenCalled(); // Universally ignored entities never enter the index.
    item.removeTag('NOBLOCK');
    expect(query.someNear(position, 1, visit)).toBe(true);
    expect(placementEntities(other).someNear(position, 1, () => true)).toBe(false);
    item.addTag('NOCLICK');
    expect(query.someNear(position, 1, () => true)).toBe(true); // PLANT does not ignore NOCLICK.
    item.transform.position.set(24, 0, 0); syncPlacementEntity(model);
    expect(query.someNear(position, 1, () => true)).toBe(false);
    expect(query.someOnTile(item.transform.position, () => true)).toBe(true);
    model.removeFromParent();
    expect(query.someNear(item.transform.position, 1, () => true)).toBe(false);
    scene.add(model);
    expect(query.someNear(item.transform.position, 1, () => true)).toBe(true);
    disposeActionEntity(model); model.removeFromParent();
    replacement = new THREE.Group();
    replacement.userData.getGroundPosition = () => item.transform.position;
    actionEntity(replacement, 'log', item); scene.add(replacement);
    let count = 0;
    query.someNear(item.transform.position, 1, () => { count++; return false; });
    expect(count).toBe(1);
    item.destroy();
    expect(query.someNear(item.transform.position, 1, () => true)).toBe(false);
    expect(traversal).not.toHaveBeenCalled();
  } finally {
    traversal.mockRestore(); item.destroy(); disposeActionEntity(model);
    if (replacement) disposeActionEntity(replacement);
  }
});

it('keeps logical trees blocking their tile while only the visual is unloaded and releases permanent removals', () => {
  vi.stubGlobal('window', new EventTarget());
  const scene = new THREE.Scene(), root = new THREE.Group(), model = new THREE.Group(), visual = new THREE.Group();
  const point = new THREE.Vector3(11.99, 0, 11.99);
  model.position.copy(point); model.userData.placementLogical = true;
  const tree = { position: model.position, model };
  actionEntity(model, 'evergreen'); scene.add(root); root.add(model);
  let stop = registerPlacementTree(root, tree, 'evergreen', 1);
  const world = { scene, player: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    renderer: { domElement: new EventTarget() }, createCursorLabel: () => ({ show() {}, hide() {}, update() {} }) } as unknown as WorldContext;
  const farm = new FarmPlowPlacement(world, new TurfMap(96), async () => {});
  const query = placementEntities(scene), origin = new THREE.Vector3();
  try {
    expect(farm.canDeploy(origin)).toBe(false);
    model.add(visual);
    let count = 0;
    query.someOnTile(origin, () => { count++; return false; });
    expect(count).toBe(1);
    visual.removeFromParent();
    expect(model.parent).toBe(root);
    expect(farm.canDeploy(origin)).toBe(false);
    stop();
    expect(farm.canDeploy(origin)).toBe(true);
    stop = registerPlacementTree(root, tree, 'evergreen', 1);
    expect(farm.canDeploy(origin)).toBe(false);
    stop();
    expect(farm.canDeploy(origin)).toBe(true);
  } finally { stop(); disposeActionEntity(model); root.removeFromParent(); farm.dispose(); }
});


it('reads live entity metadata and radius overrides through action and placement queries without model projections', () => {
  const scene = new THREE.Scene();
  const { instance, display } = createEmptyEntity('log');
  const model = display.model;
  instance.entityId = 'log:placement';
  instance.skinId = 'test-skin';
  instance.persists = false;
  instance.addTag('groundtargetblocker');
  model.userData.itemId = instance.prefab;
  const entity = actionEntity(model, instance.prefab);
  scene.add(model);
  const query = placementEntities(scene);
  const read = () => {
    let result: import('../../prefab/src/placementEntities').PlacementBlocker | undefined;
    query.someNear(instance.position, 1, blocker => { result = blocker; return true; });
    return result!;
  };
  try {
    for (const key of ['prefab', 'entityId', 'saveRecord', 'skinId', 'persists', 'physicsRadius']) {
      expect(Object.hasOwn(model.userData, key)).toBe(false);
    }
    expect(entity.prefab).toBe('log');
    expect(read().prefab).toBe('log');
    expect(entity.getPhysicsRadius()).toBe(0);
    expect(read().inventoryRadius).toBe(.5);
    expect(read().getInventoryRadius!(.25)).toBe(.25);
    instance.physics.SetCapsule(.2);
    expect(entity.getPhysicsRadius()).toBe(.2 * WORLD_SCALE);
    expect(read().inventoryRadius).toBe(.2 * WORLD_SCALE);
    instance.physicsRadiusOverride = .4;
    expect(entity.getPhysicsRadius()).toBe(.4 * WORLD_SCALE);
    expect(read().groundTargetRadius).toBe(.4 * WORLD_SCALE);
    // A zero override is a real radius, rather than an absent value or a fallback.
    instance.physicsRadiusOverride = 0;
    expect(read().inventoryRadius).toBe(0);
    instance.physicsRadiusOverride = undefined;
    expect(read().getInventoryRadius!(.25)).toBe(.2 * WORLD_SCALE);
  } finally { disposeActionEntity(model); instance.remove(); display.dispose(); }
});
