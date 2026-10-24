import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSanityState } from '../../signals/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Sanity } from '../../componets/src/sanity';
import { NightmareRockManager } from '../../prefab/src/nightmarerock';

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
    (await manager.spawn(id, new THREE.Vector3(0, 0, 0))).userData.nightmareRock as {
      sg: { stateName: string }; active: boolean; body: CANNON.Body };
  return { manager, current, player, fx, run, rock, physics };
}

describe('nightmare rocks', () => {
  it('a sanityrock rises for a sane player within 30 units, blocks them, and lowers once they leave', async () => {
    const { manager, player, fx, run, rock, physics } = await setup();
    const obelisk = await rock('sanityrock');
    expect(physics.bodies).toContain(obelisk.body);
    run(2);
    expect(obelisk.sg.stateName).toBe('idle');
    expect(obelisk.body.collisionResponse).toBe(false);

    player.position.set(20, 0, 0);
    run(2);
    expect(fx.spawn).toHaveBeenCalledWith('sanity_raise', expect.anything());
    expect(obelisk.active).toBe(true);
    expect(obelisk.body.collisionResponse).toBe(true);
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
    expect(obelisk.body.collisionResponse).toBe(false);
    manager.dispose();
    expect(physics.bodies).not.toContain(obelisk.body);
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
