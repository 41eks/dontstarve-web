import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { InventoryStore, InventorySlot, HeadSlot, BodySlot, equipmentSlotAddress, inventorySlotAddress } from '@dontstarve-web/inventory';
import { INVENTORY_ITEM_SPECS } from '../../../src/inventoryItems';
import { bindPlayerEquipment } from './playerEquipFixture';
import { wilsonPlayerInstance, createWilsonPlayer, type WilsonAnimationController } from './playerVisual';
import { resolveAnimState, resolveAnimStateSymbol } from '../src/animState';
import { declaredAnimState, element } from './animStateFixture';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('equips through equippable onequip/onunequip after restore/transfer and releases head/body art independently', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
  const head = equipmentSlotAddress('head'), body = equipmentSlotAddress('body'), bag = inventorySlotAddress(0);
  const store = new InventoryStore([
    { address: head, slot: new HeadSlot() }, { address: body, slot: new BodySlot() }, { address: bag, slot: new InventorySlot() },
  ], { strawhat: INVENTORY_ITEM_SPECS.strawhat, backpack: INVENTORY_ITEM_SPECS.backpack });
  // inventory:Equip calls equippable:Equip with the player, whose view gives each item its slot of the sprite.
  bindPlayerEquipment(store, animation);
  // What the player's display draws for the symbol: it loads the named builds itself.
  const sprite = wilsonPlayerInstance(player).sprite;
  const symbol = (name: string) => resolveAnimStateSymbol(resolveAnimState(declaredAnimState(sprite).json.peek(), animation.equipmentAssets).state, element(name), 0);
  // Equipping declares a slot on the player's sprite, so an unchanged appearance means nothing was equipped again.
  const appearance = () => sprite.sprite.peek().appearance;
  try {
    store.replaceState({ slots: [
      { address: head, item: { itemId: 'strawhat', count: 1 } }, { address: body, item: { itemId: 'backpack', count: 1 } },
    ], bufferedBuilds: [] }, {});
    await vi.waitFor(() => { expect(symbol('swap_hat')).toHaveLength(1); expect(symbol('swap_body')).toHaveLength(1); });
    const back = symbol('swap_body'), backpack = store.getEntity(body)!;
    const declared = appearance();
    backpack.components.inventoryitem.owner!.changed();
    expect(appearance()).toBe(declared);
    expect(store.transfer(body, bag, 1)).toBe(true);
    expect(symbol('swap_body')).toBeUndefined();
    expect(store.getEntity(bag)).toBe(backpack);
    expect(store.transfer(bag, body, 1)).toBe(true);
    await vi.waitFor(() => expect(symbol('swap_body')).toEqual(back));
    store.getEntity(head)!.remove();
    expect(symbol('swap_hat')).toBeUndefined();
    expect(symbol('swap_body')).toEqual(back);
    // Taking the backpack off leaves nothing on the player's body.
    expect(store.transfer(body, bag, 1)).toBe(true);
    expect(symbol('swap_body')).toBeUndefined();
  } finally { store.dispose(); player.removeFromParent(); }
});
