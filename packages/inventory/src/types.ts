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
  readonly itemId?: string;
  readonly name: string;
  readonly icon: string;
  readonly atlas: string;
}

export interface InventoryState {
  slots: readonly { address: SlotAddress; item: InventoryStack | null }[];
  bufferedBuilds: readonly { recipeId: string; skinId?: string }[];
}

export interface InventoryStack {
  itemId: string;
  skinId?: string;
  count: number;
}

export type InventoryItems = readonly (InventoryStack | null)[];

export type InventoryMaterialSummary = Readonly<Record<string, number>>;

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
  /** Must be present in accessible slots, but are not consumed. */
  readonly requiredItems?: readonly string[];
}

export type InventoryListener = (changedSlots: readonly SlotAddress[]) => void;

/** Successful incoming allocations; every delta is the quantity received by that slot. */
export type InventoryReceiveListener = (received: readonly InventorySlotDelta[]) => void;
