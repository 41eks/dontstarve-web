import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPickupInventory } from './pickupFixture';
import { withEntity } from './entityFixture';
import { ItemWorldFixture } from './itemWorldFixture';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import type { ReadonlyVector3 } from '../src/transformRoot';

vi.mock('@dontstarve-web/animation/imageAtlas', () => ({
  loadImageAtlas: async () => ({
    require: () => ({ width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]) }),
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Land at x < 10, ocean from 10 to 20, and off the map beyond. */
const map = {
  isPassableAtPoint: (point: ReadonlyVector3, allowWater: boolean) => point.x < 10 || (allowWater && point.x < 20),
  isOceanAtPoint: (point: ReadonlyVector3) => point.x >= 10 && point.x < 20,
};

function setup() {
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  const inventory = createPickupInventory();
  const world = new ItemWorldFixture(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    undefined,
    '/dst/data/databundles/images.zip',
    inventory,
    '/dst/data/anim',
    withEntity(new THREE.Group(), 'wilson'),
    // butterflyWorld … physics: unused here.
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    map,
  );
  const spawn = (itemId: 'log' | 'rocks', x: number, fling = false) =>
    world.spawnGroundItem({ ...SAVE_CATALOG.items[itemId], itemId, count: 1 }, new THREE.Vector3(x, 0, 0), { fling });
  return { world, inventory, spawn };
}

describe('inventoryitem landing and sinks', () => {
  it('lands each item once, then sinks what the ground under it cannot hold', () => {
    const { world, spawn } = setup();
    try {
      const landLog = spawn('log', 0);
      const oceanLog = spawn('log', 15);
      const landRocks = spawn('rocks', 0);
      const oceanRocks = spawn('rocks', 15);
      const voidLog = spawn('log', 25);
      const landed = vi.fn();
      oceanLog.ListenForEvent('on_landed', landed);
      expect(oceanRocks.components.inventoryitem.sinks).toBe(true);
      expect(oceanLog.components.inventoryitem.sinks).toBe(false);

      // The first frame's poll lands them; SinkEntity waits for DoTaskInTime(0).
      world.update(1 / 30);
      expect(landed).toHaveBeenCalledTimes(1);
      expect(oceanRocks.components.inventoryitem.isLanded).toBe(true);
      expect(oceanRocks.isRemoved).toBe(false);

      world.update(1 / 30);
      expect(oceanRocks.isRemoved).toBe(true);
      expect(voidLog.isRemoved).toBe(true);
      // The ocean holds an item that does not sink; land holds both.
      expect([landLog, oceanLog, landRocks].map(item => item.isRemoved)).toEqual([false, false, false]);
      world.update(1 / 30);
      expect(landed).toHaveBeenCalledTimes(1);

      // SetSinks on an item already landed in the ocean sinks it at once.
      oceanLog.components.inventoryitem.SetSinks(true);
      world.update(1 / 30);
      expect(oceanLog.isRemoved).toBe(true);
    } finally {
      world.dispose();
    }
  });

  it('lands a flung item where its flight ends, and never sinks a held one', () => {
    const { world, inventory, spawn } = setup();
    try {
      const flung = spawn('rocks', 15, true);
      expect(flung.components.inventoryphysics?.flying).toBe(true);
      world.update(1 / 30);
      expect(flung.components.inventoryitem.isLanded).toBe(false);
      for (let frame = 0; frame < 120 && flung.components.inventoryphysics?.flying; frame++) {
        world.update(1 / 30);
      }
      world.update(1 / 30);
      world.update(1 / 30);
      expect(flung.isRemoved).toBe(true);

      // Picked up before its landing poll: held, it takes off and is not sunk.
      const held = spawn('rocks', 15);
      expect(inventory.GiveItem(held)).toBe(true);
      world.update(1 / 30);
      world.update(1 / 30);
      expect(held.isRemoved).toBe(false);
      expect(held.components.inventoryitem.isLanded).toBe(false);
    } finally {
      world.dispose();
    }
  });
});
