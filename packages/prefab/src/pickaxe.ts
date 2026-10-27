import type { ItemEntity } from '@dontstarve-web/inventory';
import type { EquipmentLifecycle } from '@dontstarve-web/signals';
import { Tool } from '../../componets/src/tool';
import { handEquipmentVisual, skinArchive, type EquipmentVisual, type EquipmentVisualFactory, type EquipmentVisualItem } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';

export const PICKAXE_USES = 33; // tuning.lua; gold consumes 1 / GOLDENTOOLFACTOR = .25 per MINE.

/** pickaxe.lua / axe.lua: finiteuses removes the inst; an equipped item clears its injected slot. */
export class FiniteUsesToolLifecycle implements EquipmentLifecycle {
  constructor(entity: ItemEntity) {
    entity.components.finiteuses.setOnFinished(() => entity.isRemoved || entity.remove());
  }
  onequip(): void {}
  onunequip(): void {}
  dispose(): void {}
}

export function getPickaxeLifecycle(entity: ItemEntity): EquipmentLifecycle {
  return entity.component('pickaxe', () => new FiniteUsesToolLifecycle(entity));
}

export function configurePickaxeEntity(entity: ItemEntity): void {
  entity.components.finiteuses.setMaxUses(PICKAXE_USES);
  entity.components.finiteuses.setConsumption('MINE', entity.prefab === 'goldenpickaxe' ? .25 : 1);
  entity.components.tool = entity.component('tool', () => {
    const tool = new Tool(entity);
    tool.SetAction('MINE');
    return tool;
  });
  getPickaxeLifecycle(entity);
}

export type PickaxeTool = 'pickaxe' | 'goldenpickaxe';
export function isPickaxeTool(value: string): value is PickaxeTool {
  return value === 'pickaxe' || value === 'goldenpickaxe';
}

const PICKAXE_SWAP: Readonly<Record<PickaxeTool, { archive: string; symbol: string }>> = {
  pickaxe: { archive: 'swap_pickaxe.zip', symbol: 'swap_pickaxe' },
  goldenpickaxe: { archive: 'swap_goldenpickaxe.zip', symbol: 'swap_goldenpickaxe' },
};

/** Held symbols come from the swap build, or from the skin build when the ground item has a skin. */
export function heldToolVisual(item: EquipmentVisualItem, swap: { archive: string; symbol: string }): EquipmentVisual {
  const skin = skinArchive(item.prefab, GROUND_ITEM_DEFINITIONS[item.prefab].skinArchives, item.skinId);
  return handEquipmentVisual(item, [...skin ? [skin] : [], swap.archive], swap.symbol);
}

/** pickaxe.lua: swap_object uses swap_pickaxe / swap_goldenpickaxe, distinct from the ground art. */
export const pickaxeVisual: EquipmentVisualFactory = item => heldToolVisual(item, PICKAXE_SWAP[item.prefab as PickaxeTool]);
