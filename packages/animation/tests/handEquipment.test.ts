import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InventoryStore, InventorySlot, HandSlot, inventorySlotAddress, equipmentSlotAddress } from '@dontstarve-web/inventory';
import { SpriteState } from '@dontstarve-web/display';
import type { EquipmentOwner } from '@dontstarve-web/signals';
import { getTorchController, TORCH_LIGHT } from '../../prefab/src/torch';
import { configureEquipmentEntity } from '../../prefab/src/handEquipment';
import { createEmptyEntity, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { createEquipmentViews } from '../../prefab/src/equipmentVisual';
import { GroundItemAssets } from '../../prefab/src/groundItems';
import { HatEquipmentAssets } from '../../prefab/src/hats';
import { createPerishWorld } from './perishWorldFixture';
import { createPlayerEquipper } from './playerEquipFixture';
import { advancePlayer, createWilsonPlayer, wilsonPlayerInstance, type WilsonAnimationController } from './playerVisual';

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })),
}));
beforeEach(() => vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** The lights other entities parent to `parent`. */
const parented = (parent: PrefabInstance) => [...parent.light.slots.peek().values()].map(light => light.peek());

it('equips restored and committed torches through equippable with the owner, unequipping before replacement', () => {
  const a = inventorySlotAddress(0), b = inventorySlotAddress(1), hand = equipmentSlotAddress('hand');
  const store = new InventoryStore([
    { address: a, slot: new InventorySlot() }, { address: b, slot: new InventorySlot() },
    { address: hand, slot: new HandSlot() },
  ], { torch: { name: 'torch', icon: 'torch.tex', maxStack: 1, maxFuel: 75, equippable: 'hand', configureEntity: configureEquipmentEntity } },
  { torch_barber: { itemId: 'torch', name: 'torch', icon: 'torch_barber.tex', atlas: 'images/inventoryimages.xml' } });
  const world = createPerishWorld();
  store.entities.bindPerishWorld(world);
  // The inventory's actor is the owner; its view gives each equipped inst a slot and AttachLightTo(owner).
  const lightParent = createEmptyEntity('wilson').instance, assets = new GroundItemAssets(), hats = new HatEquipmentAssets('/dst/data/anim');
  const events: string[] = [];
  const owner = { hasTag: () => false, GetPosition: () => ({ x: 0, y: 0, z: 0 }), PushEvent: (name: string) => { events.push(name); } } as EquipmentOwner & { hasTag(): boolean; GetPosition(): { x: number; y: number; z: number } };
  owner.OpenEquipmentView = createEquipmentViews(owner, { sprite: { sprite: new SpriteState({ name: 'idle' }), art: assets }, assets, hats, lightParent });
  store.bindActor(owner);
  try {
    store.replaceState({ slots: [
      { address: a, item: { itemId: 'torch', count: 1, remainingFuel: 20 } },
      { address: hand, item: { entityId: 'saved_torch', itemId: 'torch', count: 1, skinId: 'torch_barber', remainingFuel: 10 } },
    ], bufferedBuilds: [] }, {});
    const oldEntity = store.getEntity(hand)!, nextEntity = store.getEntity(a)!;
    expect(oldEntity.id).toBe('saved_torch');
    const oldTorch = getTorchController(oldEntity), nextTorch = getTorchController(nextEntity);
    expect(oldTorch.isBurning).toBe(true);
    expect(parented(lightParent)).toEqual([TORCH_LIGHT]);
    expect(events.filter(name => name === 'equip' || name === 'unequip')).toEqual(['equip']);
    world.advance(0.25);
    const order: string[] = [];
    const oldUnequip = oldTorch.onunequip.bind(oldTorch), nextEquip = nextTorch.onequip.bind(nextTorch);
    vi.spyOn(oldTorch, 'onunequip').mockImplementation(() => { order.push('unequip'); oldUnequip(); });
    const equip = vi.spyOn(nextTorch, 'onequip').mockImplementation(slot => { order.push('equip'); nextEquip(slot); });
    events.length = 0;
    store.applySlotChanges([
      { slot: hand, itemId: 'torch', skinId: 'torch_barber', delta: -1 },
      { slot: b, itemId: 'torch', skinId: 'torch_barber', delta: 1 },
      { slot: a, itemId: 'torch', delta: -1 }, { slot: hand, itemId: 'torch', delta: 1 },
    ]);
    expect(order).toEqual(['unequip', 'equip']);
    expect(events.filter(name => name === 'equip' || name === 'unequip')).toEqual(['unequip', 'equip']);
    // fueled:SetFirstPeriod charges a partly used torch TURNON_FUELED_CONSUMPTION when it lights.
    expect(oldEntity.components.fueled!.currentfuel).toBe(10 - .5 - .25);
    expect(oldTorch.isBurning).toBe(false);
    // The held inst settles its consumption when it is flushed.
    world.advance(0.5); nextEntity.flush();
    expect(nextEntity.components.fueled!.currentfuel).toBe(20 - .5 - .5);
    store.setRemainingFuel(hand, 18);
    expect(equip).toHaveBeenCalledOnce();
    nextTorch.extinguish();
    expect(store.getEntity(hand)).toBe(nextEntity);
    expect(parented(lightParent)).toEqual([]);
    // Depleted, the prefab removes itself; equippable:Unequip runs as its inventory owner clears the slot.
    store.transfer(hand, a, 1); store.transfer(a, hand, 1);
    expect(nextTorch.isBurning).toBe(true);
    world.advance(18); nextEntity.flush();
    expect(nextEntity.isRemoved).toBe(true);
    expect(store.getEntity(hand)).toBeNull();
    expect(nextEntity.components.equippable!.IsEquipped()).toBe(false);
    expect(parented(lightParent)).toEqual([]);
  } finally { store.dispose(); assets.dispose(); hats.dispose(); }
});

it("goes through SGwilson's equip and unequip handlers: item_out, item_in and item_hat from idle, not while busy", async () => {
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
  const equipper = createPlayerEquipper(animation);
  const settle = () => { for (let frame = 0; frame < 30; frame++) advancePlayer(animation, 1 / 30); };
  try {
    expect(animation.stategraph.stateName).toBe('idle');
    equipper.equip('torch');
    expect(animation.stategraph.stateName).toBe('item_out');
    settle();
    expect(animation.stategraph.stateName).toBe('idle');
    equipper.equip('strawhat', undefined, 'head');
    expect(animation.stategraph.stateName).toBe('item_hat');
    settle();
    equipper.equip(null);
    expect(animation.stategraph.stateName).toBe('item_in');
    settle();
    // A state with its own unequip handler takes the event instead: shell_enter leaves for GetUnequipState's item_hat.
    animation.stategraph.goToState('shell_enter');
    equipper.equip(null, undefined, 'head');
    expect(animation.stategraph.stateName).toBe('item_hat');
    settle();
    // Busy, non-idle states keep running.
    animation.stategraph.goToState('shell_hit');
    equipper.equip('torch');
    expect(animation.stategraph.stateName).toBe('shell_hit');
  } finally { equipper.dispose(); player.removeFromParent(); }
});
