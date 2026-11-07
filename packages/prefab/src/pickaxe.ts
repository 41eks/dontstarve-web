import type { ItemEntity } from '@dontstarve-web/inventory';
import type { EquipmentVisualFactory } from './equipmentVisual';
import { AddFiniteUses, AddTool, AddWeapon, GOLDENTOOLFACTOR, heldToolVisual, WILSON_ATTACK } from './handTool';

export const PICKAXE_USES = 33; // tuning.lua PICKAXE_USES
const PICK_DAMAGE = WILSON_ATTACK * .8; // tuning.lua PICK_DAMAGE

export type PickaxeTool = 'pickaxe' | 'goldenpickaxe';
export function isPickaxeTool(value: string): value is PickaxeTool {
  return value === 'pickaxe' || value === 'goldenpickaxe';
}

/**
 * pickaxe.lua MakePickaxe fn, with gold_master_postinit for goldenpickaxe. Equippable's onequip / onunequip draw
 * swap_object (`pickaxeVisual`).
 */
export function configurePickaxeEntity(inst: ItemEntity): void {
  inst.addTag('sharp');
  const weapon = AddWeapon(inst, PICK_DAMAGE, true);
  AddTool(inst, 'MINE');
  AddFiniteUses(inst, PICKAXE_USES, 'MINE');
  if (inst.prefab === 'goldenpickaxe') {
    inst.components.finiteuses.setConsumption('MINE', 1 / GOLDENTOOLFACTOR);
    weapon.attackwear = 1 / GOLDENTOOLFACTOR;
  }
}

const PICKAXE_SWAP: Readonly<Record<PickaxeTool, { archive: string; symbol: string }>> = {
  pickaxe: { archive: 'swap_pickaxe.zip', symbol: 'swap_pickaxe' },
  goldenpickaxe: { archive: 'swap_goldenpickaxe.zip', symbol: 'swap_goldenpickaxe' },
};

/** pickaxe.lua: swap_object uses swap_pickaxe / swap_goldenpickaxe, distinct from the ground art. */
export const pickaxeVisual: EquipmentVisualFactory = item => heldToolVisual(item, PICKAXE_SWAP[item.prefab as PickaxeTool]);
