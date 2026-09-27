import { InventorySlot, ItemSlot } from './slots';
import type {
  InventoryItemSpec,
  InventoryListener,
  InventoryRecipeDefinition,
  InventorySkinSpec,
  InventorySlotDelta,
  InventoryStack,
  SlotAddress,
} from './types';

function addressKey(address: SlotAddress): string {
  return `${address.containerId}\n${address.slotKey}`;
}

function cloneAddress(address: SlotAddress): SlotAddress {
  return { ...address };
}

function isSameStack(stack: InventoryStack, itemId: string, skinId?: string): boolean {
  return stack.itemId === itemId && stack.skinId === skinId;
}

export class InventoryStore {
  private readonly bufferedBuilds = new Set<string>();
  private readonly itemSpecs = new Map<string, InventoryItemSpec>();
  private readonly listeners = new Set<InventoryListener>();
  private readonly skinSpecs: Readonly<Record<string, InventorySkinSpec>>;
  private readonly slotByAddress = new Map<string, ItemSlot>();
  private readonly slots: readonly ItemSlot[];

  constructor(
    slots: readonly ItemSlot[],
    itemSpecs: Readonly<Record<string, InventoryItemSpec>>,
    skinSpecs: Readonly<Record<string, InventorySkinSpec>> = {},
  ) {
    this.slots = [...slots];
    this.skinSpecs = skinSpecs;
    Object.entries(itemSpecs).forEach(([itemId, spec]) => this.itemSpecs.set(itemId, spec));
    for (const slot of slots) {
      const key = addressKey(slot.address);
      if (this.slotByAddress.has(key)) throw new RangeError(`Duplicate slot address: ${key}`);
      this.slotByAddress.set(key, slot);
      const stack = slot.get();
      if (!stack) continue;
      const spec = this.requireItemSpec(stack.itemId);
      if (!Number.isSafeInteger(stack.count)
        || stack.count <= 0
        || stack.count > spec.maxStack
        || !slot.accepts(spec)) {
        throw new RangeError(`Invalid initial stack for ${stack.itemId} in ${key}`);
      }
    }
  }

  subscribe(listener: InventoryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get(address: SlotAddress): InventoryStack | null {
    return this.slotByAddress.get(addressKey(address))?.get() ?? null;
  }

  getItemSpec(itemId: string): InventoryItemSpec {
    return this.requireItemSpec(itemId);
  }

  getStackSpec(stack: InventoryStack): InventoryItemSpec {
    const item = this.requireItemSpec(stack.itemId);
    if (!stack.skinId) return item;
    const skin = this.skinSpecs[stack.skinId];
    return skin ? { ...item, name: skin.name, icon: skin.icon, atlas: skin.atlas } : item;
  }

  count(itemId: string): number {
    return this.slots.reduce((total, slot) => {
      const stack = slot.get();
      return total + (stack?.itemId === itemId ? stack.count : 0);
    }, 0);
  }

  counts(): Readonly<Record<string, number>> {
    return Object.fromEntries(
      [...this.itemSpecs.keys()].map((itemId) => [itemId, this.count(itemId)]),
    );
  }

  buffered(): readonly string[] {
    return [...this.bufferedBuilds];
  }

  isBuffered(recipeId: string): boolean {
    return this.bufferedBuilds.has(recipeId);
  }

  takeBuffered(recipeId: string): boolean {
    if (!this.bufferedBuilds.delete(recipeId)) return false;
    this.notify([]);
    return true;
  }

  takeItem(itemId: string): boolean {
    const slot = this.slots.find((candidate) => candidate.get()?.itemId === itemId);
    const stack = slot?.get();
    if (!slot || !stack) return false;
    return this.applySlotChanges([{
      slot: slot.address,
      itemId,
      ...(stack.skinId === undefined ? {} : { skinId: stack.skinId }),
      delta: -1,
    }]);
  }

  addresses(): readonly SlotAddress[] {
    return this.slots.map(({ address }) => cloneAddress(address));
  }

  add(itemId: string, count: number, skinId?: string): boolean {
    const spec = this.itemSpecs.get(itemId);
    if (!spec || !Number.isSafeInteger(count) || count <= 0) return false;

    const working = this.snapshot();
    const changes: InventorySlotDelta[] = [];
    let remaining = count;

    for (const slot of this.inventorySlots()) {
      if (remaining <= 0) break;
      const key = addressKey(slot.address);
      const stack = working.get(key);
      if (!stack || !isSameStack(stack, itemId, skinId) || stack.count >= spec.maxStack) continue;
      const added = Math.min(remaining, spec.maxStack - stack.count);
      changes.push({
        slot: slot.address,
        itemId,
        ...(skinId === undefined ? {} : { skinId }),
        delta: added,
      });
      stack.count += added;
      remaining -= added;
    }

    for (const slot of this.inventorySlots()) {
      if (remaining <= 0) break;
      const key = addressKey(slot.address);
      if (working.get(key)) continue;
      const added = Math.min(remaining, spec.maxStack);
      changes.push({
        slot: slot.address,
        itemId,
        ...(skinId === undefined ? {} : { skinId }),
        delta: added,
      });
      working.set(key, { itemId, ...(skinId === undefined ? {} : { skinId }), count: added });
      remaining -= added;
    }

    return remaining === 0 && this.applySlotChanges(changes);
  }

  craft(recipe: InventoryRecipeDefinition, skinId?: string): boolean {
    if (!Number.isSafeInteger(recipe.productCount) || recipe.productCount <= 0) return false;
    if (recipe.buffered && this.isBuffered(recipe.recipeId)) return false;
    const product = recipe.buffered ? undefined : this.itemSpecs.get(recipe.productId);
    if (!recipe.buffered && !product) return false;

    const working = this.snapshot();
    const requiredByItem = new Map<string, number>();
    for (const [itemId, amount] of Object.entries(recipe.ingredients)) {
      if (!this.itemSpecs.has(itemId) || !Number.isSafeInteger(amount) || amount <= 0) return false;
      requiredByItem.set(itemId, (requiredByItem.get(itemId) ?? 0) + amount);
    }

    const changes: InventorySlotDelta[] = [];
    for (const [itemId, required] of requiredByItem) {
      let remaining = required;
      for (const slot of this.inventorySlots()) {
        if (remaining <= 0) break;
        const key = addressKey(slot.address);
        const stack = working.get(key);
        if (stack?.itemId !== itemId) continue;
        const consumed = Math.min(stack.count, remaining);
        changes.push({
          slot: slot.address,
          itemId,
          ...(stack.skinId === undefined ? {} : { skinId: stack.skinId }),
          delta: -consumed,
        });
        stack.count -= consumed;
        remaining -= consumed;
        if (stack.count === 0) working.set(key, null);
      }
      if (remaining > 0) return false;
    }

    if (product) {
      let productsRemaining = recipe.productCount;
      for (const slot of this.inventorySlots()) {
        if (productsRemaining <= 0) break;
        const key = addressKey(slot.address);
        const stack = working.get(key);
        if (!stack
          || !isSameStack(stack, recipe.productId, skinId)
          || stack.count >= product.maxStack) continue;
        const added = Math.min(productsRemaining, product.maxStack - stack.count);
        changes.push({
          slot: slot.address,
          itemId: recipe.productId,
          ...(skinId === undefined ? {} : { skinId }),
          delta: added,
        });
        stack.count += added;
        productsRemaining -= added;
      }
      for (const slot of this.inventorySlots()) {
        if (productsRemaining <= 0) break;
        const key = addressKey(slot.address);
        if (working.get(key)) continue;
        const added = Math.min(productsRemaining, product.maxStack);
        changes.push({
          slot: slot.address,
          itemId: recipe.productId,
          ...(skinId === undefined ? {} : { skinId }),
          delta: added,
        });
        working.set(key, {
          itemId: recipe.productId,
          ...(skinId === undefined ? {} : { skinId }),
          count: added,
        });
        productsRemaining -= added;
      }
      if (productsRemaining > 0) return false;
    }

    if (recipe.buffered) this.bufferedBuilds.add(recipe.recipeId);
    const crafted = this.applySlotChanges(changes);
    if (!crafted && recipe.buffered) this.bufferedBuilds.delete(recipe.recipeId);
    if (crafted && changes.length === 0) this.notify([]);
    return crafted;
  }

  applySlotChanges(changes: readonly InventorySlotDelta[]): boolean {
    if (changes.length === 0) return true;
    const next = this.snapshot();

    for (const change of changes) {
      if (!Number.isSafeInteger(change.delta) || change.delta === 0) return false;
      const spec = this.itemSpecs.get(change.itemId);
      const slot = this.slotByAddress.get(addressKey(change.slot));
      if (!spec || !slot) return false;

      const key = addressKey(slot.address);
      const current = next.get(key) ?? null;
      if (change.delta < 0) {
        if (!current
          || !isSameStack(current, change.itemId, change.skinId)
          || current.count < -change.delta) return false;
        const nextCount = current.count + change.delta;
        next.set(key, nextCount === 0 ? null : { ...current, count: nextCount });
        continue;
      }

      if (!slot.accepts(spec)) return false;
      if (current && !isSameStack(current, change.itemId, change.skinId)) return false;
      const nextCount = (current?.count ?? 0) + change.delta;
      if (nextCount > spec.maxStack) return false;
      next.set(key, {
        itemId: change.itemId,
        ...(change.skinId === undefined ? {} : { skinId: change.skinId }),
        count: nextCount,
      });
    }

    const changed = new Map<string, SlotAddress>();
    for (const { slot: address } of changes) {
      const key = addressKey(address);
      this.slotByAddress.get(key)!.set(next.get(key) ?? null);
      changed.set(key, cloneAddress(address));
    }
    this.notify([...changed.values()]);
    return true;
  }

  private inventorySlots(): readonly InventorySlot[] {
    return this.slots.filter((slot): slot is InventorySlot => slot instanceof InventorySlot);
  }

  private snapshot(): Map<string, InventoryStack | null> {
    return new Map(this.slots.map((slot) => [addressKey(slot.address), slot.get()]));
  }

  private notify(changedSlots: readonly SlotAddress[]): void {
    this.listeners.forEach((listener) => listener(changedSlots));
  }

  private requireItemSpec(itemId: string): InventoryItemSpec {
    const spec = this.itemSpecs.get(itemId);
    if (!spec) throw new Error(`Unknown inventory item: ${itemId}`);
    return spec;
  }
}
