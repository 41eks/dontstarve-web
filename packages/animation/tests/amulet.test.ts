import { expect, it, vi } from 'vitest';
import { Hunger } from '../../componets/src/hunger';
import { Health } from '../../componets/src/health';
import { equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { AMULET_ID, REDAMULET_CONVERSION, REDAMULET_CONVERSION_TIME, REDAMULET_USES } from '../../prefab/src/amulet';
import { AnimState } from '../src/animState';
import { smallHash } from '../src/animationAssets';
import { HAUNT_COOLDOWN_MEDIUM } from '../../componets/src/hauntable';
import { createPickupInventory } from './pickupFixture';
import { createPerishWorld } from './perishWorldFixture';

function wornAmulet(health: number, hunger: number) {
  const inventory = createPickupInventory(), world = createPerishWorld();
  inventory.entities.bindPerishWorld(world);
  const stats = { health: new Health(150), hunger: new Hunger({ components: {} }, 150) };
  stats.health.SetCurrentHealth(health);
  stats.hunger.SetCurrent(hunger);
  const state = { name: 'idle' };
  const listeners = new Set<(data: unknown) => void>();
  const owner = { PushEvent: vi.fn(), components: stats, IsCurrentState: (name: string) => name === state.name,
    hasTag: () => false, GetPosition: () => ({ x: 0, y: 0, z: 0 }),
    ListenForEvent: (name: string, listener: (data: unknown) => void) => {
      if (name !== 'newstate') return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    // owner.OpenEquipmentView: the amulet's own AnimState slot, which stays drawn while retained.
    OpenEquipmentView: () => view,
  };
  const slot = { AnimState: new AnimState(), close: vi.fn(), released: vi.fn(), holds: 0 };
  const view = Object.assign(Object.create(owner), { AnimState: slot.AnimState, presentation: {}, close: slot.close,
    Retain: () => { slot.holds++; return () => { slot.holds--; slot.released(); }; } });
  const enter = (name: string) => { state.name = name; for (const listener of [...listeners]) listener({ statename: name }); };
  // inventory:Equip runs equippable:Equip(owner): the owner is the inventory's actor.
  inventory.bindActor(owner);
  inventory.add(AMULET_ID, 1);
  const entity = inventory.getEntity(inventorySlotAddress(0))!;
  expect(inventory.EquipFromInventory(entity)).toBe(true);
  return { inventory, world, entity, stats, slot, state, enter, owner };
}

it('is a body resurrector with source uses and a hauntable that resurrects', () => {
  const { inventory, entity } = wornAmulet(150, 150);
  try {
    expect(inventory.getEntity(equipmentSlotAddress('body'))).toBe(entity);
    expect(entity.components.equippable).toMatchObject({ equipslot: 'body', is_magic_dapperness: true });
    expect(entity.hasTag('resurrector')).toBe(true);
    expect(entity.components.finiteuses.remaining ?? REDAMULET_USES).toBe(REDAMULET_USES);
    expect(entity.components.hauntable).toBeDefined();
  } finally { inventory.dispose(); }
});

it('converts hunger into health every 30 game seconds while hurt, spending one use each time', () => {
  const { inventory, world, entity, stats } = wornAmulet(100, 100);
  try {
    world.advance(REDAMULET_CONVERSION_TIME - 1);
    expect(stats.health.currenthealth).toBe(100);
    world.advance(1);
    expect(stats.health.currenthealth).toBe(100 + REDAMULET_CONVERSION);
    expect(stats.hunger.current).toBe(100 - REDAMULET_CONVERSION);
    expect(entity.components.finiteuses.remaining).toBe(REDAMULET_USES - 1);
    world.advance(REDAMULET_CONVERSION_TIME);
    expect(stats.health.currenthealth).toBe(100 + 2 * REDAMULET_CONVERSION);
    // Healthy owners and nearly empty stomachs cost nothing.
    stats.health.SetVal(150);
    world.advance(REDAMULET_CONVERSION_TIME);
    expect(entity.components.finiteuses.remaining).toBe(REDAMULET_USES - 2);
    stats.health.SetVal(100); stats.hunger.SetCurrent(5);
    world.advance(REDAMULET_CONVERSION_TIME);
    expect(stats.health.currenthealth).toBe(100);
    expect(entity.components.finiteuses.remaining).toBe(REDAMULET_USES - 2);
  } finally { inventory.dispose(); }
});

it('stops converting once unequipped, and keeps its worn art through amulet_rebirth', () => {
  const { inventory, world, stats, slot, enter } = wornAmulet(100, 100);
  const swapBody = () => slot.AnimState.json.peek().overrides.has(smallHash('swap_body'));
  try {
    expect(swapBody()).toBe(true);
    enter('amulet_rebirth');
    expect(inventory.Unequip('body')).not.toBeNull();
    // onunequip_red keeps swap_body; the slot is retained past equippable:Unequip closing the view.
    expect(swapBody()).toBe(true);
    expect(slot.close).toHaveBeenCalledOnce();
    expect(slot.holds).toBe(1);
    world.advance(REDAMULET_CONVERSION_TIME * 2);
    expect(stats.health.currenthealth).toBe(100);
    // SGwilson amulet_rebirth onexit: the art the amulet left goes as the owner leaves the state.
    enter('idle');
    expect(swapBody()).toBe(false);
    expect(slot.holds).toBe(0);
    enter('amulet_rebirth');
    expect(slot.released).toHaveBeenCalledOnce();
    const second = wornAmulet(100, 100);
    second.inventory.Unequip('body');
    expect(second.slot.AnimState.json.peek().overrides.has(smallHash('swap_body'))).toBe(false);
    expect(second.slot.holds).toBe(0);
    second.inventory.dispose();
  } finally { inventory.dispose(); }
});

it('removes itself when the last use is spent', () => {
  const { inventory, world, entity } = wornAmulet(10, 100);
  try {
    entity.components.finiteuses.remaining = 1;
    world.advance(REDAMULET_CONVERSION_TIME);
    expect(entity.isRemoved).toBe(true);
    expect(inventory.getEntity(equipmentSlotAddress('body'))).toBeNull();
  } finally { inventory.dispose(); }
});

it('asks a haunting ghost to respawn from the amulet, then cools down on the game clock', () => {
  const { inventory, world, entity } = wornAmulet(150, 150);
  try {
    const hauntable = entity.components.hauntable!;
    const ghost = { hasTag: (tag: string) => tag === 'playerghost', PushEvent: vi.fn() };
    hauntable.DoHaunt(ghost);
    expect(ghost.PushEvent).toHaveBeenCalledWith('respawnfromghost', { source: expect.objectContaining({ prefab: AMULET_ID, entity }) });
    expect(entity.hasTag('haunted')).toBe(true);
    world.advance(HAUNT_COOLDOWN_MEDIUM);
    expect(entity.hasTag('haunted')).toBe(false);
  } finally { inventory.dispose(); }
});
