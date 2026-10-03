import { craft as craftInventoryItems } from './craft';
import { InventorySlot, StorageSlot, type ItemSlot } from './slots';
import { PreparedFoodSlot } from './preparedFoodSlot';
import type {
  InventoryItemSpec,
  InventoryListener,
  InventoryMaterialSummary,
  InventoryRecipeDefinition,
  InventorySkinSpec,
  InventorySlotDelta,
  InventoryStack,
  SlotRegistration,
  SlotAddress,
  InventoryState,
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
  private readonly accessibleStorageContainerIds = new Set<string>();
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
        || stack.count > Math.min(spec.maxStack, slot.maxStack?.(stack.itemId) ?? spec.maxStack)
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

  /** Exports detached domain data, including inaccessible storage and buffered builds. */
  exportState(): InventoryState {
    return {
      slots: this.registrations.map(({ address, slot }) => {
        const item = slot.get();
        return { address: cloneAddress(address), item: item ? { ...item } : null };
      }),
      bufferedBuilds: [...this.bufferedBuilds].map(([recipeId, skinId]) => ({
        recipeId, ...(skinId === undefined ? {} : { skinId }),
      })),
    };
  }

  /** Validates the whole replacement before updating any slots or notifying UI. */
  replaceState(
    state: InventoryState,
    recipes: Readonly<Record<string, InventoryRecipeDefinition>>,
  ): void {
    const next = new Map<string, InventoryStack | null>(
      this.registrations.map(({ address }) => [addressKey(address), null]),
    );
    const seen = new Set<string>();
    const validateSkin = (itemId: string, skinId?: string) => {
      if (skinId === undefined) return;
      const skin = Object.hasOwn(this.skinSpecs, skinId) ? this.skinSpecs[skinId] : undefined;
      if (!skin || (skin.itemId !== undefined && skin.itemId !== itemId)) {
        throw new Error(`Invalid skin ${skinId} for ${itemId}`);
      }
    };
    for (const { address, item } of state.slots) {
      const key = addressKey(address);
      const registration = this.registrationByAddress.get(key);
      if (!registration || seen.has(key)) throw new Error(`Invalid or duplicate saved slot: ${key}`);
      seen.add(key);
      if (item) {
        const spec = this.requireItemSpec(item.itemId);
        if (!Number.isSafeInteger(item.count) || item.count <= 0
          || item.count > Math.min(spec.maxStack, registration.slot.maxStack?.(item.itemId) ?? spec.maxStack)
          || !registration.slot.accepts(spec)) {
          throw new Error(`Invalid saved item in ${key}`);
        }
        validateSkin(item.itemId, item.skinId);
      }
      next.set(key, item ? { ...item } : null);
    }
    const buffered = new Map<string, string | undefined>();
    for (const build of state.bufferedBuilds) {
      const recipe = recipes[build.recipeId];
      if (!recipe?.buffered || buffered.has(build.recipeId)) {
        throw new Error(`Invalid buffered recipe: ${build.recipeId}`);
      }
      validateSkin(recipe.productId, build.skinId);
      buffered.set(build.recipeId, build.skinId);
    }
    for (const { address, slot } of this.registrations) slot.set(next.get(addressKey(address)) ?? null);
    this.bufferedBuilds.clear();
    for (const [id, skin] of buffered) this.bufferedBuilds.set(id, skin);
    this.notify(this.addresses());
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
      if (slot instanceof StorageSlot || slot instanceof PreparedFoodSlot) return total;
      const stack = slot.get();
      return total + (stack?.itemId === itemId ? stack.count : 0);
    }, 0);
  }

  materialSummary(): InventoryMaterialSummary {
    const summary: Record<string, number> = Object.fromEntries(
      [...this.itemSpecs.keys()].map((itemId) => [itemId, 0]),
    );
    for (const { slot } of this.accessibleMaterialSlots()) {
      const stack = slot.get();
      if (stack) summary[stack.itemId] = (summary[stack.itemId] ?? 0) + stack.count;
    }
    return summary;
  }

  setStorageAccessible(containerId: string, accessible: boolean): void {
    if (!containerId) throw new TypeError('Storage container id must not be empty');
    const changed = accessible
      ? !this.accessibleStorageContainerIds.has(containerId)
      : this.accessibleStorageContainerIds.has(containerId);
    if (!changed) return;
    if (accessible) this.accessibleStorageContainerIds.add(containerId);
    else this.accessibleStorageContainerIds.delete(containerId);
    this.notify([]);
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
    const inventorySlots = this.inventorySlots();
    const ingredientSlots = this.accessibleMaterialSlots().filter(({ slot }) => !(slot instanceof InventorySlot));
    const slots = [...inventorySlots, ...ingredientSlots];
    const current = slots.map(({ slot }) => slot.get());
    const next = craftInventoryItems(
      skinId === undefined ? recipe : { ...recipe, productSkinId: skinId },
      inventorySlots.map(({ slot }) => slot),
      ingredientSlots.map(({ slot }) => slot),
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
      if (nextCount > Math.min(spec.maxStack, slot.maxStack?.(change.itemId) ?? spec.maxStack)) return false;
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

  private accessibleMaterialSlots(): readonly RegisteredItemSlot[] {
    return this.registrations.filter(({ address, slot }) => (
      !(slot instanceof StorageSlot || slot instanceof PreparedFoodSlot)
      || this.accessibleStorageContainerIds.has(address.containerId)
    ));
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
