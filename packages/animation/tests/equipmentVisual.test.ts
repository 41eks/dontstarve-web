import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AnimState } from '../src/animState';
import { ItemEntity } from '../../inventory/src';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createHandEquipmentLifecycle } from '../../prefab/src/handEquipment';
import { HatEquipmentAssets, hatVisual } from '../../prefab/src/hats';
import { backpackVisual } from '../../prefab/src/backpack';
import { wilsonPlayerInstance, createWilsonPlayer, type WilsonAnimationController } from './playerVisual';
import { declaredSymbol, element, overrideArchives } from './animStateFixture';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('names skin builds without loading them, replaces an unequipped skin and keeps invisible held symbols hidden', async () => {
  const assets = new GroundItemAssets();
  const load = vi.spyOn(assets, 'loadBuild');
  const anim = new AnimState(() => {});
  const owner = { AnimState: anim, PushEvent: vi.fn() };
  const context = { AnimState: anim, lightParent: new THREE.Group() };
  const item = new ItemEntity({ itemId: 'hammer', count: 1, skinId: 'hammer_invisible' });
  const next = new ItemEntity({ itemId: 'hammer', count: 1 });
  const archive = GROUND_ITEM_DEFINITIONS.hammer.skinArchives.hammer_invisible;
  const skinned = createHandEquipmentLifecycle(item, context);
  const plain = createHandEquipmentLifecycle(next, context);
  try {
    skinned.onequip(owner);
    // The prefab only names the builds; nothing is loaded until a display draws them.
    expect(overrideArchives(anim, 'swap_object')).toEqual([archive, 'swap_hammer.zip']);
    expect(load).not.toHaveBeenCalled();
    expect(owner.PushEvent).toHaveBeenCalledWith('equipskinneditem', item.skinId);
    skinned.onunequip();
    plain.onequip(owner);
    expect(overrideArchives(anim, 'swap_object')).toEqual(['swap_hammer.zip']);
    expect((await declaredSymbol(anim, assets, 'swap_object'))?.[0].materials[0].name).toBe('ground:swap_hammer');
    plain.onunequip();
    expect(anim.IsVisible(element('arm', 'ARM_carry'))).toBe(false);
    expect(anim.IsVisible(element('arm', 'ARM_normal'))).toBe(true);
    skinned.onequip(owner);
    expect(await declaredSymbol(anim, assets, 'swap_object')).toEqual([]);
    expect(anim.IsVisible(element('arm', 'ARM_carry'))).toBe(true);
    const equippedSkin = item.skinId;
    item.skinId = undefined; // The same inst can be reskinned before the old equip lifetime is released.
    skinned.onunequip();
    expect(owner.PushEvent).toHaveBeenLastCalledWith('unequipskinneditem', equippedSkin);
    anim.ClearOverrideSymbol('swap_object');
    expect(await declaredSymbol(anim, assets, 'swap_object')).toBeUndefined();
  } finally {
    skinned.onunequip(); plain.onunequip();
    item.destroy(); next.destroy(); assets.dispose();
  }
});

it('lets the hat prefab change source visibility groups and clear its own overrides while preserving the backpack', async () => {
  const assets = new GroundItemAssets();
  const context = { assets, hats: new HatEquipmentAssets('/dst/data/anim'), lightParent: new THREE.Group() };
  const anim = new AnimState(() => {});
  const owner = { AnimState: anim, PushEvent() {} };
  const backpack = backpackVisual({ id: 'backpack', prefab: 'backpack' });
  backpack.onequip(owner);
  const back = await declaredSymbol(anim, assets, 'swap_body');
  expect(back).toHaveLength(1);
  try {
    for (const [prefab, head, hair, face] of [
      ['strawhat', false, false, true], ['eyebrellahat', true, true, true], ['pumpkinhat', false, false, false],
    ] as const) {
      const hat = hatVisual({ id: prefab, prefab }, context);
      hat.onequip(owner);
      expect(anim.IsVisible(element('headbase')), prefab).toBe(head);
      expect(anim.IsVisible(element('hair')), prefab).toBe(hair);
      expect(anim.IsVisible(element('face')), prefab).toBe(face);
      expect(await declaredSymbol(anim, assets, prefab === 'pumpkinhat' ? 'headbase_hat' : 'swap_hat'), prefab).toHaveLength(1);
      hat.onunequip();
      expect(anim.IsVisible(element('headbase'))).toBe(true);
      expect(anim.IsVisible(element('hair'))).toBe(true);
      expect(anim.IsVisible(element('face'))).toBe(true);
      expect(await declaredSymbol(anim, assets, 'swap_hat')).toBeUndefined();
      expect(await declaredSymbol(anim, assets, 'headbase_hat')).toBeUndefined();
      expect(await declaredSymbol(anim, assets, 'swap_body')).toEqual(back);
    }
    backpack.onunequip();
    expect(await declaredSymbol(anim, assets, 'swap_body')).toBeUndefined();
  } finally { backpack.onunequip(); assets.dispose(); context.hats.dispose(); }
});

it("draws a follow hat's own animation from its bank once the owner's display has loaded it", async () => {
  const assets = new GroundItemAssets();
  const context = { assets, hats: new HatEquipmentAssets('/dst/data/anim'), lightParent: new THREE.Group() };
  const anim = new AnimState(() => {});
  const hat = hatVisual({ id: 'wagpunkhat', prefab: 'wagpunkhat' }, context);
  try {
    hat.onequip({ AnimState: anim, PushEvent() {} });
    expect(anim.json.peek().symbolAnimations.get(element('swap_hat').imageHash)).toMatchObject({ bank: 'hat_wagpunk.zip', animation: 'idle' });
    expect((await declaredSymbol(anim, assets, 'swap_hat'))!.length).toBeGreaterThan(0);
    hat.onunequip();
    expect(anim.json.peek().symbolAnimations.size).toBe(0);
  } finally { hat.onunequip(); assets.dispose(); context.hats.dispose(); }
});

it('lets a skin replaced before its load finishes only fill the cache: the player draws the current declaration', async () => {
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
  const mesh = player.getObjectByProperty('isMesh', true) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  const drawn = () => mesh.geometry.groups.map(group => mesh.material[group.materialIndex!].name);
  try {
    animation.setCarryItem('hammer', 'hammer_forge');
    animation.setCarryItem('hammer');
    await vi.waitFor(() => { animation.update(0); expect(drawn()).toContain('ground:swap_hammer'); });
    await animation.equipmentAssets.loadBuild(GROUND_ITEM_DEFINITIONS.hammer.skinArchives.hammer_forge);
    await new Promise(resolve => setTimeout(resolve, 0));
    animation.update(0);
    expect(drawn()).not.toContain('ground:hammer_forge');
    expect(drawn()).toContain('ground:swap_hammer');
  } finally { animation.setCarryItem(null); player.removeFromParent(); }
});
