import { importedSave } from './importedSave';
import { expect, it, vi } from 'vitest';
import { inventorySlotAddress } from '../../inventory/src';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { createInventoryStore } from '../../../src/inventory';
import { Sanity } from '../../componets/src/sanity';
import {
  ARMOR_DREADSTONEHAT, ARMOR_DREADSTONE_REGEN_MAXRATE, ARMOR_DREADSTONE_REGEN_MINRATE, CRAZINESS_MED, DREADSTONEHAT_ID,
  createDreadstoneHatLifecycle,
} from '../../prefab/src/dreadstonehat';
import { createPickupInventory } from './pickupFixture';
import { createPerishWorld } from './perishWorldFixture';

function wornHat(sanityPoints: number) {
  const inventory = createPickupInventory(), world = createPerishWorld();
  inventory.entities.bindPerishWorld(world);
  inventory.add(DREADSTONEHAT_ID, 1);
  const entity = inventory.getEntity(inventorySlotAddress(0))!;
  expect(inventory.EquipFromInventory(entity)).toBe(true);
  const components: { inventory: typeof inventory; sanity?: Sanity } = { inventory };
  const sanity = components.sanity = new Sanity({ components, hasTag: () => false }, 200);
  sanity.SetCurrent(sanityPoints);
  const current = sanity;
  const lifecycle = createDreadstoneHatLifecycle(entity);
  lifecycle.onequip({ PushEvent: vi.fn(), components: { sanity } });
  const armor = entity.components.armor!;
  return { inventory, world, entity, armor, current, sanity, lifecycle,
    dispose() { lifecycle.onunequip(); sanity.dispose(); inventory.dispose(); } };
}

it('regenerates once per second after damage, faster at lower sanity, draining sanity until repaired', () => {
  const hat = wornHat(0);
  try {
    expect(hat.entity.components.equippable).toMatchObject({ equipslot: 'head', is_magic_dapperness: true });
    expect(['hat', 'dreadstone', 'hardarmor', 'shadow_item', 'waterproofer', 'shadowlevel'].every(tag => hat.entity.hasTag(tag))).toBe(true);
    expect(hat.armor.maxcondition).toBe(ARMOR_DREADSTONEHAT);
    expect(hat.sanity.GetRate()).toBe(0);
    hat.armor.TakeDamage(10);
    expect(hat.entity.signals.durabilityPercent.peek()).toBeCloseTo((ARMOR_DREADSTONEHAT - 10) / ARMOR_DREADSTONEHAT);
    // dreadstone_calcdapperness: CRAZINESS_MED while the regen task runs.
    expect(hat.sanity.GetRate()).toBeCloseTo(CRAZINESS_MED);
    hat.world.advance(0.5);
    expect(hat.armor.condition.peek()).toBe(ARMOR_DREADSTONEHAT - 10);
    hat.world.advance(0.5);
    expect(hat.armor.condition.peek()).toBeCloseTo(ARMOR_DREADSTONEHAT - 10 + ARMOR_DREADSTONEHAT * ARMOR_DREADSTONE_REGEN_MAXRATE);
    hat.current.SetCurrent(200);
    hat.world.advance(1);
    expect(hat.armor.condition.peek()).toBeCloseTo(ARMOR_DREADSTONEHAT - 10
      + ARMOR_DREADSTONEHAT * (ARMOR_DREADSTONE_REGEN_MAXRATE + ARMOR_DREADSTONE_REGEN_MINRATE));
    hat.world.advance(60);
    expect(hat.armor.IsDamaged()).toBe(false);
    expect(hat.sanity.GetRate()).toBe(0);
  } finally { hat.dispose(); }
});

it('starts only while worn and damaged, and unequipping cancels the task', () => {
  const hat = wornHat(100);
  try {
    hat.world.advance(5);
    expect(hat.sanity.GetRate()).toBe(0);
    hat.armor.TakeDamage(50);
    hat.lifecycle.onunequip();
    hat.world.advance(5);
    expect(hat.armor.condition.peek()).toBe(ARMOR_DREADSTONEHAT - 50);
    hat.armor.TakeDamage(1);
    hat.world.advance(5);
    expect(hat.armor.condition.peek()).toBe(ARMOR_DREADSTONEHAT - 51);
    // dreadstone_onequip restarts a damaged hat's regeneration.
    hat.lifecycle.onequip({ PushEvent: vi.fn(), components: { sanity: hat.sanity } });
    hat.world.advance(1);
    expect(hat.armor.condition.peek()).toBeGreaterThan(ARMOR_DREADSTONEHAT - 51);
  } finally { hat.dispose(); }
});

it('keeps its condition through re-configuration, transfers and a save round trip', async () => {
  const hat = wornHat(100);
  try {
    hat.lifecycle.onunequip();
    hat.armor.TakeDamage(100);
    const condition = ARMOR_DREADSTONEHAT - 100;
    // Equip re-runs configureEntity; InitCondition must not refill the hat.
    expect(hat.inventory.Unequip('head')).toBe(hat.entity);
    expect(hat.inventory.Equip(hat.entity)).toBe(true);
    expect(hat.armor.condition.peek()).toBe(condition);
    expect(hat.entity.snapshot().armor).toEqual({ condition });
    const template = importedSave('Caves');
    const saved = deserializeSave(serializeSave(template, {
      inventory: hat.inventory.exportState(), elapsedSeconds: 0, playerTransform: { position: [0, 0, 0], rotationY: 0 }, entities: {},
    }, SAVE_CATALOG), SAVE_CATALOG);
    const restored = createInventoryStore([]);
    try {
      restored.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
      const entity = restored.GetEquippedItem('head')!;
      expect(entity.id).toBe(hat.entity.id);
      expect(entity.components.armor!.condition.peek()).toBe(condition);
      // armor.lua OnSave omits a full condition.
      entity.components.armor!.Repair(100);
      expect(entity.snapshot().armor).toBeUndefined();
    } finally { restored.dispose(); }
  } finally { hat.dispose(); }
}, 60_000);
