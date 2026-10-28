import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { FIRE_PIT_DEFINITION, FIRE_PIT_ID } from '../../prefab/src/firepit';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Fuel } from '../../componets/src/fuel';
import type { WorldContext } from '../../prefab/src/worldContext';
import type { SpriteState } from '@dontstarve-web/display';
import * as sound from '../../prefab/src/sound';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { TILE_SIZE } from '../../prefab/src/tile';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function createPlacement() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const play = vi.spyOn(sound, 'PlaySound').mockReturnValue({ stop: vi.fn(), isPlaying: () => true, setVolume: vi.fn() });
  const scheduler = new GameTimeScheduler();
  const dropLoot = vi.fn();
  const world = { scene: new THREE.Scene(), player: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(), renderer: { domElement: new EventTarget() }, scheduler, dropLoot } as unknown as WorldContext;
  const placement = new AnimatedBuildingPlacement(world, { [FIRE_PIT_ID]: FIRE_PIT_DEFINITION }, () => false);
  return { placement, scheduler, play, dropLoot };
}

/** The campfirefire the pit declares, and the firefx_light attached to the pit. */
function fire(model: THREE.Object3D) {
  const [entry] = [...prefabInstance(model)!.sprite.fx.peek()].filter(([key]) => key.startsWith('campfirefire:'));
  const light = model.getObjectByName('firefx_light');
  return { fx: entry?.[1], animation: (entry?.[1].sprite as SpriteState | undefined)?.currentAnimation,
    light: light && prefabInstance(light)!.light.peek() };
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
    const [{ model, entity }] = placement.hammerTargets;
    const { components } = model.userData;
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
    const [{ model }] = first.placement.hammerTargets;
    // Filling the top section queues a charcoal.
    model.userData.components.fueled.TakeFuelItem(fuelItem(180));
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
    expect(model.userData.components.fueled.currentfuel).toBe(300);
    second.scheduler.advance(300);
    expect(fire(model).fx).toBeUndefined();
    expect(second.dropLoot).toHaveBeenCalledWith([{ itemId: 'charcoal', count: 1 }], expect.any(THREE.Vector3));
    expect(second.placement.exportRecords()[0].record.components.firepit).toEqual({ fueled: { fuel: 0 } });
  } finally { second.placement.dispose(); }
});
