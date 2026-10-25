import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SpriteRenderOrderSorter, compareRenderEntries, registerSpriteRenderGroup, type RenderOrderEntry } from '../src/renderOrder';

describe('compareRenderEntries', () => {
  it('draws background entities before world entities and sorts background billboards by foot depth', () => {
    const backgroundNear = { object: new THREE.Object3D(), cameraDepth: -5, footPosition: new THREE.Vector3(), renderLayer: -1 };
    const backgroundFar = { object: new THREE.Object3D(), cameraDepth: -25, footPosition: new THREE.Vector3(), renderLayer: -1 };
    const world = { object: new THREE.Object3D(), cameraDepth: -50, footPosition: new THREE.Vector3() };
    expect([world, backgroundNear, backgroundFar].sort(compareRenderEntries)).toEqual([backgroundFar, backgroundNear, world]);
  });

  it('orders far to near by camera depth', () => {
    const far = { object: new THREE.Object3D(), cameraDepth: -30, footPosition: new THREE.Vector3() };
    const near = { object: new THREE.Object3D(), cameraDepth: -10, footPosition: new THREE.Vector3() };
    expect([near, far].sort(compareRenderEntries)).toEqual([far, near]);
  });

  it('orders a row of walls on one line of sight by foot x then z, whatever their ids or depth noise', () => {
    const feet = [[6, 3], [0, 3], [3, 3], [3, 0], [9, 3]];
    const walls = feet.map(([x, z]) => ({ object: new THREE.Object3D(), cameraDepth: -20, footPosition: new THREE.Vector3(x, 0, z) }));
    const expected = [[0, 3], [3, 0], [3, 3], [6, 3], [9, 3]];
    for (let frame = 0; frame < 50; frame++) {
      const noisy = walls.map((wall) => ({ ...wall, cameraDepth: -20 + (Math.random() - 0.5) * 2e-6 }));
      expect(noisy.sort(compareRenderEntries).map((wall) => [wall.footPosition.x, wall.footPosition.z])).toEqual(expected);
    }
  });

  it('keeps grouped parts of one entity in layer order', () => {
    const object = new THREE.Object3D();
    const top = { object, cameraDepth: -20, footPosition: new THREE.Vector3(5, 0, 0), sortGroup: 1, sortLayer: 2 };
    const base = { object, cameraDepth: -20, footPosition: new THREE.Vector3(), sortGroup: 1, sortLayer: 1 };
    expect([top, base].sort(compareRenderEntries)).toEqual([base, top]);
  });
});

function makeEntry(position: THREE.Vector3, keys: Partial<RenderOrderEntry> = {}) {
  const object = new THREE.Group();
  const outer = new THREE.Group();
  const visual = new THREE.Group();
  object.add(outer);
  outer.add(visual);
  registerSpriteRenderGroup(object, visual);
  return { object, footPosition: position, cameraDepth: 0, ...keys, visual, outer };
}

// Reference the former scene pipeline, including original (one-hop) owner depths.
function expectedOrder(entries: ReturnType<typeof makeEntry>[], matrix: THREE.Matrix4) {
  const visible = entries.filter(entry => entry.object.visible && entry.visual.visible)
    .map(entry => ({ ...entry, cameraDepth: entry.footPosition.clone().applyMatrix4(matrix).z }));
  const ownerDepths = new Map(visible.map(entry => [entry.object.id, entry.cameraDepth]));
  for (const entry of visible) {
    if (entry.sortGroup !== undefined && entry.sortGroup !== entry.object.id) {
      entry.cameraDepth = ownerDepths.get(entry.sortGroup) ?? entry.cameraDepth;
    }
  }
  return visible.sort(compareRenderEntries);
}

function expectOrder(sorter: SpriteRenderOrderSorter, entries: ReturnType<typeof makeEntry>[], matrix: THREE.Matrix4) {
  const expected = expectedOrder(entries, matrix);
  const originalEntries = [...entries];
  const originalFeet = entries.map(entry => entry.footPosition.clone());
  sorter.update(entries, matrix);
  expect(entries).toEqual(originalEntries);
  entries.forEach((entry, index) => expect(entry.footPosition).toEqual(originalFeet[index]));
  expected.forEach((entry, order) => {
    expect(entry.visual.renderOrder, `object ${entry.object.id}`).toBe(order);
    expect(entry.outer.renderOrder).toBe(0);
    expect(entry.object.renderOrder).toBe(0);
  });
}

describe('SpriteRenderOrderSorter', () => {
  it('matches entity ordering across camera movement, background layers, ties and owner groups', () => {
    const sorter = new SpriteRenderOrderSorter();
    const entries = Array.from({ length: 80 }, (_, i) => makeEntry(
      new THREE.Vector3((i * 17) % 19, i % 4, (i * 7) % 13),
      { renderLayer: i % 11 === 0 ? -1 : 0, sortLayer: i % 3 },
    ));
    entries[0].sortGroup = entries[0].object.id;
    entries[1].sortGroup = entries[0].object.id;
    entries[2].sortGroup = entries[1].object.id;
    entries[3].sortGroup = -1; // An absent owner leaves the part's own depth intact.
    // Ungrouped equal-foot overlays use sortLayer before id.
    entries[5].footPosition.copy(entries[4].footPosition);
    for (let frame = 0; frame < 12; frame++) {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(50 * Math.sin(frame), 30, 50 * Math.cos(frame));
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      expectOrder(sorter, entries, camera.matrixWorldInverse);
      entries.push(entries.shift()!);
    }
    // A same-depth wall row interleaved with grouped effects exercises the mixed tie rules.
    const rowCamera = new THREE.PerspectiveCamera();
    rowCamera.position.set(0, 0, 50);
    rowCamera.lookAt(0, 0, 0);
    rowCamera.updateMatrixWorld();
    entries.forEach(entry => entry.footPosition.z = 0);
    expectOrder(sorter, entries, rowCamera.matrixWorldInverse);
  });

  it('preserves quantization boundaries before Float32 conversion and large depth differences', () => {
    const sorter = new SpriteRenderOrderSorter();
    const entries = [
      makeEntry(new THREE.Vector3(1, 0, -20.0004999)),
      makeEntry(new THREE.Vector3(2, 0, -20.0005001)),
      makeEntry(new THREE.Vector3(3, 0, -19.999999)),
      makeEntry(new THREE.Vector3(4, 0, -20.000001)),
    ];
    const matrix = new THREE.Matrix4();
    expectOrder(sorter, entries, matrix);
    // Adjacent millimetre buckets beyond Float32's exact integer range must stay distinct.
    entries.push(makeEntry(new THREE.Vector3(5, 0, -100000.001)),
      makeEntry(new THREE.Vector3(6, 0, -100000.002)));
    expectOrder(sorter, entries, matrix);
    entries.push(...Array.from({ length: 40 }, (_, i) => makeEntry(new THREE.Vector3(i, 0, -i))));
    expectOrder(sorter, entries, matrix); // Buffer growth after precision promotion.
  });

  it('handles hidden visuals, removal, empty frames and replacement visuals without stale indices', () => {
    const sorter = new SpriteRenderOrderSorter();
    const owner = makeEntry(new THREE.Vector3(0, 0, -20));
    const child = makeEntry(new THREE.Vector3(0, 0, -5), { sortGroup: owner.object.id, sortLayer: 2 });
    const middle = makeEntry(new THREE.Vector3(0, 0, -10));
    const matrix = new THREE.Matrix4();
    expectOrder(sorter, [child, middle, owner], matrix);
    expect(child.visual.renderOrder).toBe(1);
    owner.object.visible = false;
    owner.visual.renderOrder = 99;
    expectOrder(sorter, [child, owner, middle], matrix);
    expect(owner.visual.renderOrder).toBe(99);
    expect(child.visual.renderOrder).toBe(1); // Hidden owners cannot supply depth.
    middle.visual.visible = false;
    middle.visual.renderOrder = 98;
    expectOrder(sorter, [middle, child], matrix);
    expect(middle.visual.renderOrder).toBe(98);
    expectOrder(sorter, [], matrix);
    const replacement = new THREE.Group();
    registerSpriteRenderGroup(child.object, replacement);
    sorter.update([child], matrix);
    expect(replacement.renderOrder).toBe(0);
    expectOrder(sorter, [makeEntry(new THREE.Vector3())], matrix);
  });
});

describe('registerSpriteRenderGroup', () => {
  it('keeps the entity order when a loaded sprite replaces its placeholder, so no resort is needed', () => {
    const root = new THREE.Group(), placeholder = new THREE.Group(), drawn = new THREE.Group(), far = new THREE.Group();
    registerSpriteRenderGroup(root, placeholder);
    registerSpriteRenderGroup(far, new THREE.Group());
    new SpriteRenderOrderSorter().update([
      { object: far, footPosition: new THREE.Vector3(0, 0, -20) },
      { object: root, footPosition: new THREE.Vector3(0, 0, -10) },
    ], new THREE.Matrix4());
    expect(placeholder.renderOrder).toBe(1);
    registerSpriteRenderGroup(root, drawn);
    expect(drawn.renderOrder).toBe(1);
  });
});
