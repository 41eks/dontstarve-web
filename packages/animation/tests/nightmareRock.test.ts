import { prefabInstance } from '../../prefab/src/prefabInstance';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSanityState } from '../../signals/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Sanity } from '../../componets/src/sanity';
import { NightmareRockManager, type NightmareRockInstance } from '../../prefab/src/nightmarerock';
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
  const current = createSanityState(200, 200);
  const sanity = new Sanity({ components: { inventory: { GetEquippedItem: () => null } }, hasTag: () => false } as never, current);
  const player = { position: new THREE.Vector3(100, 0, 0), sanity };
  const fx = { prepare: vi.fn(async () => undefined), spawn: vi.fn() };
  const manager = new NightmareRockManager(new THREE.Scene(), '/dst/data/anim', { scheduler, physics, fx, getPlayers: () => [player] });
  const run = (seconds: number) => {
    for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 30) { scheduler.advance(1 / 30); manager.update(1 / 30, new THREE.Quaternion()); }
  };
  const rock = async (id: 'sanityrock' | 'insanityrock') =>
    prefabInstance(manager.spawn(id, new THREE.Vector3(0, 0, 0))) as NightmareRockInstance;
  return { manager, current, player, fx, run, rock, physics };
}

describe('nightmare rocks', () => {
  it('owns its state and pending tasks on the instance, and removing one rock preserves its neighbour and shared art', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(.5);
    const scheduler = new GameTimeScheduler(), physics = new CANNON.World(), scene = new THREE.Scene();
    const player = { position: new THREE.Vector3(), sanity: { IsSane: () => true, IsInsane: () => false } };
    const fx = { spawn: vi.fn() };
    const manager = new NightmareRockManager(scene, '/dst/data/anim', { scheduler, physics, fx, getPlayers: () => [player] });
    try {
      const first = manager.spawn('sanityrock', new THREE.Vector3());
      const second = manager.spawn('sanityrock', new THREE.Vector3(6, 0, 0));
      const instance = prefabInstance(first) as NightmareRockInstance;
      const neighbour = prefabInstance(second) as NightmareRockInstance;
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
      expect(first.parent).toBeNull();
      expect(physics.bodies).toHaveLength(1);
      expect(manager.exportRecords().map(({ record }) => record.id)).toEqual([neighbour.entityId]);
      await neighbourDisplay.artLoaded();
      scheduler.advance(.6);
      expect(fx.spawn).toHaveBeenCalledOnce();
      expect(fx.spawn).toHaveBeenCalledWith('sanity_raise', neighbour.position);
      expect(neighbour.active).toBe(true);
      expect(neighbour.sprite.loaded).toBe(true);
      manager.dispose();
      scheduler.advance(10);
      expect(fx.spawn).toHaveBeenCalledOnce();
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
    expect(fx.spawn).toHaveBeenCalledWith('sanity_raise', expect.anything());
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
    expect(fx.spawn).toHaveBeenCalledWith('sanity_lower', expect.anything());
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

    current.set(0.14 * 200);
    await Promise.resolve();
    expect(player.sanity.IsInsane()).toBe(true);
    run(2);
    expect(obelisk.active).toBe(true);

    // 32/200 is above the 30/200 insane threshold but below 35/200: still insane.
    current.set(32);
    await Promise.resolve();
    expect(player.sanity.IsInsane()).toBe(true);
    current.set(36);
    await Promise.resolve();
    expect(player.sanity.IsSane()).toBe(true);
    run(3);
    expect(obelisk.active).toBe(false);
    manager.dispose();
  });
});
