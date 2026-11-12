import { createBufferedAction } from '../../stategraphs/src/actionfns';
import { Sanity } from '../../componets/src/sanity';
import { addComponent } from '../../prefab/src/components';
import { testPlayer } from './testPlayer';
import { collectEquippedItemActions } from '../../stategraphs/src/componentactions';
import { describe, expect, it, vi } from 'vitest';
import { ItemEntity, InventoryStore, HandSlot, equipmentSlotAddress } from '../../inventory/src';
import { GreenStaffController, deconstructionLoot } from '../../prefab/src/staff';
import { INVENTORY_ITEM_SPECS } from '../../../src/inventoryItems';

/** A staff lying in the world: the entity the greenstaff casts on. */
function target(itemId = 'opalstaff', remainingUses = 50): ItemEntity {
  const entity = new ItemEntity({ itemId, count: 1, remainingUses });
  entity.configure(INVENTORY_ITEM_SPECS[itemId]);
  entity.setPosition(12, 0, 0);
  return entity;
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
    opal.destroy(); yellow.destroy();
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
    const event = vi.fn(); opal.ListenForEvent('ondeconstructstructure', event);
    // The caster is the player inst, whose sanity pays the cast.
    const doer = testPlayer();
    const doDelta = vi.spyOn(addComponent(doer, 'sanity', Sanity, 200), 'DoDelta');
    expect(entity.hasTag('castonrecipes')).toBe(true);
    expect(entity.hasTag('castontargets')).toBe(false);
    expect(collectEquippedItemActions(entity, undefined, opal, true)).toEqual(['CASTSPELL']);
    const livinglog = new ItemEntity({ itemId: 'livinglog', count: 1 });
    expect(collectEquippedItemActions(entity, undefined, livinglog, true)).toEqual([]);
    livinglog.destroy();
    const action = createBufferedAction('CASTSPELL', { doer, target: opal, invobject: entity, pos: opal.position });
    expect(action.target).toBe(opal);
    expect(action.do()).toBe(true);
    expect(spawn).toHaveBeenCalledWith([
      { itemId: 'nightmarefuel', count: 4 }, { itemId: 'livinglog', count: 2 }, { itemId: 'opalpreciousgem', count: 1 },
    ], opal.position);
    expect(event).toHaveBeenCalledWith(opal, doer);
    expect(opal.isRemoved).toBe(true);
    expect(doDelta).toHaveBeenCalledExactlyOnceWith(-20);
    expect(inventory.getEntity(slot)).toBeNull();
    expect(inventory.handEquipment.peek()).toBeNull();
    inventory.dispose();
  });

  it('revalidates buffered targets and held identity without consuming or removing anything', async () => {
    const entity = new ItemEntity({ itemId: 'greenstaff', count: 1 });
    const spawn = vi.fn();
    new GreenStaffController(entity, { spawnLoot: spawn });
    const opal = target(), doer = testPlayer();
    const doDelta = vi.spyOn(addComponent(doer, 'sanity', Sanity, 200), 'DoDelta');
    let held = true;
    const action = createBufferedAction('CASTSPELL', { doer, target: opal, invobject: entity, pos: opal.position }, () => held);
    held = false;
    expect(action.do()).toBe(false);
    held = true; opal.addTag('INLIMBO');
    expect(action.do()).toBe(false);
    expect(spawn).not.toHaveBeenCalled(); expect(doDelta).not.toHaveBeenCalled();
    expect(entity.components.finiteuses.percent.peek()).toBe(1);
    expect(opal.isRemoved).toBe(false);
    entity.destroy(); opal.destroy();
  });
});
