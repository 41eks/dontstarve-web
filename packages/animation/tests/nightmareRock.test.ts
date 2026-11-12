import { prefabInstance } from '../../prefab/src/prefabInstance';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Sanity } from '../../componets/src/sanity';
import type { NightmareRockInstance } from '../../prefab/src/nightmarerock';
import { nightmareRockWorld } from './nightmareRockFixture';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { EntityRegistry } from '../../../src/entityRegistry';
import { executeDebugCommand } from '../../../src/debugCommands';
import { createInventoryStore } from '../../../src/inventory';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { prefabDisplay } from '@dontstarve-web/display';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const bytes = await readFile(new URL(`../../../public${url}`, import.meta.url));
    return new Response(bytes);
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup() {
  const scheduler = new GameTimeScheduler();
  const physics = new CANNON.World();
  const sanity = new Sanity({ components: { inventory: { GetEquippedItem: () => null } }, hasTag: () => false } as never, 200);
  const current = sanity;
  const player = { position: new THREE.Vector3(100, 0, 0), sanity };
  const manager = nightmareRockWorld(new THREE.Scene(), { scheduler, getPlayers: () => [player] }, { physics });
  const fx = manager.spawnPrefab;
  const run = (seconds: number) => {
    for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 30) { scheduler.advance(1 / 30); manager.update(1 / 30); }
  };
  const rock = async (id: 'sanityrock' | 'insanityrock') => manager.spawn(id, new THREE.Vector3(0, 0, 0));
  return { manager, current, player, fx, run, rock, physics };
}

describe('nightmare rocks', () => {
  it('owns its state and pending tasks on the instance, and removing one rock preserves its neighbour and shared art', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(.5);
    const scheduler = new GameTimeScheduler(), physics = new CANNON.World(), scene = new THREE.Scene();
    const player = { position: new THREE.Vector3(), sanity: { IsSane: () => true, IsInsane: () => false } };
    const manager = nightmareRockWorld(scene, { scheduler, getPlayers: () => [player] }, { physics });
    const fx = manager.spawnPrefab;
    try {
      const instance = manager.spawn('sanityrock', new THREE.Vector3());
      const neighbour = manager.spawn('sanityrock', new THREE.Vector3(6, 0, 0));
      const first = instance.transform.model, second = neighbour.transform.model;
      expect(prefabInstance(first)).toBe(instance);
      const neighbourDisplay = prefabDisplay(second)!;
      scheduler.advance(0);
      expect(instance.sg.context).toBe(instance);
      expect(instance.active_queue).toBe(true);
      expect(instance.active).toBe(false);
      for (const model of [first, second]) {
        for (const key of ['nightmareRock', 'removed', 'components', 'display', 'animationController', 'actionEntity']) {
          expect(Object.hasOwn(model.userData, key), key).toBe(false);
        }
      }
      instance.remove();
      // The display releases the removed rock's model when its status effect runs.
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(first.parent).toBeNull();
      expect(physics.bodies).toHaveLength(1);
      expect(manager.exportRecords().map(({ record }) => record.id)).toEqual([neighbour.entityId]);
      await neighbourDisplay.artLoaded();
      scheduler.advance(.6);
      // SpawnPrefab("sanity_raise").Transform:SetPosition(inst.Transform:GetWorldPosition())
      expect(fx).toHaveBeenCalledOnce();
      expect(fx).toHaveBeenCalledWith('sanity_raise', neighbour.position);
      expect(fx.mock.results[0].value.position.toArray()).toEqual(neighbour.position.toArray());
      expect(neighbour.active).toBe(true);
      expect(neighbour.sprite.loaded).toBe(true);
      manager.dispose();
      scheduler.advance(10);
      expect(fx).toHaveBeenCalledOnce();
      expect(physics.bodies).toEqual([]);
      expect(scene.children).toEqual([]);
    } finally { manager.dispose(); scheduler.dispose(); }
  });

  it('a sanityrock rises for a sane player within 30 units, blocks them, and lowers once they leave', async () => {
    const { manager, player, fx, run, rock, physics } = await setup();
    const obelisk = await rock('sanityrock');
    await new Promise(resolve => setTimeout(resolve, 0));
    const body = obelisk.physicsBody!;
    expect(physics.bodies).toContain(body);
    run(2);
    expect(obelisk.sg.stateName).toBe('idle');
    expect(body.collisionResponse).toBe(false);

    player.position.set(20, 0, 0);
    run(2);
    expect(fx).toHaveBeenCalledWith('sanity_raise', expect.anything());
    expect(obelisk.active).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(body.collisionResponse).toBe(true);
    run(3);
    expect(obelisk.sg.stateName).toBe('idle');

    // Hysteresis: a raised rock holds until FAR_DIST (33 units).
    player.position.set(31, 0, 0);
    run(3);
    expect(obelisk.active).toBe(true);
    player.position.set(40, 0, 0);
    run(3);
    expect(fx).toHaveBeenCalledWith('sanity_lower', expect.anything());
    expect(obelisk.active).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(body.collisionResponse).toBe(false);
    manager.dispose();
    expect(physics.bodies).not.toContain(body);
  });

  it('an insanityrock only rises once the nearby player becomes insane, with sane/insane hysteresis', async () => {
    const { manager, current, player, run, rock } = await setup();
    const obelisk = await rock('insanityrock');
    player.position.set(20, 0, 0);
    run(2);
    expect(obelisk.active).toBe(false);

    current.SetCurrent(0.14 * 200);
    await Promise.resolve();
    expect(player.sanity.IsInsane()).toBe(true);
    run(2);
    expect(obelisk.active).toBe(true);

    // 32/200 is above the 30/200 insane threshold but below 35/200: still insane.
    current.SetCurrent(32);
    await Promise.resolve();
    expect(player.sanity.IsInsane()).toBe(true);
    current.SetCurrent(36);
    await Promise.resolve();
    expect(player.sanity.IsSane()).toBe(true);
    run(3);
    expect(obelisk.active).toBe(false);
    manager.dispose();
  });

  it('c_spawn then c_save exports both rocks by identity and position, and the reloaded rocks derive their state again', async () => {
    vi.stubGlobal('window', new EventTarget());
    const world = (position: THREE.Vector3) => {
      const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), physics = new CANNON.World(), inventory = createInventoryStore([]);
      const player = { position, sanity: { IsSane: () => true, IsInsane: () => false } };
      const rocks = nightmareRockWorld(scene, { scheduler, getPlayers: () => [player] }, { physics });
      const registry = new EntityRegistry([], rocks.prefabs, () => position);
      registry.registerPrefabs(PREFAB_DEFINITIONS.nightmareRocks);
      const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
      const save = () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
        playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
      return { scene, scheduler, physics, inventory, registry, save,
        dispose: () => { registry.dispose(); rocks.dispose(); inventory.dispose(); scheduler.dispose(); } };
    };
    const first = world(new THREE.Vector3(9, 0, -3));
    let json = '';
    try {
      expect((await executeDebugCommand('c_spawn("sanityrock");c_spawn("insanityrock")', first.inventory,
        prefab => first.registry.spawn(prefab))).ok).toBe(true);
      expect(first.scene.children).toHaveLength(2);
      expect((await executeDebugCommand('c_save()', first.inventory, undefined, () => { json = first.save(); })).ok).toBe(true);
    } finally { first.dispose(); }
    const entities = deserializeSave(json, SAVE_CATALOG).world.entities;
    for (const id of ['sanityrock', 'insanityrock'] as const) {
      expect(entities[id]).toEqual([{ id: expect.any(String), transform: { position: [9, 0, -3], rotationY: 0 }, components: {} }]);
    }

    // The state is not saved: a sane player standing on the reloaded rocks raises only the sanityrock.
    const second = world(new THREE.Vector3(9, 0, -3));
    try {
      await second.registry.restoreAll({ sanityrock: entities.sanityrock, insanityrock: entities.insanityrock });
      const [sane, insane] = ['sanityrock', 'insanityrock'].map(id =>
        second.scene.children.map(model => prefabInstance(model) as NightmareRockInstance).find(rock => rock.prefab === id)!);
      expect(sane.entityId).toBe(entities.sanityrock![0].id);
      expect(insane.entityId).toBe(entities.insanityrock![0].id);
      expect(sane.position.toArray()).toEqual([9, 0, -3]);
      expect(second.physics.bodies).toHaveLength(2);
      second.scheduler.advance(2);
      expect(sane.active).toBe(true);
      expect(insane.active).toBe(false);
      expect(second.registry.exportRecords()).toMatchObject({ sanityrock: entities.sanityrock, insanityrock: entities.insanityrock });
    } finally { second.dispose(); }
  });
});

it('ends its clips on game time while its art never loads', async () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  const scheduler = new GameTimeScheduler();
  const manager = nightmareRockWorld(new THREE.Scene(), { scheduler, getPlayers: () => [] }, { physics: new CANNON.World() });
  const rock = manager.spawn('sanityrock', new THREE.Vector3());
  try {
    // lower is 37 frames; its animover returns SGnightmarerock to idle.
    rock.sg.goToState('lower');
    scheduler.advance(36.5 / 30);
    expect(rock.sg.stateName).toBe('lower');
    scheduler.advance(1 / 30);
    expect(rock.sg.stateName).toBe('idle');
    expect(rock.sprite.loaded).toBe(false);
  } finally { manager.dispose(); scheduler.dispose(); }
});
