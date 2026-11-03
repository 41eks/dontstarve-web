import { findActionEntity } from '../../prefab/src/actionEntity';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { FIRE_PIT_ID } from '../../prefab/src/firepit';
import { ComponentUpdates } from '../../componets/src/componentUpdates';
import { FireFxHost } from '../../prefab/src/treeFire';
import { createSignal } from '../../signals/src';
import { managedBuildings } from './managedBuildings';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Fuel } from '../../componets/src/fuel';
import type { WorldContext } from '../../prefab/src/worldContext';
import type { SpriteState } from '@dontstarve-web/display';
import * as sound from '../../prefab/src/sound';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { TILE_SIZE } from '../../prefab/src/tile';
import { workTargets } from './workTargets';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function createPlacement(overrides: Partial<WorldContext> = {}) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const play = vi.spyOn(sound, 'PlaySound').mockReturnValue({ stop: vi.fn(), isPlaying: () => true, setVolume: vi.fn() });
  const scheduler = new GameTimeScheduler();
  const dropLoot = vi.fn();
  const world = { scene: new THREE.Scene(), player: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(), renderer: { domElement: new EventTarget() }, scheduler, dropLoot, ...overrides } as unknown as WorldContext;
  const placement = managedBuildings(world, { consume: () => false });
  return { placement, scheduler, play, dropLoot };
}

/** The campfirefire the pit declares, and the firefx_light parented to the pit. */
function fire(model: THREE.Object3D) {
  const pit = prefabInstance(model)!;
  const [entry] = [...pit.sprite.fx.peek()].filter(([key]) => key.startsWith('campfirefire:'));
  const light = [...pit.light.slots.peek()].find(([key]) => key.startsWith('firefx_light:'))?.[1];
  return { fx: entry?.[1], animation: (entry?.[1].sprite as SpriteState | undefined)?.currentAnimation, light: light?.peek() };
}

const fuelItem = (fuelvalue: number) => {
  const fuel = new Fuel({ addTag() {}, removeTag() {}, PushEvent() {} });
  fuel.fuelvalue = fuelvalue;
  return { isRemoved: false, components: { fuel }, GetIsWet: () => false, remove: vi.fn(() => true) };
};

it('burns its fuel down through the fire levels, goes out empty and relights when fuelled', async () => {
  const { placement, scheduler, play } = createPlacement();
  try {
    await placement.spawn(FIRE_PIT_ID);
    const [{ display: { model }, entity }] = workTargets('HAMMER');
    const { components } = prefabInstance(model)!;
    for (const tag of ['campfire', 'structure', 'wildfireprotected', 'BURNABLE_fueled']) expect(entity.hasTag(tag)).toBe(true);

    // FIREPIT_FUEL_START is half of the maximum: section 3 of 4, at the bottom of its level.
    expect(components.burnable.IsBurning()).toBe(true);
    expect(components.inspectable.getstatus()).toBe('NORMAL');
    let current = fire(model);
    expect(current.fx).toMatchObject({ composite: { symbol: 'firefx', offset: [0, 25] } });
    expect(lookupPrefabInstance(current.fx!.display!.model)!.listTags()).toEqual(expect.arrayContaining(['FX', 'HASHEATER']));
    expect(current.animation).toBe('level3');
    expect(current.light).toMatchObject({ radius: 3 * (TILE_SIZE / 4), intensity: .8, falloff: .33 });

    scheduler.advance(1);
    expect(fire(model).animation).toBe('level2');
    expect(components.inspectable.getstatus()).toBe('LOW');

    scheduler.advance(180);
    current = fire(model);
    expect(components.burnable.IsBurning()).toBe(false);
    expect(components.inspectable.getstatus()).toBe('OUT');
    expect(entity.hasTag('fueldepleted')).toBe(true);
    expect(current.fx).toBeUndefined();
    expect(current.light).toBeUndefined();
    expect(play).toHaveBeenCalledWith('dontstarve/common/fireOut', model.position);

    // MED_FUEL with the pit's bonus multiplier refills half the pit.
    const log = fuelItem(45);
    expect(components.fueled.TakeFuelItem(log)).toBe(true);
    expect(log.remove).toHaveBeenCalled();
    expect(play).toHaveBeenCalledWith('dontstarve/common/fireAddFuel', model.position);
    expect(fire(model).animation).toBe('level2');
    expect(placement.exportRecords()[0].record.components.firepit).toEqual({ fueled: { fuel: 90 } });
  } finally { placement.dispose(); }
});

it('saves its fuel and queued charcoal, then drops the charcoal when the restored fire burns out', async () => {
  const first = createPlacement();
  let record;
  try {
    await first.placement.spawn(FIRE_PIT_ID);
    const [{ display: { model } }] = workTargets('HAMMER');
    // Filling the top section queues a charcoal.
    (findActionEntity(model)?.components ?? prefabInstance(model)!.components).fueled.TakeFuelItem(fuelItem(180));
    expect(fire(model).animation).toBe('level4');
    first.scheduler.advance(60);
    ({ record } = first.placement.exportRecords()[0]);
    expect(record.components.firepit).toEqual({ fueled: { fuel: 300 }, queued_charcoal: true });
    expect(record.components.building).not.toHaveProperty('burnt');
  } finally { first.placement.dispose(); }

  const second = createPlacement();
  try {
    const model = await second.placement.spawnFromSave(FIRE_PIT_ID, record);
    expect(fire(model).animation).toBe('level4');
    expect((findActionEntity(model)?.components ?? prefabInstance(model)!.components).fueled.currentfuel).toBe(300);
    second.scheduler.advance(300);
    expect(fire(model).fx).toBeUndefined();
    expect(second.dropLoot).toHaveBeenCalledWith([{ itemId: 'charcoal', count: 1 }], expect.any(THREE.Vector3));
    expect(second.placement.exportRecords()[0].record.components.firepit).toEqual({ fueled: { fuel: 0 } });
  } finally { second.placement.dispose(); }
});

it('burns faster in rain by its precipitation rate, and at the base rate in snow or under rainimmunity', async () => {
  const preciptype = createSignal<'none' | 'rain' | 'snow'>('none'), precipitationRate = createSignal(0);
  const { placement, scheduler } = createPlacement({ weather: { preciptype, precipitationRate } });
  try {
    await placement.spawn(FIRE_PIT_ID);
    const [{ display: { model } }] = workTargets('HAMMER');
    const { components } = prefabInstance(model)!, { fueled } = components;
    const burnt = (seconds: number) => {
      const before = fueled.currentfuel;
      scheduler.advance(seconds);
      return before - fueled.currentfuel;
    };
    expect(burnt(10)).toBeCloseTo(10);
    // The rate is read at each update, so the change applies from the next one.
    preciptype.set('rain'); precipitationRate.set(.5);
    burnt(1);
    expect(burnt(10)).toBeCloseTo(20);
    preciptype.set('snow');
    burnt(1);
    expect(burnt(10)).toBeCloseTo(10);
    preciptype.set('rain');
    Object.assign(components, { rainimmunity: {} });
    burnt(1);
    expect(burnt(10)).toBeCloseTo(10);
  } finally { placement.dispose(); }
});

it('flickers through the world\'s component updates, and a removed pit stops its fire, sound and fuel', async () => {
  const updates = new ComponentUpdates(), fx = FireFxHost.create(undefined, updates);
  const { placement, scheduler, play } = createPlacement({ fire: fx });
  const stop = vi.fn();
  play.mockReturnValue({ stop, isPlaying: () => true, setVolume: vi.fn() });
  try {
    await placement.spawn(FIRE_PIT_ID);
    const [target] = workTargets('HAMMER'), model = target.display.model, pit = prefabInstance(model)!;
    const { fueled } = pit.components;
    const radius = () => fire(model).light!.radius;
    const before = radius();
    updates.update(.1);
    expect(radius()).not.toBe(before);
    expect(pit.position).toBe(model.position);

    pit.remove();
    expect(pit.components.burnable).toBeUndefined();
    expect(stop).toHaveBeenCalled();
    const left = fueled.currentfuel;
    scheduler.advance(30);
    expect(fueled.currentfuel).toBe(left);
    // Nothing is left to flicker.
    expect(() => updates.update(.1)).not.toThrow();
  } finally { placement.dispose(); fx.dispose(); }
});

it('keeps a selected skin and its fire offset through the building save shape', async () => {
  const { placement } = createPlacement();
  try {
    const model = placement.spawnFromSave(FIRE_PIT_ID, { id: 'skinned', transform: { position: [1, 0, 2], rotationY: 0 },
      components: { building: { skinId: 'firepit_hole' }, firepit: { fueled: { fuel: 200 } } } }) as THREE.Group;
    await vi.waitFor(() => expect(fire(model).fx).toMatchObject({ composite: { offset: [0, 25 + 26] } }));
    const { record } = placement.exportRecords()[0];
    expect(record.components.building).toEqual({ skinId: 'firepit_hole' });
    expect(record.components.firepit).toEqual({ fueled: { fuel: 200 } });
    expect(record.components).not.toHaveProperty('fueled');
  } finally { placement.dispose(); }
});
