import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bulbPlantPrefabs, bulbPlantRegrowTime, BULB_PLANT_LIGHT, type BulbPlantInstance } from '../../prefab/src/bulb_plant';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { createInventoryStore } from '../../../src/inventory';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

const turn = () => new Promise(resolve => setTimeout(resolve, 0));
vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
  vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true), inventory = createInventoryStore([]);
  let light = 1;
  const getLightLevel = vi.fn(() => light);
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { tickingarea: () => createMemo(() => awake.get()) });
  prefabs.register(bulbPlantPrefabs({ scheduler, getLightLevel }) as never);
  const registry = new EntityRegistry([], prefabs, () => new THREE.Vector3(1, 0, 2));
  registry.registerPrefabs(PREFAB_DEFINITIONS.bulbPlants);
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
    playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  const spawn = (id: string, saved?: Parameters<typeof prefabs.spawn>[2]) => prefabs.spawn(id, new THREE.Vector3(1, 0, 2), saved) as BulbPlantInstance;
  return { scene, scheduler, awake, inventory, prefabs, registry, save, spawn, getLightLevel, setLight: (value: number) => { light = value; },
    clip: (plant: PrefabInstance) => plant.sprite.sprite.peek().clip,
    plants: () => scene.children.map(model => prefabInstance<BulbPlantInstance>(model)!).filter(plant => plant?.prefab.startsWith('flower_cave')),
    dispose: () => { registry.dispose(); prefabs.dispose(); displays.dispose(); inventory.dispose(); scheduler.dispose(); } };
}

describe('flower_cave source light cycle', () => {
  it('waits on wake, turns on in light, drains after 94 seconds and recharges after 114', () => {
    const s = setup();
    try {
      const plant = s.spawn('flower_cave');
      s.scheduler.advance(0.9);
      expect(plant.light_state).toBe('CHARGED');
      s.scheduler.advance(0.2);
      expect(plant.light_state).toBe('ON');
      // recharge, then the idle loop (without art the display finishes the one-shot clip at once).
      expect(s.clip(plant)).toMatchObject({ name: 'idle', loop: true });
      // OnLightDirty's periodic task tweens the light to its steady value.
      s.scheduler.advance(3.9);
      expect(plant.light.peek()).toEqual(BULB_PLANT_LIGHT);
      s.scheduler.advance(90);
      expect(plant.light_state).toBe('RECHARGING');
      expect(s.clip(plant)).toMatchObject({ name: 'withered', loop: false });
      s.scheduler.advance(4);
      expect(plant.light.peek()).toBeUndefined();
      s.setLight(0);
      s.scheduler.advance(110);
      expect(plant.light_state).toBe('CHARGED');
      expect(s.clip(plant)).toMatchObject({ name: 'off', loop: false });
      expect(plant.GetPersistData()).toEqual({ bulbPlant: { variant: 'single', lightState: 'CHARGED' } });
    } finally { s.dispose(); }
  });

  it('observes LightWatcher hysteresis, and samples only while the entity is awake', async () => {
    const s = setup();
    try {
      const plant = s.spawn('flower_cave');
      s.setLight(0); s.scheduler.advance(2);
      s.setLight(0.06); s.scheduler.advance(1);
      expect(plant.light_state).toBe('CHARGED');
      s.setLight(0.075); s.scheduler.advance(4);
      expect(plant.light_state).toBe('ON');
      s.setLight(0); s.scheduler.advance(1);
      expect(plant.light_state).toBe('ON');
      s.awake.set(false); await turn();
      const sampled = s.getLightLevel.mock.calls.length;
      s.scheduler.advance(5);
      expect(s.getLightLevel.mock.calls.length).toBe(sampled);
      s.awake.set(true); await turn();
      expect(s.getLightLevel.mock.calls.length).toBeGreaterThan(sampled);
    } finally { s.dispose(); }
  });
});

describe('flower_cave harvesting and regrowth', () => {
  it('picks a double plant for 2 bulbs and regrows after 2160 seconds', () => {
    const s = setup();
    try {
      const plant = s.spawn('flower_cave_double'), { pickable } = plant.components;
      s.scheduler.advance(5);
      expect([plant.hasTag('plant'), plant.hasTag('pickable')]).toEqual([true, true]);
      const full = vi.fn(() => false);
      expect(pickable.pick({ giveItem: full })).toBe(false);
      expect(full).toHaveBeenCalledWith('lightbulb', 2, plant.position);
      expect(plant.light.peek()).toBeDefined();

      const give = vi.fn(() => true);
      expect(pickable.pick({ giveItem: give })).toBe(true);
      expect(plant.hasTag('pickable')).toBe(false);
      expect(plant.light.peek()).toBeUndefined();
      expect(s.clip(plant)).toMatchObject({ name: 'picked' });
      expect(plant.GetPersistData()).toEqual({ bulbPlant: { variant: 'double', lightState: 'RECHARGING', picked: true, regrowSeconds: 2160 } });

      s.scheduler.advance(2160 - 0.25);
      expect(pickable.canBePicked).toBe(false);
      s.scheduler.advance(0.25);
      expect(pickable.canBePicked).toBe(true);
      expect(s.clip(plant)).toMatchObject({ name: 'idle', loop: true });
      expect(plant.GetPersistData()).toEqual({ bulbPlant: { variant: 'double', lightState: 'RECHARGING', remainingSeconds: 114 } });
    } finally { s.dispose(); }
  });
});

describe('flower_cave spawning, art and saving', () => {
  it('loads each source archive, keeps c_spawn plants through c_save and restores picked and lit plants', async () => {
    const s = setup(), restored = setup();
    try {
      for (const id of ['flower_cave', 'flower_cave_double', 'flower_cave_triple']) {
        expect((await executeDebugCommand(`c_spawn("${id}")`, s.inventory, prefab => s.registry.spawn(prefab))).ok).toBe(true);
      }
      const lit = s.spawn('flower_cave', { id: 'e_springy', components: { bulbPlant: { variant: 'springy', lightState: 'ON', remainingSeconds: 50 } } });
      const [single, double, triple] = s.plants();
      expect(s.plants().map(plant => plant.variant)).toEqual(['single', 'double', 'triple', 'springy']);
      // instanceAssets resolves each plant's SetBank / SetBuild after its SetPersistData, so springy loads its own archive.
      await vi.waitFor(() => expect(s.plants().map(plant => plant.sprite.loaded)).toEqual([true, true, true, true]));
      await Promise.all(s.plants().map(plant => prefabDisplay(plant.transform.model)!.artLoaded()));
      expect(prefabDisplay(lit.transform.model)!.model.getObjectByProperty('isMesh', true)).toBeDefined();
      // A loaded lit plant loops idle with the steady light; the variant picks the radius.
      expect(s.clip(lit)).toMatchObject({ name: 'idle', loop: true });
      expect(lit.light.peek()).toEqual(BULB_PLANT_LIGHT);
      expect(lit.minimap.icon).toBe('bulb_plant.png');
      s.scheduler.advance(10);
      expect([single, double, triple].map(plant => plant.light.peek()?.radius)).toEqual([9, 13.5, 13.5]);

      expect(lit.components.pickable.pick({ giveItem: () => true })).toBe(true);
      let json = '';
      expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
      const entities = deserializeSave(json, SAVE_CATALOG).world.entities;
      for (const id of ['flower_cave', 'flower_cave_double', 'flower_cave_triple']) {
        for (const record of entities[id] ?? []) restored.prefabs.spawn(id, new THREE.Vector3(...record.transform.position), record);
      }
      const byId = (records: ReturnType<typeof s.prefabs.exportRecords>) => [...records].sort((a, b) => a.record.id.localeCompare(b.record.id));
      expect(byId(restored.prefabs.exportRecords())).toEqual(byId(s.prefabs.exportRecords()));
      const picked = restored.plants().find(plant => plant.entityId === 'e_springy')!;
      expect([picked.variant, picked.components.pickable.canBePicked, picked.light.peek()]).toEqual(['springy', false, undefined]);
      expect(s.clip(picked)).toMatchObject({ name: 'picked', finished: true });
      restored.scheduler.advance(bulbPlantRegrowTime('springy'));
      expect(picked.components.pickable.canBePicked).toBe(true);
      picked.remove();
      expect(picked.light.peek()).toBeUndefined();
    } finally { s.dispose(); restored.dispose(); }
  });
});
