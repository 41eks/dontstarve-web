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
  // birds.lua gives live birds an inventoryitem but no stackable.
  crow: 1,
  robin: 1,
  robin_winter: 1,
  canary: 1,
  bernie_inactive: 1,
  farm_plow_item: 1,
  phonograph: 1,
  record: 1,
  torch: 1,
  lantern: 1,
  mole: 1, // mole.lua: a live animal has no stackable component.
  heatrock: 1, // heatrock.lua has inventoryitem but no stackable or equippable.
  yellowstaff: 1,
  opalstaff: 1,
  greenstaff: 1,
  trident: 1, // trident.lua has no stackable component.
  reskin_tool: 1,
  bugnet: 1,
  razor: 1, // razor.lua has no stackable component.
  hammer: 1,
  nightsword: 1,
  pickaxe: 1,
  goldenpickaxe: 1,
  axe: 1,
  goldenaxe: 1,
  moonglassaxe: 1,
  pitchfork: 1,
  goldenpitchfork: 1,
  farm_hoe: 1,
  golden_farm_hoe: 1,
  shovel: 1,
  fishingrod: 1,
  goldenshovel: 1,
  book_silviculture: 1,
  book_rain: 1,
  book_moon: 1,
  featherpencil: 20, // featherpencil.lua: TUNING.STACK_SIZE_MEDITEM.
  log: 20,
  cookingrecipecard: 1, // cookingrecipecard.lua has no stackable component.
  blueprint: 1, // blueprint.lua has no stackable component.
  bathbomb: 20, // bathbomb.lua: TUNING.STACK_SIZE_MEDITEM.
  dock_kit: 20, // dock_kit.lua: TUNING.STACK_SIZE_MEDITEM.
  fence_item: 20, // fence.lua MakeInvItem: TUNING.STACK_SIZE_MEDITEM.
  pondfish: 1, // pondfish.lua has no stackable component.
  dug_rock_avocado_bush: 10,
  dug_berrybush: 10,
  dug_monkeytail: 10,
  dug_grass: 10, // plantables.lua: TUNING.STACK_SIZE_LARGEITEM.
  dug_sapling: 10,
  dug_sapling_moon: 10,
  // veggies.lua leaves these raw veggies at stackable's default, STACK_SIZE_MEDITEM.
  pumpkin: 20,
  eggplant: 20,
  durian: 20,
  watermelon: 20,
};

export function inventoryItemMaxStack(itemId: string): number {
  return ITEM_MAX_STACKS[itemId] ?? DEFAULT_MAX_STACK;
}

export function inventoryItemEquipmentKind(itemId: string): EquipmentKind | undefined {
  if (itemId === 'backpack') return 'body';
  return itemId === 'torch' || itemId === 'lantern' || itemId === 'yellowstaff' || itemId === 'opalstaff' || itemId === 'greenstaff' || itemId === 'trident' || itemId === 'bugnet' || itemId === 'fishingrod'
    || itemId === 'hammer' || itemId === 'nightsword' || itemId === 'pickaxe' || itemId === 'goldenpickaxe'
    || itemId === 'axe' || itemId === 'goldenaxe' || itemId === 'moonglassaxe'
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
  private readonly itemTest: (spec: InventoryItemSpec, itemId?: string) => boolean;

  /** `itemTest` is the widget's itemtestfn; chests accept everything that can go in a container. */
  constructor(initialStack: InventoryStack | null = null, itemTest: (spec: InventoryItemSpec, itemId?: string) => boolean = () => true) {
    this.entity = initialStack ? new ItemEntity(initialStack) : null;
    this.itemTest = itemTest;
  }

  get(): InventoryStack | null {
    return this.entity?.snapshot(false) ?? null;
  }

  set(stack: InventoryStack | null): void {
    this.entity = stack ? new ItemEntity(stack) : null;
  }

  getEntity(): ItemEntity | null { return this.entity; }
  setEntity(entity: ItemEntity | null): void { this.entity = entity; }

  accepts(spec: InventoryItemSpec, itemId?: string): boolean {
    return spec.canGoInContainer !== false && this.itemTest(spec, itemId);
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
