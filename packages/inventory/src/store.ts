import { craft as craftInventoryItems } from './craft';
import { InventorySlot, StorageSlot, type ItemSlot } from './slots';
import type {
  InventoryItemSpec,
  InventoryListener,
  InventoryRecipeDefinition,
  InventorySkinSpec,
  InventorySlotDelta,
  InventoryStack,
  SlotRegistration,
  SlotAddress,
} from './types';

type RegisteredItemSlot = SlotRegistration<ItemSlot>;
type RegisteredInventorySlot = SlotRegistration<InventorySlot>;

function addressKey(address: SlotAddress): string {
  return `${address.containerId}\n${address.slotKey}`;
}

function cloneAddress(address: SlotAddress): SlotAddress {
  return { ...address };
}

function isSameStack(stack: InventoryStack, itemId: string, skinId?: string): boolean {
  return stack.itemId === itemId && stack.skinId === skinId;
}

function stacksEqual(left: InventoryStack | null, right: InventoryStack | null): boolean {
  return left === null
    ? right === null
    : right !== null
      && left.itemId === right.itemId
      && left.skinId === right.skinId
      && left.count === right.count;
}

export class InventoryStore {
  private readonly bufferedBuilds = new Map<string, string | undefined>();
  private readonly itemSpecs = new Map<string, InventoryItemSpec>();
  private readonly listeners = new Set<InventoryListener>();
  private readonly skinSpecs: Readonly<Record<string, InventorySkinSpec>>;
  private readonly registrationByAddress = new Map<string, RegisteredItemSlot>();
  private readonly registrations: RegisteredItemSlot[] = [];

  constructor(
    registrations: readonly RegisteredItemSlot[],
    itemSpecs: Readonly<Record<string, InventoryItemSpec>>,
    skinSpecs: Readonly<Record<string, InventorySkinSpec>> = {},
  ) {
    this.skinSpecs = skinSpecs;
    Object.entries(itemSpecs).forEach(([itemId, spec]) => this.itemSpecs.set(itemId, spec));
    this.registerSlots(registrations);
  }

  registerSlots(registrations: readonly RegisteredItemSlot[]): void {
    const pendingKeys = new Set<string>();
    const pending = registrations.map(({ address, slot }) => ({
      address: cloneAddress(address),
      slot,
    }));
    for (const registration of pending) {
      const { address, slot } = registration;
      const key = addressKey(address);
      if (this.registrationByAddress.has(key) || pendingKeys.has(key)) {
        throw new RangeError(`Duplicate slot address: ${key}`);
      }
      pendingKeys.add(key);
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
    for (const registration of pending) {
      this.registrations.push(registration);
      this.registrationByAddress.set(addressKey(registration.address), registration);
    }
  }

  subscribe(listener: InventoryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get(address: SlotAddress): InventoryStack | null {
    return this.registrationByAddress.get(addressKey(address))?.slot.get() ?? null;
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
    return this.registrations.reduce((total, { slot }) => {
      if (slot instanceof StorageSlot) return total;
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
    return [...this.bufferedBuilds.keys()];
  }

  isBuffered(recipeId: string): boolean {
    return this.bufferedBuilds.has(recipeId);
  }

  bufferedSkin(recipeId: string): string | undefined {
    return this.bufferedBuilds.get(recipeId);
  }

  takeBuffered(recipeId: string): boolean {
    if (!this.bufferedBuilds.delete(recipeId)) return false;
    this.notify([]);
    return true;
  }

  takeItem(itemId: string): boolean {
    const registration = this.registrations.find(({ slot }) => slot.get()?.itemId === itemId);
    const stack = registration?.slot.get();
    if (!registration || !stack) return false;
    return this.applySlotChanges([{
      slot: registration.address,
      itemId,
      ...(stack.skinId === undefined ? {} : { skinId: stack.skinId }),
      delta: -1,
    }]);
  }

  addresses(): readonly SlotAddress[] {
    return this.registrations.map(({ address }) => cloneAddress(address));
  }

  add(itemId: string, count: number, skinId?: string): boolean {
    const spec = this.itemSpecs.get(itemId);
    if (!spec || !Number.isSafeInteger(count) || count <= 0) return false;

    const working = this.snapshot();
    const changes: InventorySlotDelta[] = [];
    let remaining = count;

    for (const { address } of this.inventorySlots()) {
      if (remaining <= 0) break;
      const key = addressKey(address);
      const stack = working.get(key);
      if (!stack || !isSameStack(stack, itemId, skinId) || stack.count >= spec.maxStack) continue;
      const added = Math.min(remaining, spec.maxStack - stack.count);
      changes.push({
        slot: address,
        itemId,
        ...(skinId === undefined ? {} : { skinId }),
        delta: added,
      });
      stack.count += added;
      remaining -= added;
    }

    for (const { address } of this.inventorySlots()) {
      if (remaining <= 0) break;
      const key = addressKey(address);
      if (working.get(key)) continue;
      const added = Math.min(remaining, spec.maxStack);
      changes.push({
        slot: address,
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
    if (recipe.buffered && this.isBuffered(recipe.recipeId)) return false;
    const slots = this.inventorySlots();
    const current = slots.map(({ slot }) => slot.get());
    const next = craftInventoryItems(
      skinId === undefined ? recipe : { ...recipe, productSkinId: skinId },
      slots.map(({ slot }) => slot),
    );
    if (!next) return false;

    const changed: SlotAddress[] = [];
    slots.forEach(({ address, slot }, index) => {
      const stack = next[index] ?? null;
      if (stacksEqual(current[index] ?? null, stack)) return;
      slot.set(stack);
      changed.push(cloneAddress(address));
    });
    if (recipe.buffered) {
      this.bufferedBuilds.set(recipe.recipeId, skinId ?? recipe.productSkinId);
    }
    this.notify(changed);
    return true;
  }

  applySlotChanges(changes: readonly InventorySlotDelta[]): boolean {
    if (changes.length === 0) return true;
    const next = this.snapshot();

    for (const change of changes) {
      if (!Number.isSafeInteger(change.delta) || change.delta === 0) return false;
      const spec = this.itemSpecs.get(change.itemId);
      const registration = this.registrationByAddress.get(addressKey(change.slot));
      if (!spec || !registration) return false;

      const { address, slot } = registration;
      const key = addressKey(address);
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
    for (const change of changes) {
      const registration = this.registrationByAddress.get(addressKey(change.slot))!;
      const key = addressKey(registration.address);
      registration.slot.set(next.get(key) ?? null);
      changed.set(key, cloneAddress(registration.address));
    }
    this.notify([...changed.values()]);
    return true;
  }

  private inventorySlots(): readonly RegisteredInventorySlot[] {
    return this.registrations.filter(
      (registration): registration is RegisteredInventorySlot => (
        registration.slot instanceof InventorySlot
      ),
    );
  }

  private snapshot(): Map<string, InventoryStack | null> {
    return new Map(this.registrations.map(({ address, slot }) => [addressKey(address), slot.get()]));
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
