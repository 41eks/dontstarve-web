import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPickupInventory } from '../../../tests/fixtures/pickupFixture';
import { withEntity } from '../../../tests/fixtures/entityFixture';
import { ItemWorldFixture } from '../../../tests/fixtures/itemWorldFixture';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { createMemo, createSignal, type TileStateQuery } from '../../signals/src';
import { prefabDisplay } from '../src';

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

function setup(tickingarea?: TileStateQuery) {
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
    tickingarea,
    undefined,
    map,
  );
  const spawn = (itemId: 'log' | 'axe', x: number) =>
    world.spawnGroundItem({ ...SAVE_CATALOG.items[itemId], itemId, count: 1 }, new THREE.Vector3(x, 0, 0));
  return { world, inventory, fx, spawn };
}

/** The float_fx ripples on an item, beside its other effects (a log's fire). */
const ripples = (item: { readonly sprite: { readonly fx: { readonly value: ReadonlyMap<string, unknown> } } }) =>
  [...item.sprite.fx.value.keys()].filter(key => key.startsWith('float_fx_')).sort();

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
      const front = afloat.sprite.fx.value.get('float_fx_front')!.sprite.sprite.value;
      expect(front.clip.name).toBe('idle_front_med');
      // float_fx.lua SetOceanBlendParams(EFFECT_TINT_AMOUNT); OnLandedClient's SetFloatParams(-0.05, 1.0, bob_percent).
      expect(front.oceanShading).toEqual({ float: [0, 0, 0], blend: 0.6 });
      expect(afloat.sprite.sprite.value.oceanShading).toEqual({ float: [-0.05, 1, 1], blend: 0 });
      expect(ashore.sprite.sprite.value.oceanShading).toBeUndefined();

      // Taken out of the ocean, it no longer floats and its ripples go.
      expect(inventory.GiveItem(afloat)).toBe(true);
      expect(floater.IsFloating()).toBe(false);
      expect(events.mock.calls).toEqual([['start'], ['stop']]);
      expect(ripples(afloat)).toEqual([]);
      // OnNoLongerLandedClient's SetFloatParams(0, 0, 0).
      expect(afloat.sprite.sprite.value.oceanShading).toBeUndefined();
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
      const json = () => axe.sprite.sprite.value;
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

  it('floats the loose static art its source prefab floats, as a shadowheart in a cove', () => {
    const { world, fx } = setup();
    try {
      const shadowhearts = [0, 15].map(x => world.prefabs.spawn('shadowheart', new THREE.Vector3(x, 0, 0)));
      world.update(1 / 30);
      const [ashore, afloat] = shadowhearts;
      // shadowheart.lua MakeInventoryFloatable(inst, "small", 0.05, 0.8).
      const floater = afloat.components.floater!;
      expect([floater.size, floater.vert_offset, floater.xscale]).toEqual(['small', 0.05, 0.8]);
      expect([ashore.components.floater?.IsFloating(), floater.IsFloating()]).toEqual([false, true]);
      expect(ripples(afloat)).toEqual(['float_fx_back', 'float_fx_front']);
      expect(afloat.sprite.sprite.value.oceanShading).toEqual({ float: [-0.05, 1, 1], blend: 0 });
      expect(fx.spawn).toHaveBeenCalledWith('splash', afloat.position);
      expect(afloat.isRemoved).toBe(false);
    } finally {
      world.dispose();
    }
  });

  it('rebuilds a floating tool in its floating_item bank when its tile wakes again', async () => {
    const awake = createSignal(true);
    const { world, spawn } = setup(() => createMemo(() => awake.get()));
    try {
      const axe = spawn('axe', 15);
      const display = prefabDisplay(axe.transform.model)!;
      await display.artLoaded();
      world.update(1 / 30);
      await display.artLoaded();
      world.update(1 / 30);
      expect(axe.components.floater?.IsFloating()).toBe(true);
      const drawn = (display as unknown as { engine: { loaded: boolean; currentAnimation: string } }).engine;
      expect(drawn.currentAnimation).toBe('left');
      // Sleeping releases the sprite; the one built on wake starts in the bank the sprite json declares.
      awake.set(false);
      world.update(1 / 30);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(drawn.loaded).toBe(false);
      awake.set(true);
      world.update(1 / 30);
      await display.artLoaded();
      expect(drawn.loaded).toBe(true);
      expect(drawn.currentAnimation).toBe('left');
    } finally {
      world.dispose();
    }
  });
});
