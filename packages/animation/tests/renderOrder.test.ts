import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { registerSpriteRenderGroup, spriteRenderOrderKey, updateSpriteRenderOrders, type RenderOrderEntry } from '../src/renderOrder';

function camera(position: THREE.Vector3Tuple, target: THREE.Vector3Tuple = [0, 0, 0]): THREE.Matrix4 {
  const view = new THREE.PerspectiveCamera(35, 16 / 9, .1, 5000);
  view.position.set(...position);
  view.lookAt(...target);
  view.updateMatrixWorld();
  return view.matrixWorldInverse;
}

function makeEntry(position: THREE.Vector3, keys: Partial<RenderOrderEntry> = {}) {
  const object = new THREE.Group();
  const outer = new THREE.Group();
  const visual = new THREE.Group();
  object.add(outer);
  outer.add(visual);
  registerSpriteRenderGroup(object, visual);
  return { object, footPosition: position, ...keys, visual, outer };
}

/** The order three.js draws them in: ascending group render order. */
const drawn = (entries: ReturnType<typeof makeEntry>[]) => [...entries].sort((a, b) => a.visual.renderOrder - b.visual.renderOrder);

describe('spriteRenderOrderKey', () => {
  const view = camera([0, 30, 50]);
  const key = (x: number, z: number, renderLayer?: number, sortLayer?: number) =>
    spriteRenderOrderKey(new THREE.Vector3(x, 0, z), view, renderLayer, sortLayer);

  it('orders far to near by foot depth, background layers first, after ground tiles and before weather', () => {
    expect(key(0, -30)).toBeLessThan(key(0, -10));
    expect(key(0, 10, -1)).toBeLessThan(key(0, -500));
    expect(key(0, -4000, -1)).toBeGreaterThan(0);
    expect(key(0, 40, 1)).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('orders a row of walls on one line of sight left to right, whatever the depth noise or camera pan', () => {
    const row = camera([0, 0, 50]);
    const feet = [6, 0, 3, 9];
    for (let frame = 0; frame < 50; frame++) {
      const pan = frame - 25;
      const panned = camera([pan, 0, 50], [pan, 0, 0]);
      for (const matrix of [row, panned]) {
        const keys = feet.map(x => spriteRenderOrderKey(new THREE.Vector3(x, 0, (Math.random() - .5) * 2e-7), matrix));
        expect(feet.map((x, i) => [x, keys[i]]).sort((a, b) => a[1] - b[1]).map(([x]) => x)).toEqual([0, 3, 6, 9]);
      }
    }
  });

  it('orders parts sharing a foot point by sort layer, between their neighbours', () => {
    const behind = key(1, 0, 0, 0), owner = key(1, 0), fire = key(1, 0, 0, 2);
    expect(behind).toBeLessThan(owner);
    expect(owner).toBeLessThan(fire);
    // A millimetre further left or nearer is a different entity: it never falls between an owner and its fire.
    for (const neighbour of [key(1 - 1e-3, 0, 0, 7), key(1 + 1e-3, 0, 0, 0), key(1, 1e-2, 0, 0)]) {
      expect(neighbour < behind || neighbour > fire).toBe(true);
    }
  });

  it('keeps millimetre buckets distinct across the far plane and rejects layers it cannot encode', () => {
    const straight = new THREE.Matrix4();
    const at = (z: number) => spriteRenderOrderKey(new THREE.Vector3(4000, 0, z), straight, -1, 7);
    expect(at(-4999.999)).toBeGreaterThan(at(-5000));
    expect(at(-4999.999) - at(-5000)).toBe(1);
    expect(() => key(0, 0, -3)).toThrow();
    expect(() => key(0, 0, 0, 8)).toThrow();
    expect(() => key(0, 0, 0, 1.5)).toThrow();
  });
});

describe('updateSpriteRenderOrders', () => {
  it('writes each shown entity its own key on its registered group, leaving hidden ones as they were', () => {
    const view = camera([0, 30, 50]);
    const far = makeEntry(new THREE.Vector3(0, 0, -20));
    const item = makeEntry(new THREE.Vector3(2, 0, -10));
    const hidden = makeEntry(new THREE.Vector3(0, 0, 0));
    hidden.object.visible = false;
    hidden.visual.renderOrder = 99;
    updateSpriteRenderOrders([item, hidden, far], view);
    expect(drawn([item, far])).toEqual([far, item]);
    expect(hidden.visual.renderOrder).toBe(99);
    expect(item.outer.renderOrder).toBe(0);
    expect(item.object.renderOrder).toBe(0);
    // An effect attached while nothing moves orders itself after its owner, and keeps that when written alone.
    const fire = makeEntry(item.footPosition, { sortLayer: 2 });
    updateSpriteRenderOrders([fire], view);
    expect(drawn([far, fire, item])).toEqual([far, item, fire]);
    // An entity walking past reorders without the others being rewritten.
    far.footPosition.z = 5;
    updateSpriteRenderOrders([far], view);
    expect(drawn([far, fire, item])).toEqual([item, fire, far]);
  });
});

describe('registerSpriteRenderGroup', () => {
  it('keeps the entity order when a loaded sprite replaces its placeholder', () => {
    const root = new THREE.Group(), placeholder = new THREE.Group(), loaded = new THREE.Group();
    registerSpriteRenderGroup(root, placeholder);
    updateSpriteRenderOrders([{ object: root, footPosition: new THREE.Vector3(0, 0, -10) }], new THREE.Matrix4());
    registerSpriteRenderGroup(root, loaded);
    expect(loaded.renderOrder).toBe(placeholder.renderOrder);
  });
});
