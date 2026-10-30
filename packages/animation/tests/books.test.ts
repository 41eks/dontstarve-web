import { createEmptyEntity } from '../../prefab/src/prefabInstance';
import { testMap } from './tileMapFixture';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { ItemEntity } from '../../inventory/src/entity';
import { GameTimeScheduler } from '../../prefab/src/components/gameTimeScheduler';
import { Pickable } from '../../prefab/src/components/pickable';
import { actionEntity } from '../../prefab/src/actionEntity';
import { BOOK_ITEM_SPECS, bookActionObject, type BookWorld } from '../../prefab/src/books';
import { TILE_SIZE } from '../../prefab/src/tile';
import { Reader } from '../../componets/src/reader';
import { Weather } from '../../componets/src/weather';
import { createWorldClockUpdater, createWorldState } from '../../../src/worldState';
import { bindTestWorld } from './worldContentFixture';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(stop => stop()); });

function bookWorld(root: THREE.Scene, scheduler: GameTimeScheduler, weather: Weather): BookWorld {
  const { moon, getWatchWorldContent, unbind } = bindTestWorld(scheduler);
  cleanups.push(unbind);
  return { root, scheduler, weather, getWatchWorldContent,
    moon: { SetMoonPhase: phase => moon.set({ ...moon.peek(), phase }) } };
}

const newWeather = () => new Weather({ totalDayTime: 480, temperature: () => 20, random: () => 0.5 });

function pickedGrass(scene: THREE.Scene, scheduler: GameTimeScheduler, x: number) {
  const { instance, display } = createEmptyEntity('grass');
  const model = display.model; instance.position.set(x, 0, 0);
  for (const tag of ['plant', 'renewable', 'silviculture']) instance.addTag(tag);
  cleanups.push(() => { instance.remove(); display.dispose(); });
  const pickable = new Pickable(instance, 'cutgrass', 1440, 1, undefined, undefined,
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

  expect(reader.Read(book, bookWorld(scene, scheduler, newWeather()))).toEqual([true]);
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
  expect(reader.Read(book, bookWorld(scene, scheduler, newWeather()))).toEqual([false, 'NOSILVICULTURE']);
  expect(book.components.finiteuses.uses.peek()).toBe(2);
  expect(doDelta).not.toHaveBeenCalled();
  reader.OnRemoveFromEntity();
});

it('reads book_rain: toggles precipitation through moisture, spawns its fx and charges large sanity', () => {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), weather = newWeather();
  const spawnFx = vi.fn();
  const book = new ItemEntity({ itemId: 'book_rain', count: 1 });
  book.configure(BOOK_ITEM_SPECS.book_rain);
  const { reader, doDelta } = readerFor(new THREE.Vector3());
  const world: BookWorld = { ...bookWorld(scene, scheduler, weather), spawnFx };
  expect(bookActionObject(book).def?.fx).toBe('fx_book_rain');

  // ms_forceprecipitation true: moisture jumps to the ceiling and the next update starts the rain.
  expect(reader.Read(book, world)).toEqual([true]);
  expect(weather.moisture.peek()).toBe(weather.moistureceil.peek());
  expect(weather.rainRate.peek()).toBe(0);
  weather.OnUpdate(1);
  expect(weather.preciptype.peek()).toBe('rain');
  expect(weather.rainRate.peek()).toBeCloseTo(0.1, 5);
  // Moisture dissipates by rate * dt * 10, so the rate climbs toward the peak.
  for (let i = 0; i < 500; i++) weather.OnUpdate(1);
  expect(weather.rainRate.peek()).toBeGreaterThan(0.3);
  expect(weather.rainRate.peek()).toBeLessThanOrEqual(weather.peakprecipitationrate.peek());

  // Reading while it rains forces the floor, which stops the rain.
  expect(reader.Read(book, world)).toEqual([true]);
  weather.OnUpdate(1);
  expect(weather.preciptype.peek()).toBe('none');
  expect(weather.rainRate.peek()).toBe(0);
  expect(spawnFx).toHaveBeenCalledTimes(2);
  expect(spawnFx).toHaveBeenCalledWith('fx_book_rain', expect.anything());
  expect(book.components.finiteuses.uses.peek()).toBe(3);
  expect(doDelta).toHaveBeenCalledTimes(2);
  expect(doDelta).toHaveBeenCalledWith(-33);
  reader.OnRemoveFromEntity();
});

it('lets rain dissipate to its floor on its own and restores precipitation from a save', () => {
  const weather = newWeather();
  weather.ForcePrecipitation();
  weather.OnUpdate(1);
  const saved = weather.OnSave();
  const restored = newWeather();
  restored.OnLoad(saved);
  expect(restored.OnSave()).toEqual(saved);
  expect(restored.rainRate.peek()).toBe(weather.rainRate.peek());
  expect(() => restored.OnLoad({ ...saved, preciptype: 'hail' as never })).toThrow(RangeError);
  expect(restored.OnSave()).toEqual(saved);
  for (let i = 0; i < 2000 && weather.preciptype.peek() !== 'none'; i++) weather.OnUpdate(1);
  expect(weather.preciptype.peek()).toBe('none');
  expect(weather.moisture.peek()).toBe(weather.moisturefloor.peek());
  // A finished rain re-randomizes the ceiling and does not restart without a new force.
  const { moisture } = weather.OnSave();
  weather.OnUpdate(1000);
  expect(weather.OnSave().moisture).toBe(moisture);
  weather.dispose(); restored.dispose();
});

it('reads book_moon: forces a full moon through the world clock, refuses when already full and charges huge sanity', () => {
  const state = createWorldState({ map: testMap(), elapsedSeconds: 480 * 3 + 10, systems: {} });
  const updater = createWorldClockUpdater(state, 480 * 3 + 10);
  const book = new ItemEntity({ itemId: 'book_moon', count: 1 });
  book.configure(BOOK_ITEM_SPECS.book_moon);
  const { reader, doDelta } = readerFor(new THREE.Vector3());
  const world = { root: new THREE.Scene(), scheduler: new GameTimeScheduler(), weather: newWeather(),
    getWatchWorldContent: state.getWatchWorldContent, moon: { SetMoonPhase: state.SetMoonPhase } } as BookWorld;
  try {
    expect(state.moonPhase.peek()).toBe('quarter');
    expect(reader.Read(book, world)).toEqual([true]);
    expect(state.moonPhase.peek()).toBe('full');
    expect(state.clock.peek().waxing).toBe(false); // clock.lua GetMoonPhase for cycle step 11.
    expect(book.components.finiteuses.uses.peek()).toBe(2);
    expect(doDelta).toHaveBeenCalledExactlyOnceWith(-50);
    // The override survives the next settlement and advances one step per day.
    updater.update(1); updater.flush();
    expect(state.moonPhase.peek()).toBe('full');
    updater.update(480); updater.flush();
    expect(state.moonPhase.peek()).toBe('threequarter');
    expect(state.moonPhaseCycle()).toBe(12);
    // Reload keeps the shifted cycle.
    const restored = createWorldState({ map: testMap(), elapsedSeconds: 480 * 4 + 11, systems: { moon: { mooomphasecycle: state.moonPhaseCycle() } } });
    expect(restored.moonPhase.peek()).toBe('threequarter');
    restored.dispose();

    state.SetMoonPhase('full');
    expect(reader.Read(book, world)).toEqual([false, 'ALREADYFULLMOON']);
    expect(book.components.finiteuses.uses.peek()).toBe(2);
    expect(doDelta).toHaveBeenCalledTimes(1);
  } finally { state.dispose(); }
});
