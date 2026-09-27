import { equipmentSlotAddress, inventorySlotAddress } from './addresses';
import type { EquipmentKind, InventoryItemSpec, InventoryStack, SlotAddress } from './types';

function cloneStack(stack: InventoryStack | null): InventoryStack | null {
  return stack ? { ...stack } : null;
}

export abstract class ItemSlot {
  readonly address: SlotAddress;
  private stack: InventoryStack | null;

  protected constructor(
    address: SlotAddress,
    initialStack: InventoryStack | null = null,
  ) {
    this.address = address;
    this.stack = cloneStack(initialStack);
  }

  get(): InventoryStack | null {
    return cloneStack(this.stack);
  }

  set(stack: InventoryStack | null): void {
    this.stack = cloneStack(stack);
  }

  abstract accepts(spec: InventoryItemSpec): boolean;
}

export class InventorySlot extends ItemSlot {
  readonly index: number;

  constructor(
    index: number,
    initialStack: InventoryStack | null = null,
  ) {
    super(inventorySlotAddress(index), initialStack);
    this.index = index;
  }

  accepts(): boolean {
    return true;
  }
}

export class EquipmentSlot extends ItemSlot {
  readonly equipmentKind: EquipmentKind;

  constructor(
    equipmentKind: EquipmentKind,
    initialStack: InventoryStack | null = null,
  ) {
    super(equipmentSlotAddress(equipmentKind), initialStack);
    this.equipmentKind = equipmentKind;
  }

  accepts(spec: InventoryItemSpec): boolean {
    return spec.equippable === this.equipmentKind;
  }
}
