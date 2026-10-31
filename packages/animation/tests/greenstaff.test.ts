import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ItemEntity, InventoryStore, HandSlot, equipmentSlotAddress } from '../../inventory/src';
import { GreenStaffController, deconstructionLoot, type DeconstructionTarget } from '../../prefab/src/staff';
import { collectEquippedActions } from '../../stategraphs/src/componentactions';
import { createCastSpellAction } from '../../stategraphs/src/castspell';
import { INVENTORY_ITEM_SPECS } from '../../../src/inventoryItems';

function target(itemId = 'opalstaff', remainingUses = 50): DeconstructionTarget & { entity: ItemEntity } {
  const entity = new ItemEntity({ itemId, count: 1, remainingUses });
  entity.configure(INVENTORY_ITEM_SPECS[itemId]);
  return {
    entity, prefab: entity.prefab, model: new THREE.Group(), position: new THREE.Vector3(12, 0, 0),
    components: entity.components, get isRemoved() { return entity.isRemoved; },
    hasTag: tag => entity.hasTag(tag), isValid: () => !entity.isRemoved,
    PushEvent: (name, data) => entity.PushEvent(name, data), removeOne: () => entity.remove(),
  };
}

describe('greenstaff source deconstruction', () => {
  it('uses the opal deconstruction recipe, condition rounding and precious gem exception', () => {
    const opal = target('opalstaff', 1), yellow = target('yellowstaff', 20);
    expect(deconstructionLoot(opal)).toEqual([
      { itemId: 'nightmarefuel', count: 1 }, { itemId: 'livinglog', count: 1 }, { itemId: 'opalpreciousgem', count: 1 },
    ]);
    expect(deconstructionLoot(yellow)).toEqual([{ itemId: 'nightmarefuel', count: 4 }, { itemId: 'livinglog', count: 2 }]);
    expect(deconstructionLoot({ prefab: 'wall_stone_item', components: {} })).toEqual([
      { itemId: 'cutstone', count: 1 },
    ]);
    opal.entity.destroy(); yellow.entity.destroy();
  });

  it('selects recipe targets and commits removal, cost and final equipment depletion through the store', async () => {
    const slot = equipmentSlotAddress('hand');
    const inventory = new InventoryStore([{ address: slot, slot: new HandSlot() }], INVENTORY_ITEM_SPECS);
    inventory.replaceState({ bufferedBuilds: [], slots: [{ address: slot, item: { itemId: 'greenstaff', count: 1, remainingUses: 1 } }] }, {});
    const entity = inventory.getEntity(slot)!;
    const spawn = vi.fn();
    const staff = new GreenStaffController(entity, { spawnLoot: spawn });
    staff.onequip();
    const opal = target();
    const event = vi.fn(); opal.entity.ListenForEvent('ondeconstructstructure', event);
    const doDelta = vi.fn(), staffDelta = vi.fn();
    const doer = { position: new THREE.Vector3(), hasTag: () => false,
      components: { sanity: { doDelta }, staffsanity: { doCastingDelta: staffDelta } } };
    expect(entity.hasTag('castonrecipes')).toBe(true);
    expect(entity.hasTag('castontargets')).toBe(false);
    expect(collectEquippedActions(entity, opal, true)).toEqual(['CASTSPELL']);
    expect(collectEquippedActions(entity, { prefab: 'livinglog', isRemoved: false, hasTag: () => false }, true)).toEqual([]);
    const action = createCastSpellAction(entity, doer, opal.position, () => true, opal);
    expect(action.target).toBe(opal);
    expect(action.do()).toBe(true);
    expect(spawn).toHaveBeenCalledWith([
      { itemId: 'nightmarefuel', count: 4 }, { itemId: 'livinglog', count: 2 }, { itemId: 'opalpreciousgem', count: 1 },
    ], opal.position);
    expect(event).toHaveBeenCalledWith(doer);
    expect(opal.isRemoved).toBe(true);
    expect(staffDelta).toHaveBeenCalledWith(-20); expect(doDelta).not.toHaveBeenCalled();
    expect(inventory.getEntity(slot)).toBeNull();
    expect(inventory.handEquipment.peek()).toBeNull();
    inventory.dispose();
  });

  it('revalidates buffered targets and held identity without consuming or removing anything', async () => {
    const entity = new ItemEntity({ itemId: 'greenstaff', count: 1 });
    const spawn = vi.fn();
    new GreenStaffController(entity, { spawnLoot: spawn });
    const opal = target(), doDelta = vi.fn();
    const doer = { position: new THREE.Vector3(), hasTag: () => false, components: { sanity: { doDelta } } };
    let held = true;
    const action = createCastSpellAction(entity, doer, opal.position, () => held, opal);
    held = false;
    expect(action.do()).toBe(false);
    held = true; opal.entity.addTag('INLIMBO');
    expect(action.do()).toBe(false);
    expect(spawn).not.toHaveBeenCalled(); expect(doDelta).not.toHaveBeenCalled();
    expect(entity.components.finiteuses.percent.peek()).toBe(1);
    expect(opal.isRemoved).toBe(false);
    entity.destroy(); opal.entity.destroy();
  });
});
