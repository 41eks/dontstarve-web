import { addComponent } from './components';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Tool, type ToolAction } from '../../componets/src/tool';
import { Weapon } from '../../componets/src/weapon';
import { handEquipmentVisual, skinArchive, type EquipmentVisual, type EquipmentVisualItem } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';

/**
 * The component calls a hand tool's fn makes (axe.lua, pickaxe.lua, shovel.lua, hammer.lua, pitchfork.lua, farm_hoe.lua,
 * bugnet.lua, fishingrod.lua). Each is safe to repeat: an item is configured again when its spec is reapplied.
 */

/** tuning.lua wilson_attack. */
export const WILSON_ATTACK = 34;
/** tuning.lua GOLDENTOOLFACTOR: golden tools wear 1 / 4 per use and per attack. */
export const GOLDENTOOLFACTOR = 4;

/** inst:AddComponent("weapon") and SetDamage; weapon:OnAttack wears finiteuses only when the inst has them. */
export function AddWeapon(inst: ItemEntity, damage: number, hasFiniteUses: boolean): Weapon {
  inst.addTag('weapon');
  if (!inst.components.weapon) addComponent(inst, 'weapon', Weapon, () => hasFiniteUses ? inst.components.finiteuses : undefined).SetDamage(damage);
  return inst.components.weapon!;
}

/** inst:AddComponent("tool") and SetAction(action, effectiveness); the component adds the "tool" tag. */
export function AddTool(inst: ItemEntity, action: ToolAction, effectiveness?: number): Tool {
  if (inst.components.tool) return inst.components.tool;
  const tool = addComponent(inst, 'tool', Tool);
  tool.SetAction(action, effectiveness);
  return tool;
}

/** inst:AddComponent("finiteuses"): SetMaxUses, SetUses, SetOnFinished(inst.Remove) and SetConsumption(action, consumption). */
export function AddFiniteUses(inst: ItemEntity, maxUses: number, action?: string, consumption = 1): void {
  const finiteuses = inst.components.finiteuses;
  finiteuses.setMaxUses(maxUses);
  finiteuses.setOnFinished(() => inst.remove());
  if (action !== undefined) finiteuses.setConsumption(action, consumption);
}

/** Held symbols come from the swap build, or from the skin build when the ground item has a skin. */
export function heldToolVisual(item: EquipmentVisualItem, swap: { archive: string; symbol: string }): EquipmentVisual {
  const skin = skinArchive(item.prefab, GROUND_ITEM_DEFINITIONS[item.prefab].skinArchives, item.skinId);
  return handEquipmentVisual(item, [...skin ? [skin] : [], swap.archive], swap.symbol);
}
