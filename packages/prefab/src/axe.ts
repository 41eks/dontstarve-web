import type { ItemEntity } from '@dontstarve-web/inventory';
import type { EquipmentVisualFactory } from './equipmentVisual';
import { AddFiniteUses, AddTool, AddWeapon, GOLDENTOOLFACTOR, heldToolVisual, WILSON_ATTACK } from './handTool';

export const AXE_USES = 100; // tuning.lua AXE_USES
const AXE_DAMAGE = WILSON_ATTACK * .8; // tuning.lua AXE_DAMAGE
/** tuning.lua MOONGLASSAXE: EFFECTIVENESS, CONSUMPTION, DAMAGE = wilson_attack, ATTACKWEAR. */
const MOONGLASSAXE = { EFFECTIVENESS: 2.5, CONSUMPTION: 1.25, DAMAGE: WILSON_ATTACK, ATTACKWEAR: 2 } as const;

export type AxeTool = 'axe' | 'goldenaxe' | 'moonglassaxe';
export function isAxeTool(value: string): value is AxeTool {
  return value === 'axe' || value === 'goldenaxe' || value === 'moonglassaxe';
}

/**
 * axe.lua MakeAxe fn, with gold_master_postinit for goldenaxe and glass_master_postinit for moonglassaxe. Equippable's
 * onequip / onunequip draw swap_object (`axeVisual`).
 */
export function configureAxeEntity(inst: ItemEntity): void {
  inst.addTag('sharp');
  inst.addTag('possessable_axe');
  const tool = AddTool(inst, 'CHOP', 1);
  AddFiniteUses(inst, AXE_USES, 'CHOP');
  const weapon = AddWeapon(inst, AXE_DAMAGE, true);
  if (inst.prefab === 'goldenaxe') {
    inst.components.finiteuses.setConsumption('CHOP', 1 / GOLDENTOOLFACTOR);
    weapon.attackwear = 1 / GOLDENTOOLFACTOR;
  } else if (inst.prefab === 'moonglassaxe') {
    tool.SetAction('CHOP', MOONGLASSAXE.EFFECTIVENESS);
    inst.components.finiteuses.setConsumption('CHOP', MOONGLASSAXE.CONSUMPTION);
    weapon.SetDamage(MOONGLASSAXE.DAMAGE);
    // onattack_moonglass's SHADOW_WEAR against pure shadow targets and the damagetypebonus are not ported.
    weapon.attackwear = MOONGLASSAXE.ATTACKWEAR;
  }
}

const AXE_SWAP: Readonly<Record<AxeTool, { archive: string; symbol: string }>> = {
  axe: { archive: 'swap_axe.zip', symbol: 'swap_axe' },
  goldenaxe: { archive: 'swap_goldenaxe.zip', symbol: 'swap_goldenaxe' },
  moonglassaxe: { archive: 'swap_glassaxe.zip', symbol: 'swap_glassaxe' },
};

/** axe.lua: swap_object uses swap_build / sym_name, distinct from the ground bank and build. */
export const axeVisual: EquipmentVisualFactory = item => heldToolVisual(item, AXE_SWAP[item.prefab as AxeTool]);
