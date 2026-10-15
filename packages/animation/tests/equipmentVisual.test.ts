import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AnimState } from '../src/animState';
import { smallHash, type AnimElement } from '../src/animationAssets';
import { ItemEntity } from '../../inventory/src';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createHandEquipmentLifecycle } from '../../prefab/src/handEquipment';
import { HatEquipmentAssets, prepareHatVisual } from '../../prefab/src/hats';
import { prepareBackpackVisual } from '../../prefab/src/backpack';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const element = (symbol: string, layer = symbol) => ({ imageHash: smallHash(symbol), layerHash: smallHash(layer), imageIndex: 0 } as AnimElement);

it('applies prefab skin overrides, cancels a pending unequipped skin and keeps invisible held symbols hidden', async () => {
  const assets = new GroundItemAssets();
  const anim = new AnimState(() => {});
  const owner = { AnimState: anim, PushEvent: vi.fn() };
  const context = { assets, AnimState: anim, lightParent: new THREE.Group() };
  const item = new ItemEntity({ itemId: 'hammer', count: 1, skinId: 'hammer_invisible' });
  const next = new ItemEntity({ itemId: 'hammer', count: 1 });
  const archive = GROUND_ITEM_DEFINITIONS.hammer.skinArchives.hammer_invisible;
  const skin = await assets.loadBuild(archive);
  const loadBuild = assets.loadBuild.bind(assets);
  let resolve!: (source: typeof skin) => void;
  const pending = new Promise<typeof skin>(done => { resolve = done; });
  vi.spyOn(assets, 'loadBuild').mockImplementation(path => path === archive ? pending : loadBuild(path));
  const stale = createHandEquipmentLifecycle(item, context);
  const current = createHandEquipmentLifecycle(next, context);
  let invisible: ReturnType<typeof createHandEquipmentLifecycle> | undefined;
  try {
    stale.onequip(owner);
    const staleReady = stale.ready;
    stale.onunequip();
    current.onequip(owner); await current.ready;
    const anchor = element('swap_object');
    const visible = anim.ResolveSymbol(anchor);
    expect(visible?.[0].materials[0].name).toBe('ground:swap_hammer');
    resolve(skin); await staleReady;
    expect(anim.ResolveSymbol(anchor)).toEqual(visible);
    expect(owner.PushEvent).not.toHaveBeenCalledWith('equipskinneditem', item.skinId);
    current.onunequip();
    expect(anim.IsVisible(element('arm', 'ARM_carry'))).toBe(false);
    expect(anim.IsVisible(element('arm', 'ARM_normal'))).toBe(true);
    invisible = createHandEquipmentLifecycle(item, context);
    const override = vi.spyOn(anim, 'OverrideItemSkinSymbol');
    invisible.onequip(owner); await invisible.ready;
    expect(override.mock.calls[0][3]).toBe(item.id);
    expect(anim.ResolveSymbol(anchor)).toEqual([]);
    expect(anim.IsVisible(element('arm', 'ARM_carry'))).toBe(true);
    const equippedSkin = item.skinId;
    item.skinId = undefined; // The same inst can be reskinned before the old equip lifetime is released.
    invisible.onunequip();
    expect(owner.PushEvent).toHaveBeenLastCalledWith('unequipskinneditem', equippedSkin);
    anim.ClearOverrideSymbol('swap_object');
    expect(anim.ResolveSymbol(anchor)).toBeUndefined();
  } finally {
    stale.onunequip(); current.onunequip(); invisible?.onunequip();
    item.destroy(); next.destroy(); assets.dispose();
  }
});

it('lets the hat prefab change source visibility groups and clear its own overrides while preserving the backpack', async () => {
  const assets = new GroundItemAssets();
  const hats = new HatEquipmentAssets('/dst/data/anim');
  const anim = new AnimState(() => {});
  const owner = { AnimState: anim, PushEvent() {} };
  const parent = new THREE.Group();
  const backpack = await prepareBackpackVisual(assets, { id: 'backpack', prefab: 'backpack' });
  backpack.onequip(owner);
  const back = anim.ResolveSymbol(element('swap_body'));
  expect(back).toHaveLength(1);
  try {
    for (const [prefab, head, hair, face] of [
      ['strawhat', false, false, true], ['eyebrellahat', true, true, true], ['pumpkinhat', false, false, false],
    ] as const) {
      const hat = await prepareHatVisual(hats, { id: prefab, prefab }, parent);
      hat.onequip(owner);
      expect(anim.IsVisible(element('headbase')), prefab).toBe(head);
      expect(anim.IsVisible(element('hair')), prefab).toBe(hair);
      expect(anim.IsVisible(element('face')), prefab).toBe(face);
      expect(anim.ResolveSymbol(element(prefab === 'pumpkinhat' ? 'headbase_hat' : 'swap_hat')), prefab).toHaveLength(1);
      hat.onunequip();
      expect(anim.IsVisible(element('headbase'))).toBe(true);
      expect(anim.IsVisible(element('hair'))).toBe(true);
      expect(anim.IsVisible(element('face'))).toBe(true);
      expect(anim.ResolveSymbol(element('swap_hat'))).toBeUndefined();
      expect(anim.ResolveSymbol(element('headbase_hat'))).toBeUndefined();
      expect(anim.ResolveSymbol(element('swap_body'))).toEqual(back);
    }
    backpack.onunequip();
    expect(anim.ResolveSymbol(element('swap_body'))).toBeUndefined();
  } finally { backpack.onunequip(); assets.dispose(); hats.dispose(); }
});
