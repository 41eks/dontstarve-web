import type { ReadonlySignal } from '@dontstarve-web/signals';

export type EquipmentKind = 'hand' | 'body' | 'head';

/** Live component state owned by an inventory entity, shared with every presentation. */
export interface InventoryItemSignals {
  readonly count: ReadonlySignal<number>;
  readonly durabilityPercent: ReadonlySignal<number | undefined>;
  readonly freshnessPercent: ReadonlySignal<number | undefined>;
  readonly wet: ReadonlySignal<boolean>;
}

export type { HandEquipment, HeadEquipment, BodyEquipment } from '@dontstarve-web/signals';

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
  canGoInContainer?: boolean;
  maxUses?: number;
  /** Smallest saved durability increment; golden tools consume fractional source uses. */
  useStep?: number;
  /** Prefab-owned component initialization, applied to each inventory/world inst. */
  configureEntity?: (entity: import('./entity').ItemEntity) => void;
  /** armor:InitCondition amount; bounds a saved armor condition. */
  maxArmor?: number;
  /** Full fuel duration in seconds. Missing stack fuel means a fresh item. */
  maxFuel?: number;
  /** perishable:SetPerishTime in seconds. Missing stack freshness means a fresh item. */
  perishTime?: number;
  /** perishable.onperishreplacement prefab. */
  perishReplacement?: string;
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

export interface ItemContainerState {
  slotCount: number;
  slots: { slotKey: string; item: InventoryStack }[];
}

export interface InventoryStack {
  /** mole.lua health, home delay and carried inventory; transient stategraph states are not saved. */
  mole?: { health: number; needsHomeElapsed?: number; items: InventoryStack[] };
  lightflier?: { health: number; age: number; homeId?: string; knownHome?: [number, number, number] };
  /** temperature.lua and heatrock.lua persistence; presentation range is rebuilt on load. */
  temperature?: import('../../componets/src/temperature').TemperatureSaveData;
  highTemp?: number;
  lowTemp?: number;
  /** armor.lua OnSave: present only while damaged. */
  armor?: import('../../componets/src/armor').ArmorSaveData;
  /** Container belongs to this item, including when it is on the ground. */
  container?: ItemContainerState;
  /** Persistent inst identity; absent in old saves and detached UI projections. */
  entityId?: string;
  itemId: string;
  skinId?: string;
  /** Source-saved ground pose or symbol variant. */
  variant?: string;
  count: number;
  remainingUses?: number;
  remainingFuel?: number;
  freshnessPercent?: number;
  wet?: boolean;
  /** Loaded record: `record` means the base track; other values are record skin IDs. */
  phonographRecord?: string;
}

export type InventoryItems = readonly (InventoryStack | null)[];

export type InventoryMaterialSummary = Readonly<Record<string, number>>;

export interface InventorySlotDelta {
  entityId?: string;
  variant?: string;
  slot: SlotAddress;
  itemId: string;
  skinId?: string;
  delta: number;
  remainingUses?: number;
  remainingFuel?: number;
  freshnessPercent?: number;
  wet?: boolean;
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
