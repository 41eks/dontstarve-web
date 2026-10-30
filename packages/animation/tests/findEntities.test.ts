import { useTestTileMap } from './tileMapFixture';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItemEntity } from '../../inventory/src';
import { actionEntity, activePrefabs, bindActionEntityWorld, disposeActionEntity, FindEntities } from '../../prefab/src/actionEntity';
import { createMemo, createSignal } from '../../signals/src';
import { DisposeTileStates, GetTileStateAtPoint } from '../../componets/src/tileManager';

useTestTileMap();

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).reverse().forEach(stop => stop());
  expect(activePrefabs).toEqual([]);
});
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function bindArea(scene: THREE.Scene) {
  const positions = createSignal([new THREE.Vector3()]);
  const player = createMemo(() => positions.get()[0]);
  const stop = bindActionEntityWorld(scene, GetTileStateAtPoint(player), positions);
  cleanups.push(() => { stop(); DisposeTileStates(player); player.dispose(); });
  return { positions, stop };
}

function spawn(root: THREE.Object3D, x: number, tags: string[] = [], inst?: ItemEntity) {
  const model = new THREE.Group();
  model.position.set(x, 0, 0);
  model.userData.tags = tags;
  root.add(model);
  const entity = actionEntity(model, 'thing', inst);
  cleanups.push(() => disposeActionEntity(model));
  return entity;
}

describe('FindEntities', () => {
  it('reads current logical positions without spatial synchronization and preserves radius boundaries and NOBLOCK', () => {
    const scene = new THREE.Scene();
    const near = spawn(scene, 4, ['NOBLOCK', 'flying']);
    const distant = Array.from({ length: 200 }, (_, i) => spawn(scene, 100 + i * 4));
    const tagReads = distant.map(entity => vi.spyOn(entity, 'hasTag'));
    try {
      expect(FindEntities(new THREE.Vector3(), 4, ['NOBLOCK'])).toEqual([near]);
      expect(tagReads.every(spy => spy.mock.calls.length === 0)).toBe(true);
      near.model.position.set(24, 0, 0);
      expect(FindEntities(new THREE.Vector3(), 4)).toEqual([]);
      expect(FindEntities(near.model.position, 0)).toEqual([near]);
      near.model.position.set(0, 5, 0);
      expect(FindEntities(new THREE.Vector3(), 4)).toEqual([]);
      near.model.position.y = 4;
      expect(FindEntities(new THREE.Vector3(), 4)).toEqual([near]);
      for (const radius of [-1, NaN, Infinity]) expect(() => FindEntities(new THREE.Vector3(), radius)).toThrow(RangeError);
      expect(FindEntities(new THREE.Vector3(NaN, 0, 0), 4)).toEqual([]);
    } finally { tagReads.forEach(spy => spy.mockRestore()); }
  });
  it('filters registered prefabs by tags regardless of scene attachment or visual visibility', () => {
    const scene = new THREE.Scene(), other = new THREE.Scene();
    const near = spawn(scene, 1, ['prototyper']);
    spawn(scene, 1, ['prototyper', 'fire']);
    spawn(scene, 50, ['prototyper']);
    spawn(scene, 1, ['plain']);
    const detached = spawn(scene, 1, ['prototyper']);
    detached.model.removeFromParent();
    const elsewhere = spawn(other, 1, ['prototyper']);
    const nested = new THREE.Group(); scene.add(nested);
    const deep = spawn(nested, 2, ['prototyper']);
    deep.model.visible = false;
    const found = FindEntities(new THREE.Vector3(), 4, ['prototyper'], ['fire']);
    expect(found).toHaveLength(4);
    expect(found).toEqual(expect.arrayContaining([near, deep, detached, elsewhere]));
    expect(FindEntities(new THREE.Vector3(), 4, [], [], ['plain', 'fire'])).toHaveLength(2);
    scene.add(detached.model);
    expect(FindEntities(new THREE.Vector3(), 4, ['prototyper'], ['fire'])).toContain(detached);
    expect(actionEntity(detached.model, 'thing')).toBe(detached);
    expect(activePrefabs.filter(entity => entity === detached)).toHaveLength(1);
  });

  it('stops returning an entity once it is removed', () => {
    const scene = new THREE.Scene();
    const inst = new ItemEntity({ itemId: 'rocks', count: 1 });
    const entity = spawn(scene, 0, [], inst);
    expect(FindEntities(new THREE.Vector3(), 1)).toContain(entity);
    inst.remove();
    expect(activePrefabs).not.toContain(entity);
    expect(FindEntities(new THREE.Vector3(), 1)).not.toContain(entity);
  });

  it('automatically maintains tickingarea tags and queries only active candidates', async () => {
    const scene = new THREE.Scene();
    const existing = spawn(scene, 120, ['prototyper']); // Inclusive tile-10 boundary; created before binding.
    const { positions } = bindArea(scene);
    const dormant = spawn(scene, 132, ['prototyper']);
    const positionRead = vi.spyOn(dormant, 'getPosition');
    expect(existing.hasTag('tickingarea')).toBe(true);
    expect(dormant.hasTag('tickingarea')).toBe(false);
    expect(activePrefabs).toEqual([existing]);
    existing.model.removeFromParent(); // Unloading a visual must not unregister an active logical prefab.
    expect(FindEntities(new THREE.Vector3(), 1000, ['prototyper'])).toEqual([existing]);
    expect(positionRead).not.toHaveBeenCalled();

    positions.set([new THREE.Vector3(252, 0, 0)]);
    await settle();
    expect(existing.hasTag('tickingarea')).toBe(false);
    expect(dormant.hasTag('tickingarea')).toBe(true);
    expect(activePrefabs).toEqual([dormant]);
    expect(FindEntities(new THREE.Vector3(), 1000)).toEqual([dormant]);
    expect(dormant.hasTag('prototyper')).toBe(true);

    positions.set([new THREE.Vector3()]);
    await settle();
    expect(FindEntities(new THREE.Vector3(), 1000)).toEqual([existing]);
    expect(activePrefabs).toEqual([existing]);
  });

  it('samples current entity positions and clears tags and subscriptions on removal/disposal', async () => {
    const scene = new THREE.Scene();
    const { positions, stop } = bindArea(scene);
    const item = new ItemEntity({ itemId: 'rocks', count: 1 });
    const moving = spawn(scene, 0, [], item);
    const peer = spawn(scene, 0);
    item.transform.position.set(240, 0, 0);
    positions.set([new THREE.Vector3()]); // The next 60-frame position snapshot, even if the player stayed still.
    await settle();
    expect(moving.hasTag('tickingarea')).toBe(false);
    expect(item.hasTag('tickingarea')).toBe(false);
    expect(peer.hasTag('tickingarea')).toBe(true);

    positions.set([new THREE.Vector3(240, 0, 0)]);
    await settle();
    expect(item.hasTag('tickingarea')).toBe(true);
    item.remove();
    expect(item.hasTag('tickingarea')).toBe(false);
    disposeActionEntity(peer.model);
    expect(peer.hasTag('tickingarea')).toBe(false);
    expect(activePrefabs).not.toContain(peer);
    const survivor = spawn(scene, 240);
    expect(survivor.hasTag('tickingarea')).toBe(true);
    positions.set([new THREE.Vector3()]); // Disposal also cancels an already queued area effect.
    stop();
    expect(survivor.hasTag('tickingarea')).toBe(false);
    expect(activePrefabs).toEqual([]);
    positions.set([new THREE.Vector3()]);
    await settle();
    expect(FindEntities(new THREE.Vector3(), 1000)).toEqual([]);
  });
});
