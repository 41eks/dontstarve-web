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

/** Land at x < 10, ocean from 10 on. */
const map = {
  isPassableAtPoint: (point: ReadonlyVector3, allowWater: boolean) => point.x < 10 || allowWater,
  isOceanAtPoint: (point: ReadonlyVector3) => point.x >= 10,
};

function setup() {
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  const inventory = createPickupInventory();
  const fx = { spawn: vi.fn() };
  const world = new ItemWorldFixture(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    undefined,
    '/dst/data/databundles/images.zip',
    inventory,
    '/dst/data/anim',
    withEntity(new THREE.Group(), 'wilson'),
    // butterflyWorld … physics: unused here, but for the splash's fx.
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    fx,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    map,
  );
  const spawn = (itemId: 'log' | 'axe', x: number) =>
    world.spawnGroundItem({ ...SAVE_CATALOG.items[itemId], itemId, count: 1 }, new THREE.Vector3(x, 0, 0));
  return { world, inventory, fx, spawn };
}

/** The float_fx ripples on an item, beside its other effects (a log's fire). */
const ripples = (item: { readonly sprite: { readonly fx: { peek(): ReadonlyMap<string, unknown> } } }) =>
  [...item.sprite.fx.peek().keys()].filter(key => key.startsWith('float_fx_')).sort();

describe('floater', () => {
  it('floats an item that lands in the ocean, with its ripples, until it is picked up', () => {
    const { world, inventory, fx, spawn } = setup();
    try {
      const ashore = spawn('log', 0);
      const afloat = spawn('log', 15);
      const events = vi.fn();
      afloat.ListenForEvent('floater_startfloating', () => events('start'));
      afloat.ListenForEvent('floater_stopfloating', () => events('stop'));
      world.update(1 / 30);

      expect(ashore.components.floater?.IsFloating()).toBe(false);
      expect(ripples(ashore)).toEqual([]);
      expect(ashore.GetIsWet()).toBe(false);
      // log.lua MakeInventoryFloatable(inst, "med", 0.1, 0.75).
      const floater = afloat.components.floater!;
      expect([floater.size, floater.vert_offset, floater.xscale]).toEqual(['med', 0.1, 0.75]);
      expect(floater.IsFloating()).toBe(true);
      expect(events.mock.calls).toEqual([['start']]);
      // TUNING.OCEAN_WETNESS soaks it, and it splashes where it lands.
      expect(afloat.GetIsWet()).toBe(true);
      expect(fx.spawn).toHaveBeenCalledTimes(1);
      expect(fx.spawn).toHaveBeenCalledWith('splash', afloat.position);
      expect(ripples(afloat)).toEqual(['float_fx_back', 'float_fx_front']);
      const front = afloat.sprite.fx.peek().get('float_fx_front')!.sprite.sprite.peek();
      expect(front.clip.name).toBe('idle_front_med');
      // float_fx.lua SetOceanBlendParams(EFFECT_TINT_AMOUNT); OnLandedClient's SetFloatParams(-0.05, 1.0, bob_percent).
      expect(front.oceanShading).toEqual({ float: [0, 0, 0], blend: 0.6 });
      expect(afloat.sprite.sprite.peek().oceanShading).toEqual({ float: [-0.05, 1, 1], blend: 0 });
      expect(ashore.sprite.sprite.peek().oceanShading).toBeUndefined();

      // Taken out of the ocean, it no longer floats and its ripples go.
      expect(inventory.GiveItem(afloat)).toBe(true);
      expect(floater.IsFloating()).toBe(false);
      expect(events.mock.calls).toEqual([['start'], ['stop']]);
      expect(ripples(afloat)).toEqual([]);
      // OnNoLongerLandedClient's SetFloatParams(0, 0, 0).
      expect(afloat.sprite.sprite.peek().oceanShading).toBeUndefined();
    } finally {
      world.dispose();
    }
  });

  it('draws a floating tool as its floating_item frame with its swap symbol, and restores its art', () => {
    const { world, inventory, spawn } = setup();
    try {
      const axe = spawn('axe', 15);
      world.update(1 / 30);
      // axe.lua MakeInventoryFloatable(inst, "small", 0.05, {1.2, 0.75, 1.2}, true, -11, floater_swap_data).
      const json = () => axe.sprite.sprite.peek();
      expect(json().source?.bank).toBe('floating_item');
      expect(json().clip.name).toBe('left');
      expect(json().frame).toBe(11);
      expect(json().paused).toBe(true);
      expect(json().appearance.get('archive-symbol:swap_spear')).toMatchObject({
        archive: 'swap_axe.zip',
        sourceSymbol: 'swap_axe',
      });

      expect(inventory.GiveItem(axe)).toBe(true);
      expect(json().source?.bank).toBe('axe');
      expect(json().clip.name).toBe('idle');
      expect(json().paused).toBe(false);
      expect(json().appearance.get('archive-symbol:swap_spear')).toMatchObject({ archive: undefined });
    } finally {
      world.dispose();
    }
  });
});
