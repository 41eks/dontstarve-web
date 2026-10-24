import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { InventoryStore, HandSlot, equipmentSlotAddress } from '../../inventory/src';
import { TridentController } from '../../prefab/src/trident';
import { createCastSpellAction } from '../../stategraphs/src/spellcaster';
import { INVENTORY_ITEM_SPECS } from '../../../src/inventoryItems';

const doer = { position: new THREE.Vector3(), hasTag: () => false, components: {} };

function setup(remainingUses: number, ocean: (point: THREE.Vector3) => boolean) {
  const slot = equipmentSlotAddress('hand');
  const inventory = new InventoryStore([{ address: slot, slot: new HandSlot() }], INVENTORY_ITEM_SPECS);
  inventory.replaceState({ bufferedBuilds: [], slots: [{ address: slot, item: { itemId: 'trident', count: 1, remainingUses } }] }, {});
  const entity = inventory.getEntity(slot)!;
  const spawnWaterspout = vi.fn();
  const trident = new TridentController(entity, {
    map: { isAboveGroundAtPoint: () => true, isOceanAtPoint: ocean, isGroundTargetBlocked: () => false },
    prepareWaterspout: async () => {}, spawnWaterspout,
  });
  return { inventory, slot, entity, trident, spawnWaterspout };
}

describe('trident water spell', () => {
  it('casts only on water, raising four waterspouts and spending 4 of 200 uses', async () => {
    const { inventory, entity, trident, spawnWaterspout } = setup(200, point => point.x > 0);
    expect(entity.hasTag('castonpointwater')).toBe(true);
    expect(entity.hasTag('castonpoint')).toBe(false);
    const land = new THREE.Vector3(-30, 0, 0), water = new THREE.Vector3(60, 0, 0);
    expect(trident.spellcaster.canCast(doer, undefined, land)).toBe(false);
    const prepared = await trident.spellcaster.prepareCast();
    expect(createCastSpellAction(entity, doer, water, () => true, undefined, () => prepared || undefined).do()).toBe(true);
    expect(spawnWaterspout).toHaveBeenCalledTimes(4);
    for (const [point] of spawnWaterspout.mock.calls) expect(point.distanceTo(water)).toBeCloseTo(2.75 * 0.65 * 3, 5);
    expect(entity.components.finiteuses.remaining).toBe(196);
    inventory.dispose();
  });

  it('skips spokes that are not on water and breaks on the last use, reporting toolbroke before removal', () => {
    const { inventory, slot, entity, trident, spawnWaterspout } = setup(4, point => point.z < 0);
    const toolbroke = vi.fn(() => expect(inventory.getEntity(slot)).toBe(entity));
    inventory.bindActor({ PushEvent: (name: string, data: unknown) => { if (name === 'toolbroke') toolbroke(data); } } as never);
    expect(trident.spellcaster.castSpell(undefined, new THREE.Vector3(0, 0, -1), doer)).toBe(true);
    expect(spawnWaterspout.mock.calls.length).toBeLessThan(4);
    expect(spawnWaterspout.mock.calls.length).toBeGreaterThan(0);
    expect(toolbroke).toHaveBeenCalledWith({ tool: entity });
    expect(inventory.getEntity(slot)).toBeNull();
    inventory.dispose();
  });
});
