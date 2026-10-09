import { expect, it, vi } from 'vitest';
import { InventoryStore, type InventoryItemSpec } from '../../inventory/src';
import { createBuildingContainer } from '../../prefab/src/containers';
import { Stewer } from '../../componets/src/stewer';
import { BASE_COOK_TIME } from '../../componets/src/cooking';
import { performCookAction } from '../../stategraphs/src/cook';

function createPot() {
  const specs = Object.fromEntries(['twigs', 'red_cap', 'monstermeat', 'log'].map(id =>
    [id, { name: id, icon: `${id}.tex`, maxStack: 40 } satisfies InventoryItemSpec]));
  const inventory = new InventoryStore([], specs);
  const container = createBuildingContainer('cookpot', {});
  const containerId = 'world:cookpot:test';
  inventory.registerContainer(containerId, container);
  const tags = new Set<string>();
  const components = { container, stewer: undefined as Stewer | undefined };
  const stewer = new Stewer({ prefab: 'cookpot', components,
    addTag: tag => tags.add(tag), removeTag: tag => tags.delete(tag) });
  components.stewer = stewer;
  return { inventory, container, containerId, components, stewer, tags };
}

it('COOK consumes the pot entities and derives another recipe, resuming the task without recreating ingredients', () => {
  const pot = createPot();
  const names = ['twigs', 'red_cap', 'red_cap', 'monstermeat'];
  expect(pot.inventory.applySlotChanges(names.map((itemId, index) => ({
    slot: { containerId: pot.containerId, slotKey: String(index) }, itemId, delta: 1,
  })))).toBe(true);
  const entities = pot.container.GetAllItems();
  expect(pot.tags.has('readytocook')).toBe(true);
  const doer = { userid: 'chef' };
  pot.container.Open(doer);
  expect(pot.tags.has('readytocook')).toBe(false);
  const start = vi.fn(), done = vi.fn();
  pot.stewer.onstartcooking = start;
  pot.stewer.ondonecooking = done;
  expect(performCookAction(pot, doer)).toBe(true);
  expect(start).toHaveBeenCalledOnce();
  expect(pot.stewer.product).toBe('kabobs');
  expect(pot.stewer.GetTimeToCook()).toBe(BASE_COOK_TIME * 2);
  expect(pot.container.IsEmpty()).toBe(true);
  expect(pot.container.IsOpen()).toBe(false);
  expect(pot.container.canbeopened).toBe(false);
  expect(entities.every(entity => entity.isRemoved)).toBe(true);
  expect(pot.inventory.exportState().slots.every(slot => slot.item === null)).toBe(true);
  expect(performCookAction(pot, doer)).toBe(true);
  expect(start).toHaveBeenCalledOnce();

  pot.stewer.LongUpdate(3.5);
  const saved = pot.stewer.OnSave();
  expect(saved).toEqual({ product: 'kabobs', remainingtime: BASE_COOK_TIME * 2 - 3.5,
    ingredient_prefabs: names, chef_id: 'chef' });
  const restored = createPot();
  const continued = vi.fn();
  restored.stewer.oncontinuecooking = continued;
  restored.stewer.OnLoad(JSON.parse(JSON.stringify(saved)));
  expect(continued).toHaveBeenCalledOnce();
  expect(restored.container.canbeopened).toBe(false);
  expect(restored.stewer.OnSave()).toEqual(saved);
  restored.stewer.LongUpdate(BASE_COOK_TIME * 2);
  expect(restored.stewer.IsDone()).toBe(true);
  expect(restored.tags.has('donecooking')).toBe(true);
  expect(restored.stewer.GetTimeToCook()).toBe(0);
  pot.stewer.OnRemoveFromEntity(); restored.stewer.OnRemoveFromEntity();
  expect(pot.tags.size).toBe(0);
});

it('rejects incomplete containers, non-ingredients and another opener without consuming or starting a task', () => {
  const pot = createPot();
  const doer = {}, other = {};
  expect(performCookAction(pot, doer)).toBe(false);
  const slot = { containerId: pot.containerId, slotKey: '0' };
  expect(pot.inventory.applySlotChanges([{ slot, itemId: 'log', delta: 1 }])).toBe(false);
  pot.inventory.applySlotChanges(Array.from({ length: 4 }, (_, index) => ({
    slot: { ...slot, slotKey: String(index) }, itemId: 'twigs', delta: 1,
  })));
  const before = pot.inventory.exportState();
  pot.container.Open(other);
  expect(performCookAction(pot, doer)).toBe(false);
  expect(pot.inventory.exportState()).toEqual(before);
  expect(pot.stewer.IsCooking()).toBe(false);
  pot.stewer.OnRemoveFromEntity();
  pot.stewer.OnRemoveFromEntity();
  pot.container.Close();
  pot.container.publishDTO();
  expect(pot.tags.size).toBe(0);
  expect(pot.inventory.exportState()).toEqual(before);
});

it('attaches a loaded pot to the registered slots without replacing entities, and ignores stale container removal', () => {
  const pot = createPot();
  const slot = { containerId: pot.containerId, slotKey: '0' };
  pot.inventory.applySlotChanges([{ slot, itemId: 'twigs', delta: 1 }]);
  const entity = pot.inventory.getEntity(slot);
  const replacement = createBuildingContainer('cookpot', {});
  pot.inventory.registerContainer(pot.containerId, replacement);
  expect(replacement.GetItemInSlot(1)).toBe(entity);
  expect(replacement.toSignal().peek().slots[0]?.entityId).toBe(entity!.id);
  pot.inventory.unregisterContainer(pot.containerId, pot.container);
  expect(pot.inventory.getEntity(slot)).toBe(entity);
  expect(entity!.isRemoved).toBe(false);
  pot.inventory.unregisterContainer(pot.containerId, replacement);
  expect(pot.inventory.getEntity(slot)).toBeNull();
  expect(entity!.isRemoved).toBe(true);
  expect(pot.inventory.exportState().slots).toEqual([]);
  pot.stewer.OnRemoveFromEntity();
});
