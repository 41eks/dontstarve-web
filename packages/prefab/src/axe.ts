import type { ItemEntity } from '@dontstarve-web/inventory';
import type { EquipmentLifecycle } from '@dontstarve-web/signals';
import { Tool } from '../../componets/src/tool';
import type { EquipmentVisualFactory } from './equipmentVisual';
import { FiniteUsesToolLifecycle, heldToolVisual } from './pickaxe';

export const AXE_USES = 100; // tuning.lua AXE_USES.

export type AxeTool = 'axe' | 'goldenaxe' | 'moonglassaxe';
export function isAxeTool(value: string): value is AxeTool {
  return value === 'axe' || value === 'goldenaxe' || value === 'moonglassaxe';
}

/**
 * axe.lua MakeAxe: the tool component chops with `effectiveness` and finiteuses wears by `consumption`.
 * Golden axes use 1 / GOLDENTOOLFACTOR; moonglass uses TUNING.MOONGLASSAXE.
 */
const AXE_TUNING: Readonly<Record<AxeTool, { effectiveness: number; consumption: number }>> = {
  axe: { effectiveness: 1, consumption: 1 },
  goldenaxe: { effectiveness: 1, consumption: .25 },
  moonglassaxe: { effectiveness: 2.5, consumption: 1.25 },
};

export function getAxeLifecycle(entity: ItemEntity): EquipmentLifecycle {
  return entity.component('axe', () => new FiniteUsesToolLifecycle(entity));
}

export function configureAxeEntity(entity: ItemEntity): void {
  const tuning = AXE_TUNING[entity.prefab as AxeTool];
  entity.components.finiteuses.setMaxUses(AXE_USES);
  entity.components.finiteuses.setConsumption('CHOP', tuning.consumption);
  entity.components.tool = entity.component('tool', () => {
    const tool = new Tool(entity);
    tool.SetAction('CHOP', tuning.effectiveness);
    return tool;
  });
  entity.addTag('sharp');
  getAxeLifecycle(entity);
}

const AXE_SWAP: Readonly<Record<AxeTool, { archive: string; symbol: string }>> = {
  axe: { archive: 'swap_axe.zip', symbol: 'swap_axe' },
  goldenaxe: { archive: 'swap_goldenaxe.zip', symbol: 'swap_goldenaxe' },
  moonglassaxe: { archive: 'swap_glassaxe.zip', symbol: 'swap_glassaxe' },
};

/** axe.lua: swap_object uses swap_build / sym_name, distinct from the ground bank and build. */
export const axeVisual: EquipmentVisualFactory = item => heldToolVisual(item, AXE_SWAP[item.prefab as AxeTool]);
