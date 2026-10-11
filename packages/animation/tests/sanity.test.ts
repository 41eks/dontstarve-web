import { expect, it, vi } from 'vitest';
import { createSanityState } from '../../signals/src';
import { Sanity } from '../../componets/src/sanity';
import { createPickupInventory } from './pickupFixture';
import { equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';

it('drains only the wearer at the source rate using actual elapsed time, and stops on unequip or replacement', () => {
  const inventory = createPickupInventory(), current = createSanityState(200, 200);
  const sanity = new Sanity({ components: { inventory }, hasTag: () => false }, current);
  const changes = vi.fn(), stop = current.subscribe(changes);
  const hand = equipmentSlotAddress('hand'), bag = inventorySlotAddress(0);
  try {
    inventory.add('nightsword', 1);
    sanity.OnUpdate(60);
    expect(current.peek()).toBe(200);
    expect(changes).not.toHaveBeenCalled();
    inventory.transfer(bag, hand, 1);
    const entity = inventory.getEntity(hand)!, equippable = entity.components.equippable!;
    expect(equippable.is_magic_dapperness).toBe(true);
    expect(equippable.dapperness).toBe(-1 / 3);
    // Frame durations vary while totaling one minute of active game time.
    for (let i = 0; i < 60; i++) sanity.OnUpdate(i % 2 === 0 ? .25 : 1.75);
    expect(current.peek()).toBeCloseTo(180);
    expect(entity.components.equippable).toBe(equippable);
    inventory.transfer(hand, bag, 1);
    const unequipped = current.peek();
    sanity.OnUpdate(60);
    expect(current.peek()).toBe(unequipped);
    // An unowned sword beside the player has no area effect.
    expect(inventory.extract(bag, 1, entity)).toBe(entity);
    sanity.OnUpdate(60);
    expect(current.peek()).toBe(unequipped);
    expect(inventory.receive(entity)).toBe(true); expect(inventory.transfer(bag, hand, 1)).toBe(true);
    inventory.add('hammer', 1);
    expect(inventory.swap(bag, hand)).toBe(true);
    sanity.OnUpdate(60);
    expect(current.peek()).toBe(unequipped);
  } finally { stop(); sanity.dispose(); inventory.dispose(); }
});

it('applies the source wet equipment penalty, clamps sanity at zero and releases updates on disposal', () => {
  const inventory = createPickupInventory(), current = createSanityState(100, 200);
  let sleeping = false;
  const sanity = new Sanity({ components: { inventory }, hasTag: () => false,
    sg: { hasStateTag: tag => tag === 'sleeping' && sleeping } }, current);
  try {
    inventory.add('nightsword', 1, 'nightsword_cotl');
    inventory.transfer(inventorySlotAddress(0), equipmentSlotAddress('hand'), 1);
    inventory.getEntity(equipmentSlotAddress('hand'))!.setWet(true);
    sanity.OnUpdate(60);
    expect(current.peek()).toBeCloseTo(74); // -20 magic dapperness and -6 wetness
    sleeping = true;
    sanity.OnUpdate(60);
    expect(current.peek()).toBeCloseTo(74);
    sleeping = false;
    sanity.no_moisture_penalty = true;
    sanity.OnUpdate(60);
    expect(current.peek()).toBeCloseTo(54);
    sanity.OnUpdate(600);
    expect(current.peek()).toBe(0);
    current.set(100);
    sanity.dispose();
    sanity.OnUpdate(60);
    expect(current.peek()).toBe(100);
  } finally { sanity.dispose(); inventory.dispose(); }
});
