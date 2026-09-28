export type EquipmentKind = 'hand' | 'body' | 'head';

export interface SlotAddress {
  containerId: string;
  slotKey: string;
}

export interface InventoryItemSpec {
  name: string;
  maxStack: number;
  icon: string;
  atlas?: string;
  equippable?: EquipmentKind;
}

export interface InventorySkinSpec {
  readonly name: string;
  readonly icon: string;
  readonly atlas: string;
}

export interface InventoryStack {
  itemId: string;
  skinId?: string;
  count: number;
}

export type InventoryItems = readonly (InventoryStack | null)[];

export interface InventorySlotDelta {
  slot: SlotAddress;
  itemId: string;
  skinId?: string;
  delta: number;
}

export interface SlotRegistration<TSlot = unknown> {
  readonly address: SlotAddress;
  readonly slot: TSlot;
}

export interface InventoryRecipeDefinition {
  readonly recipeId: string;
  readonly productId: string;
  readonly productCount: number;
  readonly productSkinId?: string;
  readonly ingredients: Readonly<Record<string, number>>;
  readonly buffered: boolean;
}

export type InventoryListener = (changedSlots: readonly SlotAddress[]) => void;
