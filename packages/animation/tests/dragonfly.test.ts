import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal, getWatchWorldContent } from '@dontstarve-web/signals';
import { DragonflyManager, type DragonflyRecord } from '../../prefab/src/dragonfly';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { createTestWorldSources } from './worldContentFixture';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const record: DragonflyRecord = { id: 'dragonfly-101512', transform: { position: [2, 0, 3], rotationY: .2 },
  components: { dragonfly: { playercombat: true, health: { health: 26000 }, inventory: { items: {}, equip: {} },
    moisture: { moisture: 12 }, rampingspawner: { current_wave: 2, wave_num: 3, spawning_on: false },
    knownlocations: { locations: [{ name: 'home', x: 4, y: 0, z: 5 }] },
    timer: { timers: { groundpound_cd: { timeleft: 5, paused: true, initial_time: 10 } } } } } };
const setup = () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const sources = createTestWorldSources(scheduler);
  const dragonflies = new DragonflyManager(scene, { scheduler, tickingarea: () => createMemo(() => awake.get()),
    getWatchWorldContent: (key, register) => getWatchWorldContent(key, register, sources) });
  return { scene, scheduler, awake, dragonflies };
};
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads the saved dragonfly through fn then OnLoad and keeps the Lua looping idle declaration', async () => {
  const { scheduler, dragonflies } = setup();
  try {
    const model = dragonflies.spawn(new THREE.Vector3(...record.transform.position), record);
    await model.userData.display.artLoaded();
    const instance = prefabInstance(model)!;
    expect(instance.sprite.sprite.peek()).toMatchObject({ clip: { name: 'idle', loop: true }, queue: [] });
    expect(instance.listTags()).toEqual(expect.arrayContaining(['epic', 'noepicmusic', 'monster', 'hostile', 'dragonfly',
      'scarytoprey', 'largecreature', 'flying', 'ignorewalkableplatformdrowning']));
    expect(dragonflies.exportRecords()[0].record).toEqual(record);
    expect(PREFAB_DEFINITIONS.dragonflies.parseComponents(record.components, 'dragonfly', { grounded: true } as never))
      .toEqual(record.components);
  } finally { dragonflies.dispose(); scheduler.dispose(); }
});

it('rebuilds the declared idle clip after the tile sleeps', async () => {
  const { scene, scheduler, awake, dragonflies } = setup();
  try {
    const model = dragonflies.spawn(new THREE.Vector3(...record.transform.position), record);
    await model.userData.display.artLoaded();
    const instance = prefabInstance(model)!;
    awake.set(false); await settle();
    expect(instance.status.peek()).toBe('asleep');
    expect(instance.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true); await settle();
    expect(model.parent).toBe(scene);
    expect(instance.sprite.currentAnimation).toBe('idle');
    expect(instance.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: true });
  } finally { dragonflies.dispose(); scheduler.dispose(); }
});
