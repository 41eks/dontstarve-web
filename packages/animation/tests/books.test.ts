import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { ItemEntity } from '../../inventory/src/entity';
import { GameTimeScheduler } from '../../prefab/src/components/gameTimeScheduler';
import { Pickable } from '../../prefab/src/components/pickable';
import { actionEntity } from '../../prefab/src/actionEntity';
import { BOOK_ITEM_SPECS, bookActionObject, type BookWorld } from '../../prefab/src/books';
import { TILE_SIZE } from '../../prefab/src/tile';
import { Reader } from '../../componets/src/reader';

function pickedGrass(scene: THREE.Scene, scheduler: GameTimeScheduler, x: number) {
  const model = new THREE.Group();
  model.position.set(x, 0, 0);
  model.userData.tags = ['plant', 'renewable', 'silviculture'];
  const pickable = new Pickable(model, 'cutgrass', 1440, 1, undefined, undefined,
    { picked: true, regrowSeconds: 1440 }, { scheduler });
  actionEntity(model, 'grass');
  scene.add(model);
  return pickable;
}

function readerFor(position: THREE.Vector3) {
  const tags: string[] = [];
  const doDelta = vi.fn();
  const inst = {
    addTag: (tag: string) => tags.push(tag), removeTag: (tag: string) => tags.splice(tags.indexOf(tag), 1),
    getPosition: () => position, components: { sanity: { doDelta } },
  };
  return { reader: new Reader<typeof inst, BookWorld>(inst), tags, doDelta };
}

it('reads book_silviculture: regrows picked plants in range, spends a use and charges large sanity', () => {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler();
  const near = pickedGrass(scene, scheduler, 10), alsoNear = pickedGrass(scene, scheduler, -20);
  const far = pickedGrass(scene, scheduler, 31 * TILE_SIZE / 4); // Source range is 30 units.
  const book = new ItemEntity({ itemId: 'book_silviculture', count: 1 });
  book.configure(BOOK_ITEM_SPECS.book_silviculture);
  const { reader, tags, doDelta } = readerFor(new THREE.Vector3());
  expect(tags).toEqual(['reader']);
  expect(bookActionObject(book)).toMatchObject({ swap_build: 'swap_books', swap_prefix: 'book_silviculture',
    def: { fx_under_prefab: 'fx_roots_under_book', layer_sound: { frame: 17 } } });

  expect(reader.Read(book, { root: scene, scheduler })).toEqual([true]);
  // One target grows now; the rest wait up to 1 - 1 / (#remaining + 1) seconds.
  expect([near, alsoNear].filter(plant => plant.canBePicked)).toHaveLength(1);
  scheduler.advance(.5);
  expect([near.canBePicked, alsoNear.canBePicked, far.canBePicked]).toEqual([true, true, false]);
  expect(near.state.timer.peek()).toEqual({ status: 'stopped' });
  expect(book.components.finiteuses.uses.peek()).toBe(4);
  expect(doDelta).toHaveBeenCalledExactlyOnceWith(-33);
});

it('fails with NOSILVICULTURE without spending a use or sanity when only ready plants remain', () => {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler();
  const ready = pickedGrass(scene, scheduler, 0);
  ready.regen();
  const book = new ItemEntity({ itemId: 'book_silviculture', count: 1, remainingUses: 2 });
  book.configure(BOOK_ITEM_SPECS.book_silviculture);
  const { reader, doDelta } = readerFor(new THREE.Vector3());
  expect(reader.Read(book, { root: scene, scheduler })).toEqual([false, 'NOSILVICULTURE']);
  expect(book.components.finiteuses.uses.peek()).toBe(2);
  expect(doDelta).not.toHaveBeenCalled();
  reader.OnRemoveFromEntity();
});
