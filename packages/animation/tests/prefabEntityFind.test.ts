import * as THREE from 'three';
import { expect, it } from 'vitest';
import { PrefabDisplayGroup, SpriteState } from '@dontstarve-web/display';
import { PrefabEntityManager, PrefabInstance } from '../../prefab/src/prefabInstance';

function world() {
  const displays = new PrefabDisplayGroup(new THREE.Scene());
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, undefined, {}, {
    thing: { fn: () => new PrefabInstance('thing', new SpriteState({ name: '' })) },
  });
  const spawn = (x: number, ...tags: string[]) => {
    const inst = prefabs.spawn('thing', new THREE.Vector3(x, 0, 0));
    for (const tag of tags) inst.addTag(tag);
    return inst;
  };
  return { prefabs, spawn, dispose: () => { prefabs.dispose(); displays.dispose(); } };
}

const origin = new THREE.Vector3(0, 0, 0);

it('finds every valid entity in range nearest first, asleep or in limbo, leaving exclusion to the tags', () => {
  const { prefabs, spawn, dispose } = world();
  const far = spawn(3, 'a'), self = spawn(0, 'a'), near = spawn(1, 'a', 'b'), edge = spawn(4), outside = spawn(5, 'a');
  far.setActive(false);
  near.RemoveFromScene();

  // Spawned far first, but returned by distance; the querier, the asleep and the INLIMBO entities are included.
  expect(far.status.peek()).toBe('asleep');
  expect(prefabs.FindEntities(origin, 4)).toEqual([self, near, far, edge]);
  expect(prefabs.FindEntities(origin, 4, [], ['INLIMBO'])).toEqual([self, far, edge]);
  expect(prefabs.FindEntities(origin, 4, ['a', 'b'])).toEqual([near]);
  expect(prefabs.FindEntities(origin, 10, [], [], ['b', 'missing'])).toEqual([near]);
  expect(prefabs.FindEntities(origin, 10)).toContain(outside);
  for (const radius of [-1, NaN, Infinity]) expect(() => prefabs.FindEntities(origin, radius)).toThrow(RangeError);
  expect(prefabs.FindEntities(new THREE.Vector3(NaN, 0, 0), 4)).toEqual([]);

  // A removed entity leaves the query.
  near.remove();
  expect(prefabs.FindEntities(origin, 4)).toEqual([self, far, edge]);
  dispose();
});

it('searches a tracked entity it did not spawn without saving it, until the entity is removed', () => {
  const { prefabs, spawn, dispose } = world();
  const thing = spawn(2);
  const player = new PrefabInstance('wilson', new SpriteState({ name: '' }));
  player.setPosition(1, 0, 0);
  player.addTag('player');
  prefabs.track(player);
  prefabs.track(player);

  expect(prefabs.FindEntities(origin, 3)).toEqual([player, thing]);
  expect(prefabs.FindEntities(origin, 3, ['player'])).toEqual([player]);
  expect(prefabs.exportRecords().map(({ prefabId }) => prefabId)).toEqual(['thing']);

  player.remove();
  expect(prefabs.FindEntities(origin, 3)).toEqual([thing]);
  dispose();
});
