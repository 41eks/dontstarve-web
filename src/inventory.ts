import {
  INVENTORY_PRODUCT_SPECS,
  PLAYER_EQUIPMENT_CONTAINER_ID,
  PLAYER_INVENTORY_CONTAINER_ID,
  equipmentSlotAddress,
  inventorySlotAddress,
  type EquipmentKind,
  type InventoryRecipeDefinition,
  type SlotAddress,
} from '@three-roaming/ui';

export type { EquipmentKind } from '@three-roaming/ui';

export const INVENTORY_SLOT_COUNT = 15;

export interface InventoryItemDefinition {
  slot_index: number;
  id: string;
  num: number;
}

export interface InventoryItemSpec {
  name: string;
  maxStack: number;
  icon: string;
  atlas?: string;
  equippable?: EquipmentKind;
}

export interface InventoryStack {
  itemId: string;
  count: number;
}

export interface InventorySlotDelta {
  slot: SlotAddress;
  itemId: string;
  delta: number;
}

export type InventoryListener = (changedSlots: readonly SlotAddress[]) => void;

export const INVENTORY_ITEM_DEFINITIONS: readonly InventoryItemDefinition[] = [
  {
    slot_index: 0,
    id: 'cutgrass',
    num: 3,
  },
  {
    slot_index: 1,
    id: 'twigs',
    num: 17,
  },
  {
    slot_index: 2,
    id: 'torch',
    num: 1,
  },
  {
    slot_index: 3,
    id: 'goldnugget',
    num: 1,
  },
  {
    slot_index: 4,
    id: 'log',
    num: 4,
  },
  {
    slot_index: 5,
    id: 'rocks',
    num: 4,
  },
];

const DEFAULT_CRAFTED_ITEM_MAX_STACK = 40;

const GENERATED_INVENTORY_ITEM_SPECS: Readonly<Record<string, InventoryItemSpec>> =
  Object.fromEntries(Object.entries(INVENTORY_PRODUCT_SPECS).map(([itemId, spec]) => [itemId, {
    name: spec.name,
    maxStack: DEFAULT_CRAFTED_ITEM_MAX_STACK,
    icon: spec.icon,
    ...(spec.atlas ? { atlas: spec.atlas } : {}),
  }]));

const INVENTORY_ITEM_SPEC_OVERRIDES: Readonly<Record<string, InventoryItemSpec>> = {
  meatballs: {
    name: '肉丸',
    maxStack: 40,
    icon: 'meatballs.tex',
  },
  cutgrass: {
    name: '草',
    maxStack: 40,
    icon: 'cutgrass.tex',
  },
  twigs: {
    name: '树枝',
    maxStack: 40,
    icon: 'twigs.tex',
  },
  torch: {
    name: '火炬',
    maxStack: 1,
    icon: 'torch.tex',
    equippable: 'hand',
  },
  goldnugget: {
    name: '金块',
    maxStack: 40,
    icon: 'goldnugget.tex',
  },
  log: {
    name: '木头',
    maxStack: 20,
    icon: 'log.tex',
  },
  rocks: {
    name: '石头',
    maxStack: 40,
    icon: 'rocks.tex',
  },
};

const INVENTORY_ITEM_SPECS: Readonly<Record<string, InventoryItemSpec>> = {
  ...GENERATED_INVENTORY_ITEM_SPECS,
  ...INVENTORY_ITEM_SPEC_OVERRIDES,
};

const equipmentKinds: readonly EquipmentKind[] = ['hand', 'body', 'head'];

function cloneAddress(address: SlotAddress): SlotAddress {
  return { ...address };
}

function addressKey(address: SlotAddress): string {
  return `${address.containerId}\n${address.slotKey}`;
}

export class InventoryStore {
  private readonly bufferedBuilds = new Set<string>();
  private equipment: Record<EquipmentKind, InventoryStack | null> = {
    hand: null,
    body: null,
    head: null,
  };

  private readonly itemSpecs = new Map<string, InventoryItemSpec>();
  private readonly listeners = new Set<InventoryListener>();
  private slots: (InventoryStack | null)[] = Array.from(
    { length: INVENTORY_SLOT_COUNT },
    () => null,
  );

  constructor(
    definitions: readonly InventoryItemDefinition[],
    itemSpecs: Readonly<Record<string, InventoryItemSpec>> = INVENTORY_ITEM_SPECS,
  ) {
    Object.entries(itemSpecs).forEach(([itemId, spec]) => this.itemSpecs.set(itemId, spec));
    for (const definition of definitions) {
      if (!Number.isInteger(definition.slot_index)
        || definition.slot_index < 0
        || definition.slot_index >= INVENTORY_SLOT_COUNT) {
        throw new RangeError(`Invalid inventory slot index: ${definition.slot_index}`);
      }
      if (this.slots[definition.slot_index]) {
        throw new RangeError(`Duplicate inventory slot index: ${definition.slot_index}`);
      }
      const spec = this.requireItemSpec(definition.id);
      if (!Number.isSafeInteger(definition.num)
        || definition.num <= 0
        || definition.num > spec.maxStack) {
        throw new RangeError(`Invalid initial count for ${definition.id}: ${definition.num}`);
      }
      this.slots[definition.slot_index] = {
        itemId: definition.id,
        count: definition.num,
      };
    }
  }

  subscribe(listener: InventoryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get(address: SlotAddress): InventoryStack | null {
    const stack = this.readSlot(this.slots, this.equipment, address);
    return stack ? { ...stack } : null;
  }

  getItemSpec(itemId: string): InventoryItemSpec {
    return this.requireItemSpec(itemId);
  }

  count(itemId: string): number {
    let total = 0;
    for (const stack of this.slots) {
      if (stack?.itemId === itemId) total += stack.count;
    }
    for (const kind of equipmentKinds) {
      const stack = this.equipment[kind];
      if (stack?.itemId === itemId) total += stack.count;
    }
    return total;
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

  addresses(): readonly SlotAddress[] {
    return [
      ...Array.from({ length: INVENTORY_SLOT_COUNT }, (_, index) => inventorySlotAddress(index)),
      ...equipmentKinds.map((kind) => equipmentSlotAddress(kind)),
    ];
  }

  add(itemId: string, count: number): boolean {
    const spec = this.itemSpecs.get(itemId);
    if (!spec || !Number.isSafeInteger(count) || count <= 0) return false;

    const workingSlots = this.slots.map((stack) => stack ? { ...stack } : null);
    const changes: InventorySlotDelta[] = [];
    let remaining = count;

    for (let index = 0; index < workingSlots.length && remaining > 0; index += 1) {
      const stack = workingSlots[index];
      if (stack?.itemId !== itemId || stack.count >= spec.maxStack) continue;
      const added = Math.min(remaining, spec.maxStack - stack.count);
      changes.push({
        slot: inventorySlotAddress(index),
        itemId,
        delta: added,
      });
      stack.count += added;
      remaining -= added;
    }

    for (let index = 0; index < workingSlots.length && remaining > 0; index += 1) {
      if (workingSlots[index]) continue;
      const added = Math.min(remaining, spec.maxStack);
      changes.push({
        slot: inventorySlotAddress(index),
        itemId,
        delta: added,
      });
      workingSlots[index] = { itemId, count: added };
      remaining -= added;
    }

    return remaining === 0 && this.applySlotChanges(changes);
  }

  craft(recipe: InventoryRecipeDefinition): boolean {
    if (!Number.isSafeInteger(recipe.productCount) || recipe.productCount <= 0) return false;
    if (recipe.buffered && this.isBuffered(recipe.recipeId)) return false;
    const product = recipe.buffered ? undefined : this.itemSpecs.get(recipe.productId);
    if (!recipe.buffered && !product) return false;

    const workingSlots = this.slots.map((stack) => stack ? { ...stack } : null);
    const requiredByItem = new Map<string, number>();
    for (const [itemId, amount] of Object.entries(recipe.ingredients)) {
      if (!this.itemSpecs.has(itemId) || !Number.isSafeInteger(amount) || amount <= 0) return false;
      requiredByItem.set(itemId, (requiredByItem.get(itemId) ?? 0) + amount);
    }

    const changes: InventorySlotDelta[] = [];
    for (const [itemId, required] of requiredByItem) {
      let remaining = required;
      for (let index = 0; index < workingSlots.length && remaining > 0; index += 1) {
        const stack = workingSlots[index];
        if (stack?.itemId !== itemId) continue;
        const consumed = Math.min(stack.count, remaining);
        changes.push({
          slot: inventorySlotAddress(index),
          itemId,
          delta: -consumed,
        });
        stack.count -= consumed;
        remaining -= consumed;
        if (stack.count === 0) workingSlots[index] = null;
      }
      if (remaining > 0) return false;
    }

    if (product) {
      let productsRemaining = recipe.productCount;
      for (let index = 0; index < workingSlots.length && productsRemaining > 0; index += 1) {
        const stack = workingSlots[index];
        if (stack?.itemId !== recipe.productId || stack.count >= product.maxStack) continue;
        const added = Math.min(productsRemaining, product.maxStack - stack.count);
        changes.push({
          slot: inventorySlotAddress(index),
          itemId: recipe.productId,
          delta: added,
        });
        stack.count += added;
        productsRemaining -= added;
      }
      for (let index = 0; index < workingSlots.length && productsRemaining > 0; index += 1) {
        if (workingSlots[index]) continue;
        const added = Math.min(productsRemaining, product.maxStack);
        changes.push({
          slot: inventorySlotAddress(index),
          itemId: recipe.productId,
          delta: added,
        });
        workingSlots[index] = { itemId: recipe.productId, count: added };
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

    const nextSlots = this.slots.map((stack) => stack ? { ...stack } : null);
    const nextEquipment: Record<EquipmentKind, InventoryStack | null> = {
      hand: this.equipment.hand ? { ...this.equipment.hand } : null,
      body: this.equipment.body ? { ...this.equipment.body } : null,
      head: this.equipment.head ? { ...this.equipment.head } : null,
    };

    for (const change of changes) {
      if (!Number.isSafeInteger(change.delta) || change.delta === 0) return false;
      const spec = this.itemSpecs.get(change.itemId);
      if (!spec || !this.isValidAddress(change.slot)) return false;

      const current = this.readSlot(nextSlots, nextEquipment, change.slot);
      if (change.delta < 0) {
        if (!current || current.itemId !== change.itemId || current.count < -change.delta) {
          return false;
        }
        const nextCount = current.count + change.delta;
        this.writeSlot(
          nextSlots,
          nextEquipment,
          change.slot,
          nextCount === 0 ? null : { itemId: change.itemId, count: nextCount },
        );
        continue;
      }

      if (change.slot.containerId === PLAYER_EQUIPMENT_CONTAINER_ID
        && spec.equippable !== change.slot.slotKey) {
        return false;
      }
      if (current && current.itemId !== change.itemId) return false;
      const nextCount = (current?.count ?? 0) + change.delta;
      if (nextCount > spec.maxStack) return false;
      this.writeSlot(nextSlots, nextEquipment, change.slot, {
        itemId: change.itemId,
        count: nextCount,
      });
    }

    this.slots = nextSlots;
    this.equipment = nextEquipment;
    const changed = new Map<string, SlotAddress>();
    changes.forEach(({ slot }) => changed.set(addressKey(slot), cloneAddress(slot)));
    const changedSlots = [...changed.values()];
    this.notify(changedSlots);
    return true;
  }

  private notify(changedSlots: readonly SlotAddress[]): void {
    this.listeners.forEach((listener) => listener(changedSlots));
  }

  private requireItemSpec(itemId: string): InventoryItemSpec {
    const spec = this.itemSpecs.get(itemId);
    if (!spec) throw new Error(`Unknown inventory item: ${itemId}`);
    return spec;
  }

  private isValidAddress(address: SlotAddress): boolean {
    if (address.containerId === PLAYER_INVENTORY_CONTAINER_ID) {
      const index = Number(address.slotKey);
      return Number.isInteger(index)
        && String(index) === address.slotKey
        && index >= 0
        && index < INVENTORY_SLOT_COUNT;
    }
    return address.containerId === PLAYER_EQUIPMENT_CONTAINER_ID
      && equipmentKinds.includes(address.slotKey as EquipmentKind);
  }

  private readSlot(
    slots: readonly (InventoryStack | null)[],
    equipment: Readonly<Record<EquipmentKind, InventoryStack | null>>,
    address: SlotAddress,
  ): InventoryStack | null {
    if (!this.isValidAddress(address)) return null;
    return address.containerId === PLAYER_INVENTORY_CONTAINER_ID
      ? slots[Number(address.slotKey)]
      : equipment[address.slotKey as EquipmentKind];
  }

  private writeSlot(
    slots: (InventoryStack | null)[],
    equipment: Record<EquipmentKind, InventoryStack | null>,
    address: SlotAddress,
    value: InventoryStack | null,
  ): void {
    if (address.containerId === PLAYER_INVENTORY_CONTAINER_ID) {
      slots[Number(address.slotKey)] = value;
    } else {
      equipment[address.slotKey as EquipmentKind] = value;
    }
  }
}
