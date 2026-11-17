import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { PrefabDisplayGroup, SpriteState, prefabDisplay } from '../../display/src';
import { PrefabEntityManager, PrefabInstance } from '../../prefab/src/prefabInstance';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUTTERFLY_DEFINITIONS, ButterflyEntity, MakeButterflyCreature, UpdateButterfly,
  type ButterflyWorld,
} from '../../prefab/src/butterfly';

import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindTestWorld } from './worldContentFixture';
import { ItemWorldFixture } from './itemWorldFixture';
import { createPickupInventory } from './pickupFixture';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { inventorySlotAddress } from '../../inventory/src';
import { createPerishWorld } from './perishWorldFixture';
import { createInventoryStore, testItem } from './testInventory';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(stop => stop()); });

function setup(prefab: 'butterfly' | 'moonbutterfly' = 'butterfly', dropLoot = vi.fn()) {
  let complete: (() => void) | undefined;
  let current = 'idle_flight_loop';
  const animation = {
    start: vi.fn((name: string) => { current = name; }), update: vi.fn(),
    playOnce: vi.fn((name: string, callback?: () => void) => { current = name; complete = callback; }),
    get currentAnimation() { return current; },
  };
  const scheduler = new GameTimeScheduler();
  const { cycle, getWatchWorldContent, unbind } = bindTestWorld(scheduler);
  const world: ButterflyWorld = {
    getWatchWorldContent,
  };
  // TheSim: the butterfly, its flowers and the player are the entities one manager finds.
  const displays = new PrefabDisplayGroup(new THREE.Scene());
  const prefabs = new PrefabEntityManager<string, PrefabInstance<SpriteState, object>>(displays, '/dst/data/anim', {});
  const entity = new ButterflyEntity(BUTTERFLY_DEFINITIONS[prefab], { itemId: prefab, count: 1 }, undefined, testItem);
  prefabs.track(entity);
  MakeButterflyCreature(entity, world, { animation, random: () => 0, dropLoot });
  const controller = entity;
  const add = (prefab: string, tags: readonly string[], position: THREE.Vector3) => {
    const inst = new PrefabInstance(prefab, new SpriteState({ name: 'idle', billboard: true }));
    for (const tag of tags) inst.addTag(tag);
    inst.setPosition(position.x, position.y, position.z); prefabs.track(inst);
    return inst;
  };
  cleanups.push(() => { entity.remove(); prefabs.dispose(); displays.dispose(); unbind(); scheduler.dispose(); });
  return {
    cycle, animation, controller, world, entity,
    position: () => entity.transform.position.clone(),
    addThreat: (position: THREE.Vector3) => add('wilson', ['player', 'scarytoprey'], position),
    addFlower: (position: THREE.Vector3) => add('flower', ['flower'], position),
    setDay: (value: boolean) => { cycle.set(value ? 'day' : 'dusk'); },
    // The animover is handled on the stategraph's next update.
    complete: () => { const callback = complete; complete = undefined; callback?.(); UpdateButterfly(entity, 0); },
    tick: (seconds: number) => { for (let i = 0; i < Math.round(seconds * 10); i++) UpdateButterfly(entity, 0.1); },
  };
}

describe('live butterfly source behavior', () => {
  it('stays in idle flight until its brain wakes, then wanders and holds still again', () => {
    const s = setup();
    expect(s.animation.start).toHaveBeenLastCalledWith('idle_flight_loop');
    expect(s.controller.state).toBe('idle');
    // PriorityNode scatter (1.5s) and Wander's first 1s wait come before the first step.
    s.tick(2.4);
    expect(s.position().toArray()).toEqual([0, 0, 0]);
    // The idle state hands over to `moving` only after its animation timeout; Wander walks for minwalktime = 2s.
    s.tick(2.6);
    expect(s.position().x).toBeGreaterThan(5);
    expect(s.animation.start).toHaveBeenCalledWith('flight_cycle');
    expect(s.controller.state).toBe('idle');
    const position = s.position().clone();
    s.tick(.5);
    expect(s.position().equals(position)).toBe(true);
  });

  it('runs away from scarytoprey inside 5 units until 10 units away', () => {
    const s = setup();
    s.addThreat(new THREE.Vector3(3, 0, 0));
    s.tick(4.5);
    // RunAway keeps the walking butterfly moving until it is farther than STOP_RUN_AWAY_DIST, then stops.
    expect(s.position().x).toBeLessThan(-6);
    expect(Math.abs(s.position().x - 3)).toBeGreaterThanOrEqual(10);
    expect(s.controller.state).toBe('idle');
    const position = s.position().clone();
    s.tick(.5);
    expect(s.position().equals(position)).toBe(true);
  });

  it('lands, pollinates once, takes off and does not revisit the flower', () => {
    const s = setup();
    s.addFlower(new THREE.Vector3(3, 0, 0));
    s.tick(5);
    expect(s.controller.state).toBe('land');
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('land', expect.any(Function));
    // arrive_dist = ARRIVE_STEP + physics radii of the flower (0) and the butterfly (0.5)... measured to the flower's centre.
    expect(s.position().distanceTo(new THREE.Vector3(3, 0, 0))).toBeLessThan(.7);
    expect(s.controller.hasTag('flying')).toBe(false);
    const landed = s.position().clone();
    s.tick(.5);
    expect(s.position().equals(landed)).toBe(true);
    s.complete();
    expect(s.controller.state).toBe('pollinate');
    expect(s.controller.components.pollinator!.flowers).toHaveLength(1);
    // GetRandomWithVariance(3, 1) with random 0 is 2 seconds.
    s.tick(1.9);
    expect(s.controller.state).toBe('pollinate');
    s.tick(.2);
    expect(s.controller.state).toBe('takeoff');
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('take_off', expect.any(Function));
    s.complete();
    expect(s.controller.state).toBe('idle');
    expect(s.controller.hasTag('flying')).toBe(true);
    s.tick(8);
    expect(s.controller.state).not.toBe('land');
    expect(s.controller.components.pollinator!.flowers).toHaveLength(1);
  });

  it('goes home to a flower at dusk and is removed only after landing', () => {
    const s = setup();
    s.setDay(false);
    s.addFlower(new THREE.Vector3(3, 0, 0));
    s.tick(5);
    expect(s.controller.state).toBe('land');
    expect(s.controller.removed).toBe(false);
    s.complete();
    expect(s.controller.removed).toBe(true);
    const position = s.position().clone();
    s.tick(1);
    expect(s.position().equals(position)).toBe(true);
  });
});

describe('moonbutterfly', () => {
  it('ignores flowers, walks at MOONBUTTERFLY_SPEED and is leashed to its home', () => {
    const s = setup('moonbutterfly');
    s.addFlower(new THREE.Vector3(2, 0, 0));
    expect(s.controller.components.pollinator).toBeUndefined();
    expect(s.controller.components.locomotor!.walkspeed).toBe(2.5);
    expect(s.controller.components.knownlocations!.GetLocation('home')).toEqual({ x: 0, y: 0, z: 0 });
    s.tick(10);
    expect(s.controller.state).not.toBe('land');
    // Carried 30 units from home (beyond MAX_WANDER_DIST 20): Wander heads back.
    s.entity.transform.setPosition(30, 0, 0);
    s.tick(8);
    expect(s.position().x).toBeLessThan(30);
  });

  it('drops moonbutterflywings when it dies', () => {
    const dropLoot = vi.fn();
    const s = setup('moonbutterfly', dropLoot);
    s.controller.PushEvent('death');
    expect(s.controller.state).toBe('death');
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('death', expect.any(Function));
    expect(dropLoot).toHaveBeenCalledWith(['moonbutterflywings'], expect.any(THREE.Vector3));
  });
});

it('draws both butterflies from their own build in the shared batches, one-shots included', async () => {
  vi.stubGlobal('window', new EventTarget());
  const fetch = vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('fetch', fetch);
  const inventory = createPickupInventory();
  const items = new ItemWorldFixture(new THREE.Scene(), new THREE.PerspectiveCamera(), undefined, '/dst/data/databundles/images.zip',
    inventory, '/dst/data/anim', new THREE.Group());
  const requested = (archive: string) => fetch.mock.calls.some(([url]) => String(url).endsWith(`/dst/data/anim/${archive}`));
  // An instanced sprite hides its own meshes; the shared batch draws it.
  const ownShown = (inst: ButterflyEntity) => {
    let shown = 0;
    inst.transform.model.traverse(object => { if (object instanceof THREE.Mesh && object.visible) shown++; });
    return shown;
  };
  try {
    items.spawnFromSave('wild', { ...SAVE_CATALOG.items.butterfly, itemId: 'butterfly', count: 1 }, new THREE.Vector3(3, 0, 0));
    items.spawnFromSave('moon', { ...SAVE_CATALOG.items.moonbutterfly, itemId: 'moonbutterfly', count: 1 }, new THREE.Vector3(6, 0, 0));
    const [wild, moon] = ['wild', 'moon'].map(id => items.entities.get(id));
    if (!(wild instanceof ButterflyEntity) || !(moon instanceof ButterflyEntity)) throw new Error('both prefabs make a ButterflyEntity');
    for (const inst of [wild, moon]) await prefabDisplay(inst.transform.model)!.artLoaded();
    expect(['butterfly_basic.zip', 'butterfly_moon.zip'].map(requested)).toEqual([true, true]);
    expect([ownShown(wild), ownShown(moon)]).toEqual([0, 0]);
    // A one-shot played by SGbutterfly still completes on the instanced path, and stays batched while it plays.
    const done = vi.fn();
    wild.sprite.playOnce('take_off', done);
    items.update(.05);
    expect(wild.sprite.currentAnimation).toBe('take_off');
    expect(ownShown(wild)).toBe(0);
    for (let i = 0; i < 100 && !done.mock.calls.length; i++) items.update(.05);
    expect(done).toHaveBeenCalledOnce();
  } finally { items.dispose(); inventory.dispose(); vi.unstubAllGlobals(); }
});

it('declares both butterflies as item prefabs', () => {
  const inventory = createPickupInventory();
  const items = new ItemWorldFixture(new THREE.Scene(), new THREE.PerspectiveCamera(), undefined, '/dst/data/databundles/images.zip',
    inventory, '/dst/data/anim', new THREE.Group());
  try {
    expect(['butterfly', 'moonbutterfly'].every(id => items.prefabs.has(id))).toBe(true);
  } finally { items.dispose(); inventory.dispose(); }
});

it('spawns a butterfly as its own entity, whose brain stops in an inventory and is remade when it is dropped', () => {
  const inventory = createInventoryStore([]), world = createPerishWorld();
  inventory.entities.bindPerishWorld(world);
  const items = new ItemWorldFixture(new THREE.Scene(), new THREE.PerspectiveCamera(), undefined, '/dst/data/databundles/images.zip',
    inventory, '/dst/data/anim', new THREE.Group());
  const restored = new ItemWorldFixture(new THREE.Scene(), new THREE.PerspectiveCamera(), undefined, '/dst/data/databundles/images.zip',
    createInventoryStore([]), '/dst/data/anim', new THREE.Group());
  try {
    items.spawnFromSave('wild', { ...SAVE_CATALOG.items.butterfly, itemId: 'butterfly', count: 1 }, new THREE.Vector3(3, 0, 0));
    const wild = items.entities.get('wild');
    if (!(wild instanceof ButterflyEntity)) throw new Error('the butterfly prefab makes a ButterflyEntity');
    const brain = wild.brain;
    expect(brain?.stopped).toBe(false);
    expect(wild.sg?.stateName).toBe('idle');
    expect(inventory.GiveItem(wild)).toBe(true);
    expect(inventory.getEntity(inventorySlotAddress(0))).toBe(wild);
    // RemoveFromScene: _DisableBrain_Internal drops the brain and sg:Stop pauses the graph.
    expect(wild.brain).toBeUndefined();
    expect(brain?.stopped).toBe(true);
    inventory.DropItem(wild, new THREE.Vector3(5, 0, 0));
    expect(wild.brain).toBeDefined();
    expect(wild.brain).not.toBe(brain);
    expect(wild.brain?.stopped).toBe(false);
    expect(wild.state).toBe('idle');
    restored.restoreEntities(items.exportEntities());
    const [copy] = restored.entities.values();
    expect(copy).toBeInstanceOf(ButterflyEntity);
    expect(copy.getPosition().toArray()).toEqual([5, 0, 0]);
  } finally { items.dispose(); restored.dispose(); inventory.dispose(); }
});
