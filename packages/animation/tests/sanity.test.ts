import { expect, it, vi } from 'vitest';
import { Sanity } from '../../componets/src/sanity';
import { createPickupInventory } from './pickupFixture';
import { equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';

it('settles hysteresis and events synchronously and restores an insane character inside the recovery band', () => {
  const events = vi.fn(), sanity = new Sanity({ components: {}, hasTag: () => false, PushEvent: events }, 200);
  const restored = new Sanity({ components: {}, hasTag: () => false }, 200);
  try {
    sanity.SetCurrent(30);
    expect(sanity.IsInsane()).toBe(true);
    expect(events).toHaveBeenLastCalledWith('goinsane');
    sanity.SetCurrent(32);
    restored.OnLoad(JSON.parse(JSON.stringify(sanity.OnSave())));
    expect(restored.IsInsane()).toBe(true);
    sanity.SetCurrent(35);
    expect(sanity.IsSane()).toBe(true);
    expect(events).toHaveBeenLastCalledWith('gosane');
    sanity.ignore = true; sanity.DoDelta(-100);
    expect(sanity.current).toBe(35);
    expect(() => sanity.SetCurrent(NaN)).toThrow('Sanity must be finite');
    expect(sanity.current).toBe(35);
  } finally { sanity.dispose(); restored.dispose(); }
});

it('uses source lunacy thresholds, induced percentages and penalty caps without replacing the underlying value', () => {
  const sanity = new Sanity({ components: {}, hasTag: () => false }, 200);
  try {
    sanity.SetCurrent(100); sanity.EnableLunacy(true, 'island');
    sanity.SetCurrent(170); expect(sanity.IsEnlightened()).toBe(true);
    sanity.SetCurrent(167); expect(sanity.IsEnlightened()).toBe(true);
    sanity.SetCurrent(165); expect(sanity.IsSane()).toBe(true);
    sanity.EnableLunacy(false, 'island');
    sanity.SetInducedInsanity('source', true);
    expect(sanity.IsInsane()).toBe(true); expect(sanity.GetPercent()).toBe(0);
    expect(sanity.current).toBe(165);
    sanity.SetInducedInsanity('source', false);
    expect(sanity.GetPercent()).toBe(165 / 200);
    sanity.AddSanityPenalty('one', .5); expect(sanity.current).toBe(100);
    sanity.AddSanityPenalty('two', .75); expect(sanity.GetMaxWithPenalty()).toBeCloseTo(5);
    sanity.RemoveSanityPenalty('two'); expect(sanity.GetMaxWithPenalty()).toBe(100);
    sanity.SetCurrent(500); expect(sanity.current).toBe(100);
  } finally { sanity.dispose(); }
});

it('drains only the wearer at the source rate using actual elapsed time, and stops on unequip or replacement', () => {
  const inventory = createPickupInventory();
  const sanity = new Sanity({ components: { inventory }, hasTag: () => false }, 200);
  const current = sanity;
  const changes = vi.fn(), stop = current.value.subscribe(changes);
  const hand = equipmentSlotAddress('hand'), bag = inventorySlotAddress(0);
  try {
    inventory.add('nightsword', 1);
    sanity.OnUpdate(60);
    expect(current.current).toBe(200);
    expect(changes).not.toHaveBeenCalled();
    inventory.transfer(bag, hand, 1);
    const entity = inventory.getEntity(hand)!, equippable = entity.components.equippable!;
    expect(equippable.is_magic_dapperness).toBe(true);
    expect(equippable.dapperness).toBe(-1 / 3);
    // Frame durations vary while totaling one minute of active game time.
    for (let i = 0; i < 60; i++) sanity.OnUpdate(i % 2 === 0 ? .25 : 1.75);
    expect(current.current).toBeCloseTo(180);
    expect(entity.components.equippable).toBe(equippable);
    inventory.transfer(hand, bag, 1);
    const unequipped = current.current;
    sanity.OnUpdate(60);
    expect(current.current).toBe(unequipped);
    // An unowned sword beside the player has no area effect.
    expect(inventory.extract(bag, 1, entity)).toBe(entity);
    sanity.OnUpdate(60);
    expect(current.current).toBe(unequipped);
    expect(inventory.receive(entity)).toBe(true); expect(inventory.transfer(bag, hand, 1)).toBe(true);
    inventory.add('hammer', 1);
    expect(inventory.swap(bag, hand)).toBe(true);
    sanity.OnUpdate(60);
    expect(current.current).toBe(unequipped);
  } finally { stop(); sanity.dispose(); inventory.dispose(); }
});

it('applies the source wet equipment penalty, clamps sanity at zero and releases updates on disposal', () => {
  const inventory = createPickupInventory();
  let sleeping = false;
  const sanity = new Sanity({ components: { inventory }, hasTag: () => false,
    sg: { hasStateTag: tag => tag === 'sleeping' && sleeping } }, 200);
  sanity.SetCurrent(100);
  const current = sanity;
  try {
    inventory.add('nightsword', 1, 'nightsword_cotl');
    inventory.transfer(inventorySlotAddress(0), equipmentSlotAddress('hand'), 1);
    inventory.getEntity(equipmentSlotAddress('hand'))!.setWet(true);
    sanity.OnUpdate(60);
    expect(current.current).toBeCloseTo(74); // -20 magic dapperness and -6 wetness
    sleeping = true;
    sanity.OnUpdate(60);
    expect(current.current).toBeCloseTo(74);
    sleeping = false;
    sanity.no_moisture_penalty = true;
    sanity.OnUpdate(60);
    expect(current.current).toBeCloseTo(54);
    sanity.OnUpdate(600);
    expect(current.current).toBe(0);
    current.SetCurrent(100);
    sanity.dispose();
    sanity.OnUpdate(60);
    expect(current.current).toBe(100);
  } finally { sanity.dispose(); inventory.dispose(); }
});
