import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { InventoryStore, InventorySlot, HeadSlot, BodySlot, equipmentSlotAddress, inventorySlotAddress } from '@dontstarve-web/inventory';
import { bindPlayerHeadEquipment } from '../../../src/playerHeadEquipment';
import { bindPlayerBodyEquipment } from '../../../src/playerBodyEquipment';
import { wilsonPlayerInstance, createWilsonPlayer, type WilsonAnimationController } from './playerVisual';
import { resolveAnimState, resolveAnimStateSymbol } from '../src/animState';
import { declaredAnimState, element } from './animStateFixture';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('equips through prefab lifecycles after restore/transfer and releases head/body presentation independently', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
  const head = equipmentSlotAddress('head'), body = equipmentSlotAddress('body'), bag = inventorySlotAddress(0);
  const store = new InventoryStore([
    { address: head, slot: new HeadSlot() }, { address: body, slot: new BodySlot() }, { address: bag, slot: new InventorySlot() },
  ], {
    strawhat: { name: 'hat', icon: 'strawhat.tex', maxStack: 1, equippable: 'head' },
    backpack: { name: 'backpack', icon: 'backpack.tex', maxStack: 1, equippable: 'body' },
  });
  const setBackpackActive = vi.fn();
  const headBinding = bindPlayerHeadEquipment({ headEquipmentExistenceState: store.headEquipmentExistenceState, animation });
  const bodyBinding = bindPlayerBodyEquipment({ bodyEquipmentExistenceState: store.bodyEquipmentExistenceState, animation, setBackpackActive });
  // What the player's display draws for the symbol: it loads the named builds itself.
  const sprite = wilsonPlayerInstance(player).sprite;
  const symbol = (name: string) => resolveAnimStateSymbol(resolveAnimState(declaredAnimState(sprite).json.peek(), animation.equipmentAssets).state, element(name), 0);
  // Equipping declares a slot on the player's sprite, so an unchanged appearance means nothing was equipped again.
  const appearance = () => sprite.sprite.peek().appearance;
  try {
    expect(setBackpackActive).not.toHaveBeenCalled();
    store.replaceState({ slots: [
      { address: head, item: { itemId: 'strawhat', count: 1 } }, { address: body, item: { itemId: 'backpack', count: 1 } },
    ], bufferedBuilds: [] }, {});
    await vi.waitFor(() => { expect(symbol('swap_hat')).toHaveLength(1); expect(symbol('swap_body')).toHaveLength(1); });
    expect(setBackpackActive).toHaveBeenCalledExactlyOnceWith(true, store.getEntity(body)!.id);
    const back = symbol('swap_body'), backpack = store.getEntity(body)!;
    const declared = appearance();
    backpack.components.inventoryitem.owner!.changed();
    expect(appearance()).toBe(declared);
    expect(store.transfer(body, bag, 1)).toBe(true);
    expect(symbol('swap_body')).toBeUndefined();
    expect(setBackpackActive).toHaveBeenLastCalledWith(false, undefined);
    expect(store.getEntity(bag)).toBe(backpack);
    expect(store.transfer(bag, body, 1)).toBe(true);
    await vi.waitFor(() => expect(symbol('swap_body')).toEqual(back));
    store.getEntity(head)!.remove();
    expect(symbol('swap_hat')).toBeUndefined();
    expect(symbol('swap_body')).toEqual(back);
    headBinding.dispose(); bodyBinding.dispose();
    expect(symbol('swap_body')).toBeUndefined();
    const released = appearance(); setBackpackActive.mockClear();
    store.transfer(body, bag, 1);
    store.applySlotChanges([{ slot: head, itemId: 'strawhat', delta: 1 }]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(appearance()).toBe(released);
    expect(setBackpackActive).not.toHaveBeenCalled();
  } finally { headBinding.dispose(); bodyBinding.dispose(); store.dispose(); player.removeFromParent(); }
});
