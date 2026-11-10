import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import { lightflierFlowerPrefabs, LIGHTFLIER_FLOWER_ID, type LightFlierFlowerInstance } from '../../prefab/src/lightflier_flower';
import { LightFlier, LightFlierHabitat, configureLightFlierEntity, type LightFlierPlayer } from '../../prefab/src/lightflier';
import type { PlacementSaveRecord } from '../../prefab/src/saveRecord';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ItemEntity } from '../../inventory/src';
import { createPickupInventory } from './pickupFixture';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { createMemo, createSignal } from '../../signals/src';
import { bindTestWorld } from './worldContentFixture';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';

/** The inst.Light an entity's model declares. */
const declaredLight = (model: THREE.Object3D) => prefabInstance(model)?.light.peek();

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {}, isPlaying: () => true })) }));
beforeEach(() => vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const task = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(players: LightFlierPlayer[] = [], withWorld = false) {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), entities: ItemEntity[] = [], loot: string[] = [];
  const awake = createSignal(true), area = createMemo(() => awake.get());
  const world = withWorld ? bindTestWorld(scheduler, () => area) : undefined;
  const dropLoot = (id: string, count: number) => { for (let i = 0; i < count; i++) loot.push(id); };
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { scheduler, tickingarea: world?.tickingarea });
  const habitat = new LightFlierHabitat({ scheduler, getWatchWorldContent: world?.getWatchWorldContent, tickingarea: world?.tickingarea, getPlayers: () => players,
    spawnItem: state => { const entity = new ItemEntity(state); entities.push(entity); return entity; }, dropLoot,
    getHomes: () => prefabs.instances(LIGHTFLIER_FLOWER_ID) as Iterable<LightFlierFlowerInstance> });
  prefabs.register(lightflierFlowerPrefabs({ scheduler, habitat, dropLoot, getWatchWorldContent: world?.getWatchWorldContent, getLightLevel: () => 1 }));
  const spawn = (position: THREE.Vector3, record?: PlacementSaveRecord) => prefabs.spawn(LIGHTFLIER_FLOWER_ID, position, record) as LightFlierFlowerInstance;
  const records = () => prefabs.exportRecords().map(({ record }) => record);
  const step = async (dt: number) => { scheduler.advance(dt); for (const fly of habitat.flies) fly.update(dt); habitat.update(dt); displays.update(dt); await task(); };
  const dispose = () => { entities.forEach(entity => entity.destroy()); prefabs.dispose(); displays.dispose(); habitat.dispose(); world?.unbind(); area.dispose(); scheduler.dispose(); };
  return { scene, scheduler, entities, habitat, spawn, records, loot, step, dispose, awake };
}

it('releases a child on light timeout, pauses growth, and captures the same entity before resuming the 12-day timer', async () => {
  const s = setup(), inventory = createPickupInventory();
  try {
    const plant = s.spawn(new THREE.Vector3(3, 0, 4)), model = plant.transform.model;
    await s.step(1); expect(plant.light_state).toBe('ON');
    await s.step(198);
    const [fly] = s.habitat.flies;
    expect(plant.components.pickable.canBePicked).toBe(false); expect(plant.components.pickable.state.paused.peek()).toBe(true);
    expect(fly.home).toBe(plant); expect(s.entities).toHaveLength(1); expect(plant.components.childspawner.numchildrenoutside).toBe(1);
    expect(declaredLight(model)).toBeUndefined();
    expect(performToolWork('NET', fly.entity, { components: { inventory } })).toBe(true);
    expect(inventory.Has('lightflier')).toBe(true); expect(inventory.exportState().slots.find(slot => slot.item?.itemId === 'lightflier')?.item?.entityId).toBe(fly.id);
    expect(plant.components.childspawner.numchildrenoutside).toBe(0); expect(plant.components.pickable.state.paused.peek()).toBe(false);
    expect(plant.components.pickable.remainingSeconds).toBe(5760);
    const seconds = plant.components.pickable.remainingSeconds!; s.scheduler.advance(seconds);
    expect(plant.components.pickable.canBePicked).toBe(true);
  } finally { inventory.dispose(); s.dispose(); }
});

it('restores child ownership and returns home only at the source stategraph frame, validating burning targets', async () => {
  const s = setup(), restored = setup();
  try {
    const plant = s.spawn(new THREE.Vector3());
    plant.components.pickable.Pick(); const fly = [...s.habitat.flies][0];
    const record = s.records()[0], state = fly.entity.snapshot();
    // OnSave writes the record the save reader returns unchanged.
    const inventory = createPickupInventory();
    try {
      const json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG), { entities: { lightflier_flower: [record] },
        inventory: inventory.exportState(), elapsedSeconds: 1, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
      expect(deserializeSave(json, SAVE_CATALOG).world.entities.lightflier_flower).toEqual([record]);
    } finally { inventory.dispose(); }
    expect(record.components.lightflierFlower).toMatchObject({ picked: true, paused: true, childspawner: { childrenoutside: [fly.id] } });
    const home = restored.spawn(new THREE.Vector3(), record);
    const entity = new ItemEntity(state); restored.entities.push(entity); configureLightFlierEntity(entity);
    const child = entity.getComponent<LightFlier>('lightflier')!; restored.habitat.bind(child);
    expect(child.home).toBe(home); expect(home.components.childspawner.OnSave().childrenoutside).toEqual([fly.id]);
    child.getPosition().copy(home.getPosition()); home._lightflier_returning_home = child;
    await restored.step(1); // Finish initial flight state / evaluate the GOHOME branch.
    expect(child.sg.stateName).toBe('go_home');
    restored.scheduler.advance(19 / 30); expect(entity.isRemoved).toBe(false);
    home.components.burnable.Ignite(); restored.scheduler.advance(1 / 30 + .001);
    expect(entity.isRemoved).toBe(false); expect(child.sg.stateName).toBe('idle');
    home.components.burnable.Extinguish();
    for (let i = 0; i < 12 && !entity.isRemoved; i++) await restored.step(.25);
    expect(entity.isRemoved).toBe(true); expect(home.components.pickable.canBePicked).toBe(true);
    expect(home.light_state).toBe('ON'); expect(home.components.childspawner.numchildrenoutside).toBe(0);
  } finally { s.dispose(); restored.dispose(); }
});

it('forms a following circle only for a player holding a lightflier, and detaches a far home when the formation disbands', async () => {
  let carrying = true;
  const player: LightFlierPlayer = { position: new THREE.Vector3(4, 0, 0), isValid: () => true, hasLightFlier: () => carrying,
    getFacing: () => 0, getWalkSpeed: () => 12, wantsToMove: () => false };
  const s = setup([player]);
  try {
    const home = s.spawn(new THREE.Vector3());
    home.components.pickable.Pick(); const fly = [...s.habitat.flies][0];
    await s.step(1); expect(s.habitat.formations.size).toBe(1); expect(fly.inFormation).toBe(true);
    expect(fly.entity.hasTag('NOBLOCK')).toBe(true);
    for (let i = 0; i < 20; i++) await s.step(.1);
    expect(fly.components.formationfollower.targetpos).toBeInstanceOf(THREE.Vector3);
    expect(fly.components.formationfollower.active).toBe(true);
    fly.getPosition().set(100, 0, 0); carrying = false; await s.step(1);
    expect(fly.inFormation).toBe(false); expect(fly.home).toBeUndefined();
    expect(home.components.pickable.state.paused.peek()).toBe(false); expect(fly.entity.hasTag('NOBLOCK')).toBe(false);
  } finally { s.dispose(); }
});

it('drops one bulb on death and cancels owned tasks on disposal while preserving the injected scheduler', async () => {
  const s = setup();
  const home = s.spawn(new THREE.Vector3());
  home.components.pickable.Pick(); const fly = [...s.habitat.flies][0];
  fly.components.health.DoDelta(-25); expect(s.loot).toEqual(['lightbulb']); expect(home.components.childspawner.numchildrenoutside).toBe(0);
  const recall = home._call_for_lightflier_task; expect(recall?.NextTime()).toBeDefined();
  s.dispose(); expect(recall!.NextTime()).toBeUndefined();
});

it('feeds captured livestock and replaces an entire starving stack with the same number of bulbs', () => {
  const inventory = createPickupInventory();
  try {
    inventory.add('lightflier', 3);
    const stack = inventory.exportState().slots.find(slot => slot.item?.itemId === 'lightflier')!;
    const bug = inventory.getEntity(stack.address)!;
    bug.components.perishable.SetPercent(.2);
    const food = inventory.entities.create({ itemId: 'carrot', count: 1 }); inventory.configureItem(food);
    expect(bug.components.eater!.Eat(food)).toBe(true);
    expect(bug.components.perishable.GetPercent()).toBe(1);
    bug.components.perishable.Perish();
    expect(inventory.get(stack.address)?.itemId).toBe('lightbulb');
    expect(inventory.get(stack.address)?.count).toBe(3);
  } finally { inventory.dispose(); }
});

it('freezes and thaws through scheduler tasks, and returns an offscreen child home during daytime without rendering', async () => {
  const s = setup([], true);
  try {
    const home = s.spawn(new THREE.Vector3());
    home.components.pickable.Pick(); const fly = [...s.habitat.flies][0]; await task();
    fly.components.freezable!.AddColdness(1, 1); expect(fly.sg.stateName).toBe('frozen');
    s.scheduler.advance(1); expect(fly.components.freezable!.IsThawing()).toBe(true); expect(fly.sg.stateName).toBe('thaw');
    s.scheduler.advance(10); expect(fly.components.freezable!.IsFrozen()).toBe(false); expect(fly.sg.stateName).toBe('hit');
    s.awake.set(false); await task(); expect(fly.active.peek()).toBe(false);
    s.scheduler.advance(11); // No visual/update() call; entity sleep's daytime callback owns the commit.
    expect(fly.entity.isRemoved).toBe(true); expect(home.components.pickable.canBePicked).toBe(true);
  } finally { s.dispose(); }
});
