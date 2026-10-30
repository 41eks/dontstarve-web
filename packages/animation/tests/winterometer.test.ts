import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { WINTEROMETER_DEFINITION, WINTEROMETER_ID } from '../../prefab/src/winterometer';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { GetTemperatureAtXZ } from '../../componets/src/temperatureoverrider';
import type { SpriteController } from '../src/sprite';
import type { WorldContext } from '../../prefab/src/worldContext';
import * as sound from '../../prefab/src/sound';
import { deserializeSave } from '../../../src/save/deserialize';
import type { SaveDocument } from '../../../src/save/types';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import definitions from '../../prefab/src/definitions.json' with { type: 'json' };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function createPlacement(temperature: { value: number }) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.spyOn(sound, 'PlaySound').mockReturnValue({ stop: vi.fn(), isPlaying: () => true, setVolume: vi.fn() });
  const scheduler = new GameTimeScheduler();
  const world = { scene: new THREE.Scene(), player: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(), renderer: { domElement: new EventTarget() }, scheduler,
    getLocalTemperature: (x: number, z: number) => GetTemperatureAtXZ(() => temperature.value, x, z) } as unknown as WorldContext;
  const placement = new AnimatedBuildingPlacement(world, { [WINTEROMETER_ID]: WINTEROMETER_DEFINITION }, () => false);
  return { placement, scheduler };
}

const spyPercent = (model: THREE.Object3D) => vi.spyOn(prefabInstance(model)!.sprite as SpriteController, 'setPercent');

it('reads the local temperature once per second, clamped to 0..OVERHEAT_TEMP, and stops after being burnt', async () => {
  const temperature = { value: 35 };
  const { placement, scheduler } = await createPlacement(temperature);
  try {
    const model = await placement.spawn(WINTEROMETER_ID).then(() => placement.hammerTargets[0].display.model);
    const percent = spyPercent(model);
    // StartCheckTemp uses delay 0: the first reading happens on the next scheduler tick, then every second.
    scheduler.advance(0);
    expect(percent).toHaveBeenLastCalledWith('meter', 0.5);
    temperature.value = 100;
    scheduler.advance(0.9);
    expect(percent).toHaveBeenCalledTimes(1);
    scheduler.advance(0.1);
    expect(percent).toHaveBeenLastCalledWith('meter', 0);
    temperature.value = -20;
    scheduler.advance(1);
    expect(percent).toHaveBeenLastCalledWith('meter', 1);
    // A lava_pond heater does not change GetLocalTemperature: its reading follows the world temperature.
    expect(GetTemperatureAtXZ(() => 12, 0, 0)).toBe(12);

    // burntup cancels the task and later starts are refused.
    prefabInstance(model)!.addTag('burnt');
    model.dispatchEvent({ type: 'burntup' } as never);
    const calls = percent.mock.calls.length;
    scheduler.advance(5);
    expect(percent).toHaveBeenCalledTimes(calls);
  } finally { placement.dispose(); }
});

it('cancels the check while the hit clip plays and restarts it when the clip ends', async () => {
  const temperature = { value: 70 };
  const { placement, scheduler } = await createPlacement(temperature);
  try {
    await placement.spawn(WINTEROMETER_ID);
    const [{ display: { model }, playHit }] = placement.hammerTargets;
    const sprite = prefabInstance(model)!.sprite as SpriteController;
    scheduler.advance(0);
    const percent = spyPercent(model);
    playHit();
    expect(sprite.currentAnimation).toBe('hit');
    scheduler.advance(3);
    expect(percent).not.toHaveBeenCalled();
    for (let i = 0; i < 90; i++) sprite.update(1 / 30);
    scheduler.advance(0);
    expect(percent).toHaveBeenLastCalledWith('meter', 0);
  } finally { placement.dispose(); }
});

it('keeps its skin through c_save, restores the reading, and saves only the burnt state of a burnt one', async () => {
  const temperature = { value: 35 };
  const { placement, scheduler } = await createPlacement(temperature);
  try {
    await placement.spawn(WINTEROMETER_ID);
    const reskin = await placement.reskinTargets[0].prepareNextSkin();
    expect(reskin.apply()).toBe(true);
    reskin.dispose();
    const saved = placement.exportRecords()[0].record;
    expect(saved.components.building).toMatchObject({ skinId: 'winterometer_circus' });
    expect(saved.components.building).not.toHaveProperty('burnt');

    const parse = (record: typeof saved) => {
      const save = structuredClone(initialWorld) as unknown as SaveDocument;
      save.world.entities = { winterometer: [{ ...structuredClone(record), transform: { ...record.transform, position: [...record.transform.position] } }] };
      save.players.local.inventory.containers = { 'player:inventory': { slotCount: 15, slots: [] }, 'player:equipment': { slotCount: 3, slots: [] } };
      save.players.local.inventory.bufferedBuilds = [];
      return deserializeSave(JSON.stringify(save), { items: {}, skins: {}, recipes: {}, recipeSkins: {},
        buildings: definitions.animatedBuildings, walls: Object.keys(definitions.walls) }).world.entities.winterometer[0];
    };
    const restored = await placement.spawnFromSave(WINTEROMETER_ID, parse(saved));
    expect(lookupPrefabInstance(restored)?.skinId).toBe('winterometer_circus');
    const percent = spyPercent(restored);
    scheduler.advance(0);
    expect(percent).toHaveBeenLastCalledWith('meter', 0.5);

    const burnt = await placement.spawnFromSave(WINTEROMETER_ID, parse({ ...saved,
      components: { ...saved.components, building: { ...saved.components.building!, burnt: true } } }));
    const burntPercent = spyPercent(burnt);
    scheduler.advance(5);
    expect(burntPercent).not.toHaveBeenCalled();
    expect(placement.exportRecords().at(-1)!.record.components.building).toMatchObject({ burnt: true });
  } finally { placement.dispose(); }
});
