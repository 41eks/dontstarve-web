import type { InventoryRecipeDefinition } from '@three-roaming/ui';

export const INVENTORY_SLOT_COUNT = 15;

export type EquipmentKind = 'hand' | 'body' | 'head';

export type InventorySlotRef =
  | { group: 'inventory'; index: number }
  | { group: 'equipment'; kind: EquipmentKind };

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
  slot: InventorySlotRef;
  itemId: string;
  delta: number;
}

export type InventoryListener = (changedSlots: readonly InventorySlotRef[]) => void;

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
];

const INVENTORY_ITEM_SPECS: Readonly<Record<string, InventoryItemSpec>> = {
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
};

const equipmentKinds: readonly EquipmentKind[] = ['hand', 'body', 'head'];

function cloneRef(ref: InventorySlotRef): InventorySlotRef {
  return ref.group === 'inventory'
    ? { group: 'inventory', index: ref.index }
    : { group: 'equipment', kind: ref.kind };
}

function slotKey(ref: InventorySlotRef) {
  return ref.group === 'inventory' ? `inventory:${ref.index}` : `equipment:${ref.kind}`;
}

export class InventoryStore {
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

  get(ref: InventorySlotRef): InventoryStack | null {
    const stack = this.readSlot(this.slots, this.equipment, ref);
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

  refs(): readonly InventorySlotRef[] {
    return [
      ...Array.from({ length: INVENTORY_SLOT_COUNT }, (_, index): InventorySlotRef => ({
        group: 'inventory',
        index,
      })),
      ...equipmentKinds.map((kind): InventorySlotRef => ({ group: 'equipment', kind })),
    ];
  }

  craft(recipe: InventoryRecipeDefinition): boolean {
    if (!Number.isSafeInteger(recipe.productCount) || recipe.productCount <= 0) return false;
    const product = this.itemSpecs.get(recipe.productId);
    if (!product) return false;

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
          slot: { group: 'inventory', index },
          itemId,
          delta: -consumed,
        });
        stack.count -= consumed;
        remaining -= consumed;
        if (stack.count === 0) workingSlots[index] = null;
      }
      if (remaining > 0) return false;
    }

    let productsRemaining = recipe.productCount;
    for (let index = 0; index < workingSlots.length && productsRemaining > 0; index += 1) {
      const stack = workingSlots[index];
      if (stack?.itemId !== recipe.productId || stack.count >= product.maxStack) continue;
      const added = Math.min(productsRemaining, product.maxStack - stack.count);
      changes.push({
        slot: { group: 'inventory', index },
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
        slot: { group: 'inventory', index },
        itemId: recipe.productId,
        delta: added,
      });
      workingSlots[index] = { itemId: recipe.productId, count: added };
      productsRemaining -= added;
    }
    if (productsRemaining > 0) return false;

    return this.applySlotChanges(changes);
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
      if (!spec || !this.isValidRef(change.slot)) return false;

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

      if (change.slot.group === 'equipment' && spec.equippable !== change.slot.kind) {
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
    const changed = new Map<string, InventorySlotRef>();
    changes.forEach(({ slot }) => changed.set(slotKey(slot), cloneRef(slot)));
    const changedSlots = [...changed.values()];
    this.listeners.forEach((listener) => listener(changedSlots));
    return true;
  }

  private requireItemSpec(itemId: string): InventoryItemSpec {
    const spec = this.itemSpecs.get(itemId);
    if (!spec) throw new Error(`Unknown inventory item: ${itemId}`);
    return spec;
  }

  private isValidRef(ref: InventorySlotRef): boolean {
    return ref.group === 'inventory'
      ? Number.isInteger(ref.index) && ref.index >= 0 && ref.index < INVENTORY_SLOT_COUNT
      : equipmentKinds.includes(ref.kind);
  }

  private readSlot(
    slots: readonly (InventoryStack | null)[],
    equipment: Readonly<Record<EquipmentKind, InventoryStack | null>>,
    ref: InventorySlotRef,
  ): InventoryStack | null {
    if (!this.isValidRef(ref)) return null;
    return ref.group === 'inventory' ? slots[ref.index] : equipment[ref.kind];
  }

  private writeSlot(
    slots: (InventoryStack | null)[],
    equipment: Record<EquipmentKind, InventoryStack | null>,
    ref: InventorySlotRef,
    value: InventoryStack | null,
  ): void {
    if (ref.group === 'inventory') slots[ref.index] = value;
    else equipment[ref.kind] = value;
  }
}
