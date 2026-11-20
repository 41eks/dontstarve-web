import { readFile } from 'node:fs/promises';
import { testPlayer } from './testPlayer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InventorySlot, HandSlot, inventorySlotAddress, equipmentSlotAddress } from '@dontstarve-web/inventory';
import { SpriteState } from '@dontstarve-web/display';
import { TORCH_LIGHT } from '../../prefab/src/torch';
import { configureEquipmentEntity } from '../../prefab/src/handEquipment';
import { createEmptyEntity, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { createEquipmentViews } from '../../prefab/src/equipmentVisual';
import { GroundItemAssets } from '../../prefab/src/groundItems';
import { HatEquipmentAssets } from '../../prefab/src/hats';
import { createPerishWorld } from './perishWorldFixture';
import { createPlayerEquipper } from './playerEquipFixture';
import { advancePlayer, createPlayer, playerInst } from './playerVisual';
import { testInventoryStore } from './testInventory';

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn() })),
}));
beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  ),
);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The lights other entities parent to `parent`. */
const parented = (parent: PrefabInstance) => [...parent.light.slots.peek().values()].map(light => light.peek());

it('equips restored and committed torches through equippable with the owner, unequipping before replacement', () => {
  const a = inventorySlotAddress(0),
    b = inventorySlotAddress(1),
    hand = equipmentSlotAddress('hand');
  const store = testInventoryStore(
    [
      { address: a, slot: new InventorySlot() },
      { address: b, slot: new InventorySlot() },
      { address: hand, slot: new HandSlot() },
    ],
    {
      torch: {
        name: 'torch',
        icon: 'torch.tex',
        maxStack: 1,
        maxFuel: 75,
        equippable: 'hand',
        configureEntity: configureEquipmentEntity,
      },
    },
    { torch_barber: { itemId: 'torch', name: 'torch', icon: 'torch_barber.tex', atlas: 'images/inventoryimages.xml' } },
  );
  const world = createPerishWorld();
  store.entities.bindPerishWorld(world);
  // The inventory's actor is the owner; its view gives each equipped inst a slot and AttachLightTo(owner).
  const lightParent = createEmptyEntity('wilson').instance,
    assets = new GroundItemAssets(),
    hats = new HatEquipmentAssets('/dst/data/anim');
  // The player inst: the owner of the store and of the light its equipment attaches.
  const owner = testPlayer({ model: lightParent.transform.model, inventory: store });
  const events: string[] = [];
  for (const name of ['equip', 'unequip']) {
    owner.ListenForEvent(name, () => events.push(name));
  }
  owner.OpenEquipmentView = createEquipmentViews(owner, {
    sprite: { sprite: new SpriteState({ name: 'idle' }), art: assets },
    assets,
    hats,
    lightParent,
  });
  try {
    store.replaceState(
      {
        slots: [
          { address: a, item: { itemId: 'torch', count: 1, remainingFuel: 20 } },
          {
            address: hand,
            item: { entityId: 'saved_torch', itemId: 'torch', count: 1, skinId: 'torch_barber', remainingFuel: 10 },
          },
        ],
        bufferedBuilds: [],
      },
      {},
    );
    const oldEntity = store.getEntity(hand)!,
      nextEntity = store.getEntity(a)!;
    expect(oldEntity.id).toBe('saved_torch');
    const burning = (entity: typeof oldEntity) => entity.components.burnable!.IsBurning();
    expect(burning(oldEntity)).toBe(true);
    expect(parented(lightParent)).toEqual([TORCH_LIGHT]);
    expect(events.filter(name => name === 'equip' || name === 'unequip')).toEqual(['equip']);
    world.advance(0.25);
    const order: string[] = [];
    const oldEquippable = oldEntity.components.equippable!,
      nextEquippable = nextEntity.components.equippable!;
    const oldUnequip = oldEquippable.Unequip.bind(oldEquippable),
      nextEquip = nextEquippable.Equip.bind(nextEquippable);
    vi.spyOn(oldEquippable, 'Unequip').mockImplementation(owner => {
      order.push('unequip');
      oldUnequip(owner);
    });
    const equip = vi.spyOn(nextEquippable, 'Equip').mockImplementation(owner => {
      order.push('equip');
      nextEquip(owner);
    });
    events.length = 0;
    store.applySlotChanges([
      { slot: hand, itemId: 'torch', skinId: 'torch_barber', delta: -1 },
      { slot: b, itemId: 'torch', skinId: 'torch_barber', delta: 1 },
      { slot: a, itemId: 'torch', delta: -1 },
      { slot: hand, itemId: 'torch', delta: 1 },
    ]);
    expect(order).toEqual(['unequip', 'equip']);
    expect(events.filter(name => name === 'equip' || name === 'unequip')).toEqual(['unequip', 'equip']);
    // fueled:SetFirstPeriod charges a partly used torch TURNON_FUELED_CONSUMPTION when it lights.
    expect(oldEntity.components.fueled!.currentfuel).toBe(10 - 0.5 - 0.25);
    expect(burning(oldEntity)).toBe(false);
    // The held inst settles its consumption when it is flushed.
    world.advance(0.5);
    nextEntity.flush();
    expect(nextEntity.components.fueled!.currentfuel).toBe(20 - 0.5 - 0.5);
    store.setRemainingFuel(hand, 18);
    expect(equip).toHaveBeenCalledOnce();
    // Extinguished from outside while held, the torch keeps its inst.fires: OnExtinguish only handles one in the ground.
    nextEntity.components.burnable!.Extinguish();
    expect(store.getEntity(hand)).toBe(nextEntity);
    expect(parented(lightParent)).toEqual([TORCH_LIGHT]);
    // Depleted, the prefab removes itself; equippable:Unequip runs as its inventory owner clears the slot.
    store.transfer(hand, a, 1);
    store.transfer(a, hand, 1);
    expect(burning(nextEntity)).toBe(true);
    world.advance(18);
    nextEntity.flush();
    expect(nextEntity.isRemoved).toBe(true);
    expect(store.getEntity(hand)).toBeNull();
    expect(nextEntity.components.equippable!.IsEquipped()).toBe(false);
    expect(parented(lightParent)).toEqual([]);
  } finally {
    store.dispose();
    assets.dispose();
    hats.dispose();
  }
});

it("goes through SGwilson's equip and unequip handlers: item_out, item_in and item_hat from idle, not while busy", async () => {
  const player = await createPlayer('/dst/data/anim');
  const animation = playerInst(player);
  const equipper = createPlayerEquipper(animation);
  const settle = () => {
    for (let frame = 0; frame < 30; frame++) {
      advancePlayer(animation, 1 / 30);
    }
  };
  try {
    expect(animation.sg.stateName).toBe('idle');
    equipper.equip('torch');
    expect(animation.sg.stateName).toBe('item_out');
    settle();
    expect(animation.sg.stateName).toBe('idle');
    equipper.equip('strawhat', undefined, 'head');
    expect(animation.sg.stateName).toBe('item_hat');
    settle();
    equipper.equip(null);
    expect(animation.sg.stateName).toBe('item_in');
    settle();
    // A state with its own unequip handler takes the event instead: shell_enter leaves for GetUnequipState's item_hat.
    animation.sg.goToState('shell_enter');
    equipper.equip(null, undefined, 'head');
    expect(animation.sg.stateName).toBe('item_hat');
    settle();
    // Busy, non-idle states keep running.
    animation.sg.goToState('shell_hit');
    equipper.equip('torch');
    expect(animation.sg.stateName).toBe('shell_hit');
  } finally {
    equipper.dispose();
    player.removeFromParent();
  }
});
