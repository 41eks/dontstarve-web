import { createSignal, createMemo } from '@dontstarve-web/signals';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { prefabDisplay } from '@dontstarve-web/display';
import { testMap } from './tileMapFixture';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup } from '../../display/src';
import { createPondManager, POND_ID } from '../../prefab/src/pond';
import { COLLISION } from '../../componets/src/physicsState';
import * as CANNON from 'cannon-es';
import { GameTimeScheduler } from '../../signals/src';
import { createWorldState } from '../../../src/worldState';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('freezes above snowlevel 0.02, thaws below it, applies to later ponds and stops listening on dispose', async () => {
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const world = createWorldState({ map: testMap(), elapsedSeconds: 0, systems: {} }), scene = new THREE.Scene();
  const snow = { set: (snowlevel: number) => world.weather.OnLoad({ ...world.weather.OnSave(), snowlevel }) };
  const ponds = createPondManager(new PrefabDisplayGroup(scene), '/dst/data/anim', { scheduler: new GameTimeScheduler(), getWatchWorldContent: world.getWatchWorldContent });
  try {
    const first = ponds.spawn(POND_ID, new THREE.Vector3());
    expect(first.frozen).toBe(false);
    expect(first.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: true });
    expect(first.hasTag('slipperyfeettarget')).toBe(false);
    expect(first.hasTag('fishable')).toBe(true);
    snow.set(.02); await tick(); expect(first.frozen).toBe(false);
    snow.set(.03); await tick(); expect(first.frozen).toBe(true);
    expect(first.sprite.sprite.peek().clip).toMatchObject({ name: 'frozen', loop: false });
    expect(first.hasTag('fishable')).toBe(false);
    const later = ponds.spawn(POND_ID, new THREE.Vector3(5, 0, 0));
    expect(later.frozen).toBe(true);
    expect([first, later].map(pond => pond.hasTag('slipperyfeettarget'))).toEqual([true, true]);
    snow.set(0); await tick(); expect([first, later].map(pond => pond.frozen)).toEqual([false, false]);
    expect(first.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: true });
    expect([first, later].map(pond => pond.hasTag('slipperyfeettarget'))).toEqual([false, false]);
    snow.set(1); ponds.dispose(); await tick();
    expect(first.frozen).toBe(false);
    expect(world.weather.snowLevel.peek()).toBe(1);
  } finally { ponds.dispose(); world.dispose(); }
});

it('sleeps with its tile, keeps freezing while asleep and is drawn at its spawn position once awake', async () => {
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const world = createWorldState({ map: testMap(), elapsedSeconds: 0, systems: {} }), scene = new THREE.Scene();
  const snow = { set: (snowlevel: number) => world.weather.OnLoad({ ...world.weather.OnSave(), snowlevel }) };
  const awake = createSignal(true);
  const tickingarea = (() => { const memo = createMemo(() => awake.get()); return Object.assign(memo, { dispose() {} }); }) as never;
  const ponds = createPondManager(new PrefabDisplayGroup(scene), '/dst/data/anim', { scheduler: new GameTimeScheduler(), tickingarea, getWatchWorldContent: world.getWatchWorldContent });
  try {
    const pond = ponds.spawn(POND_ID, new THREE.Vector3(12, 3, -4));
    const model = scene.children.find(child => prefabInstance(child) === pond)!;
    expect(model.position.toArray()).toEqual([12, 0, -4]);
    await prefabDisplay(model)!.artLoaded();
    expect(pond.sprite.loaded).toBe(true);
    expect(pond.sprite.currentAnimation).toBe('idle');
    awake.set(false); await tick();
    expect(pond.status.peek()).toBe('asleep');
    expect(model.parent).toBeNull();
    snow.set(.5); await tick();
    expect(pond.frozen).toBe(true);
    expect(pond.sprite.sprite.peek().clip).toMatchObject({ name: 'frozen', finished: true });
    awake.set(true); await tick();
    expect(model.parent).toBe(scene);
    expect(pond.components.slipperyfeettarget).toBeDefined();
    pond.remove();
    expect(ponds.exportRecords()).toEqual([]);
  } finally { ponds.dispose(); world.dispose(); }
});

it('declares its obstacle physics and map icon, and frozen ice stops blocking characters', async () => {
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const world = createWorldState({ map: testMap(), elapsedSeconds: 0, systems: {} }), physics = new CANNON.World();
  const snow = { set: (snowlevel: number) => world.weather.OnLoad({ ...world.weather.OnSave(), snowlevel }) };
  const ponds = createPondManager(new PrefabDisplayGroup(new THREE.Scene()), '/dst/data/anim', { scheduler: new GameTimeScheduler(), physics, getWatchWorldContent: world.getWatchWorldContent });
  try {
    const pond = ponds.spawn(POND_ID, new THREE.Vector3(30, 0, 6));
    expect(pond.hasTag('blocker')).toBe(true);
    expect(pond.getPhysicsRadius()).toBeCloseTo(1.95 * 3);
    expect(pond.minimap.icon).toBe('pond.png');
    expect(physics.bodies).toContain(pond.physicsBody);
    expect([pond.physicsBody!.position.x, pond.physicsBody!.position.z]).toEqual([30, 6]);
    expect(pond.physicsBody!.collisionResponse).toBe(true);
    snow.set(.5); await tick();
    expect(pond.physicsBody!.collisionResponse).toBe(false);
    // Spawned into a frozen world: declaring the collider must not undo the ice.
    const later = ponds.spawn(POND_ID, new THREE.Vector3(60, 0, 6));
    expect(later.physics.json.peek()).toMatchObject({ group: COLLISION.LAND_OCEAN_LIMITS, mask: COLLISION.WORLD | COLLISION.ITEMS });
    snow.set(0); await tick();
    expect(pond.physics.json.peek()).toMatchObject({ group: COLLISION.OBSTACLES, mask: COLLISION.ITEMS | COLLISION.CHARACTERS | COLLISION.GIANTS });
    expect(pond.physicsBody!.collisionResponse).toBe(true);
    const body = pond.physicsBody!;
    pond.remove();
    expect(physics.bodies).not.toContain(body);
  } finally { ponds.dispose(); world.dispose(); }
});
