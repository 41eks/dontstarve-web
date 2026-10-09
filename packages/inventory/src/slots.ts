import { ItemEntity } from './entity';
import type { EquipmentKind, InventoryItemSpec, InventoryStack } from './types';

export interface ItemSlot {
  get(): InventoryStack | null;
  getEntity(): ItemEntity | null;
  setEntity(entity: ItemEntity | null): void;
  set(stack: InventoryStack | null): void;
  accepts(spec: InventoryItemSpec, itemId?: string): boolean;
  maxStack?(itemId: string): number;
}

const DEFAULT_MAX_STACK = 40;
const ITEM_MAX_STACKS: Readonly<Record<string, number>> = {
  backpack: 1,
  bernie_inactive: 1,
  farm_plow_item: 1,
  phonograph: 1,
  record: 1,
  torch: 1,
  lantern: 1,
  yellowstaff: 1,
  opalstaff: 1,
  reskin_tool: 1,
  bugnet: 1,
  hammer: 1,
  pickaxe: 1,
  goldenpickaxe: 1,
  pitchfork: 1,
  goldenpitchfork: 1,
  farm_hoe: 1,
  golden_farm_hoe: 1,
  shovel: 1,
  goldenshovel: 1,
  log: 20,
};

export function inventoryItemMaxStack(itemId: string): number {
  return ITEM_MAX_STACKS[itemId] ?? DEFAULT_MAX_STACK;
}

export function inventoryItemEquipmentKind(itemId: string): EquipmentKind | undefined {
  if (itemId === 'backpack') return 'body';
  return itemId === 'torch' || itemId === 'lantern' || itemId === 'yellowstaff' || itemId === 'opalstaff' || itemId === 'bugnet'
    || itemId === 'hammer' || itemId === 'pickaxe' || itemId === 'goldenpickaxe'
    || itemId === 'pitchfork' || itemId === 'goldenpitchfork' || itemId === 'reskin_tool'
    || itemId === 'farm_hoe' || itemId === 'golden_farm_hoe'
    || itemId === 'shovel' || itemId === 'goldenshovel' ? 'hand' : undefined;
}

export class InventorySlot implements ItemSlot {
  private entity: ItemEntity | null;
  private readonly itemSpecs: Readonly<Record<string, Pick<InventoryItemSpec, 'maxStack'>>>;

  constructor(
    initialStack: InventoryStack | null = null,
    itemSpecs: Readonly<Record<string, Pick<InventoryItemSpec, 'maxStack'>>> = {},
  ) {
    this.entity = initialStack ? new ItemEntity(initialStack) : null;
    this.itemSpecs = itemSpecs;
  }

  get(): InventoryStack | null {
    return this.entity?.snapshot(false) ?? null;
  }

  set(stack: InventoryStack | null): void {
    this.entity = stack ? new ItemEntity(stack) : null;
  }

  getEntity(): ItemEntity | null { return this.entity; }
  setEntity(entity: ItemEntity | null): void { this.entity = entity; }

  accepts(): boolean {
    return true;
  }

  maxStack(itemId: string): number {
    return this.itemSpecs[itemId]?.maxStack ?? inventoryItemMaxStack(itemId);
  }
}

export class StorageSlot implements ItemSlot {
  private entity: ItemEntity | null;

  constructor(initialStack: InventoryStack | null = null) {
    this.entity = initialStack ? new ItemEntity(initialStack) : null;
  }

  get(): InventoryStack | null {
    return this.entity?.snapshot(false) ?? null;
  }

  set(stack: InventoryStack | null): void {
    this.entity = stack ? new ItemEntity(stack) : null;
  }

  getEntity(): ItemEntity | null { return this.entity; }
  setEntity(entity: ItemEntity | null): void { this.entity = entity; }

  accepts(spec: InventoryItemSpec): boolean {
    return spec.canGoInContainer !== false;
  }
}

export class HandSlot implements ItemSlot {
  private entity: ItemEntity | null;

  constructor(initialStack: InventoryStack | null = null) {
    this.entity = initialStack ? new ItemEntity(initialStack) : null;
  }

  get(): InventoryStack | null {
    return this.entity?.snapshot(false) ?? null;
  }

  set(stack: InventoryStack | null): void {
    this.entity = stack ? new ItemEntity(stack) : null;
  }

  getEntity(): ItemEntity | null { return this.entity; }
  setEntity(entity: ItemEntity | null): void { this.entity = entity; }

  accepts(spec: InventoryItemSpec): boolean {
    return spec.equippable === 'hand';
  }
}

export class BodySlot implements ItemSlot {
  private entity: ItemEntity | null;

  constructor(initialStack: InventoryStack | null = null) {
    this.entity = initialStack ? new ItemEntity(initialStack) : null;
  }

  get(): InventoryStack | null {
    return this.entity?.snapshot(false) ?? null;
  }

  set(stack: InventoryStack | null): void {
    this.entity = stack ? new ItemEntity(stack) : null;
  }

  getEntity(): ItemEntity | null { return this.entity; }
  setEntity(entity: ItemEntity | null): void { this.entity = entity; }

  accepts(spec: InventoryItemSpec): boolean {
    return spec.equippable === 'body';
  }
}

export class HeadSlot implements ItemSlot {
  private entity: ItemEntity | null;

  constructor(initialStack: InventoryStack | null = null) {
    this.entity = initialStack ? new ItemEntity(initialStack) : null;
  }

  get(): InventoryStack | null {
    return this.entity?.snapshot(false) ?? null;
  }

  set(stack: InventoryStack | null): void {
    this.entity = stack ? new ItemEntity(stack) : null;
  }

  getEntity(): ItemEntity | null { return this.entity; }
  setEntity(entity: ItemEntity | null): void { this.entity = entity; }

  accepts(spec: InventoryItemSpec): boolean {
    return spec.equippable === 'head';
  }
}
