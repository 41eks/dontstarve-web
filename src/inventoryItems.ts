import {
  INVENTORY_PRODUCT_SPECS,
  INVENTORY_SKIN_SPECS,
} from '@three-roaming/ui';
import type { InventoryItemSpec } from '@three-roaming/inventory';

export interface InventoryItemDefinition {
  slot_index: number;
  id: string;
  num: number;
}

export const INVENTORY_ITEM_DEFINITIONS: readonly InventoryItemDefinition[] = [
  { slot_index: 0, id: 'cutgrass', num: 3 },
  { slot_index: 1, id: 'twigs', num: 17 },
  { slot_index: 2, id: 'torch', num: 1 },
  { slot_index: 3, id: 'goldnugget', num: 1 },
  { slot_index: 4, id: 'log', num: 20 },
  { slot_index: 5, id: 'rocks', num: 14 },
  { slot_index: 6, id: 'wall_stone_item', num: 14 },
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

export const INVENTORY_ITEM_SPECS: Readonly<Record<string, InventoryItemSpec>> = {
  ...GENERATED_INVENTORY_ITEM_SPECS,
  ...INVENTORY_ITEM_SPEC_OVERRIDES,
};

export { INVENTORY_SKIN_SPECS };
