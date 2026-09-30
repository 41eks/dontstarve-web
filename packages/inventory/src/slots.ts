import type { InventoryItemSpec, InventoryStack } from './types';

function cloneStack(stack: InventoryStack | null): InventoryStack | null {
  return stack ? { ...stack } : null;
}

export interface ItemSlot {
  get(): InventoryStack | null;
  set(stack: InventoryStack | null): void;
  accepts(spec: InventoryItemSpec): boolean;
  maxStack?(itemId: string): number;
}

const DEFAULT_MAX_STACK = 40;
const ITEM_MAX_STACKS: Readonly<Record<string, number>> = {
  torch: 1,
  log: 20,
};

export function inventoryItemMaxStack(itemId: string): number {
  return ITEM_MAX_STACKS[itemId] ?? DEFAULT_MAX_STACK;
}

export function inventoryItemEquipmentKind(itemId: string): 'hand' | undefined {
  return itemId === 'torch' ? 'hand' : undefined;
}

export class InventorySlot implements ItemSlot {
  private stack: InventoryStack | null;

  constructor(initialStack: InventoryStack | null = null) {
    this.stack = cloneStack(initialStack);
  }

  get(): InventoryStack | null {
    return cloneStack(this.stack);
  }

  set(stack: InventoryStack | null): void {
    this.stack = cloneStack(stack);
  }

  accepts(): boolean {
    return true;
  }

  maxStack(itemId: string): number {
    return inventoryItemMaxStack(itemId);
  }
}

export class StorageSlot implements ItemSlot {
  private stack: InventoryStack | null;

  constructor(initialStack: InventoryStack | null = null) {
    this.stack = cloneStack(initialStack);
  }

  get(): InventoryStack | null {
    return cloneStack(this.stack);
  }

  set(stack: InventoryStack | null): void {
    this.stack = cloneStack(stack);
  }

  accepts(): boolean {
    return true;
  }
}

export class HandSlot implements ItemSlot {
  private stack: InventoryStack | null;

  constructor(initialStack: InventoryStack | null = null) {
    this.stack = cloneStack(initialStack);
  }

  get(): InventoryStack | null {
    return cloneStack(this.stack);
  }

  set(stack: InventoryStack | null): void {
    this.stack = cloneStack(stack);
  }

  accepts(spec: InventoryItemSpec): boolean {
    return spec.equippable === 'hand';
  }
}

export class BodySlot implements ItemSlot {
  private stack: InventoryStack | null;

  constructor(initialStack: InventoryStack | null = null) {
    this.stack = cloneStack(initialStack);
  }

  get(): InventoryStack | null {
    return cloneStack(this.stack);
  }

  set(stack: InventoryStack | null): void {
    this.stack = cloneStack(stack);
  }

  accepts(spec: InventoryItemSpec): boolean {
    return spec.equippable === 'body';
  }
}

export class HeadSlot implements ItemSlot {
  private stack: InventoryStack | null;

  constructor(initialStack: InventoryStack | null = null) {
    this.stack = cloneStack(initialStack);
  }

  get(): InventoryStack | null {
    return cloneStack(this.stack);
  }

  set(stack: InventoryStack | null): void {
    this.stack = cloneStack(stack);
  }

  accepts(spec: InventoryItemSpec): boolean {
    return spec.equippable === 'head';
  }
}
