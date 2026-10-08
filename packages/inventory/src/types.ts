export type EquipmentKind = 'hand' | 'body' | 'head';

export type { HandEquipment } from '@dontstarve-web/signals';

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
  maxUses?: number;
  /** Full fuel duration in seconds. Missing stack fuel means a fresh item. */
  maxFuel?: number;
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
  /** Persistent inst identity; absent in old saves and detached UI projections. */
  entityId?: string;
  itemId: string;
  skinId?: string;
  count: number;
  remainingUses?: number;
  remainingFuel?: number;
  /** Loaded record: `record` means the base track; other values are record skin IDs. */
  phonographRecord?: string;
}

export type InventoryItems = readonly (InventoryStack | null)[];

export type InventoryMaterialSummary = Readonly<Record<string, number>>;

export interface InventorySlotDelta {
  entityId?: string;
  slot: SlotAddress;
  itemId: string;
  skinId?: string;
  delta: number;
  remainingUses?: number;
  remainingFuel?: number;
  phonographRecord?: string;
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
