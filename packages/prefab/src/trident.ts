import { addComponent } from './components';
import type { ItemEntity } from '@dontstarve-web/inventory';
import type { SpellCastMap } from '@dontstarve-web/stategraphs/castspell';
import type * as THREE from 'three';
import { SpellCaster } from '../../componets/src/spellcaster';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { TILE_SIZE } from './tile';

export const TRIDENT_ID = 'trident';
// tuning.lua: wilson_attack = 34; TRIDENT = { DAMAGE = wilson_attack * 1.5, USES = 200, SPELL = { USE_COUNT = 50, RADIUS = 2.75 } }.
export const TRIDENT_DAMAGE = 34 * 1.5;
export const TRIDENT_USES = 200;
const SPELL_USE_COUNT = 50;
const SPELL_RADIUS = 2.75;
const COST_PER_EXPLOSION = TRIDENT_USES / SPELL_USE_COUNT;
const WORLD_SCALE = TILE_SIZE / 4;
const FX_RADIUS = SPELL_RADIUS * 0.65 * WORLD_SCALE;
export const TRIDENT_STRUM_SOUND = 'hookline_2/characters/trident_attack';

export interface TridentWorld {
  readonly map: SpellCastMap;
  /** SpawnPrefab("crab_king_waterspout") at a point on the water. */
  spawnWaterspout(position: THREE.Vector3): void;
}

/** TheWorld as the trident's spell reads it. */
function tridentWorld(inst: ItemEntity): TridentWorld | undefined {
  return (inst.equipmentWorld as { tridentWorld?: TridentWorld } | undefined)?.tridentWorld;
}

/** on_uses_finished: the owner hears toolbroke before the item removes itself. */
function on_uses_finished(inst: ItemEntity): boolean {
  inst.components.inventoryitem.owner?.PushEvent('toolbroke', { tool: inst });
  return inst.remove();
}

/**
 * create_water_explosion(inst, target, position): waterspouts at four spokes around the point, then the use cost. The
 * water explosion's gameplay effects, boat leaks and farm plant tending are not ported.
 */
function create_water_explosion(inst: ItemEntity, position: THREE.Vector3 | undefined): boolean {
  const world = tridentWorld(inst);
  if (!world || !position || inst.isRemoved || !inst.components.inventoryitem.owner) {
    return false;
  }
  // GetRandomWithVariance(-45, 20)
  let angle = -45 + (Math.random() * 2 - 1) * 20;
  for (let i = 0; i < 4; i++) {
    angle += 90;
    const point = position.clone();
    point.x += FX_RADIUS * Math.cos((angle * Math.PI) / 180);
    point.z -= FX_RADIUS * Math.sin((angle * Math.PI) / 180);
    if (world.map.isOceanAtPoint(point)) {
      world.spawnWaterspout(point);
    }
  }
  return inst.components.finiteuses.use(COST_PER_EXPLOSION);
}

/** trident.lua fn: its tags, finiteuses and a spellcaster usable only on water. Its weapon is the hand definition's. */
export function configureTridentEntity(inst: ItemEntity): void {
  inst.addTag('allow_action_on_impassable');
  inst.addTag('guitar');
  inst.addTag('pointy');
  inst.addTag('sharp');
  if (inst.components.spellcaster) {
    return;
  }
  inst.components.finiteuses.setMaxUses(TRIDENT_USES);
  inst.components.finiteuses.setOnFinished(() => on_uses_finished(inst));
  const spellcaster = addComponent(inst, 'spellcaster', SpellCaster, () => tridentWorld(inst)?.map);
  spellcaster.SetSpellFn((_inst, _target, position) => create_water_explosion(inst, position));
  spellcaster.canUseOnPointWater = true;
}

/** trident.lua on_equipped: swap_object uses swap_trident, or the same symbol of the skin build. SGwilson's play_strum names the plain swap_trident. */
export const tridentVisual: EquipmentVisualFactory = item => {
  const skin = skinArchive('trident', GROUND_ITEM_DEFINITIONS.trident.skinArchives, item.skinId);
  return handEquipmentVisual(item, [...(skin ? [skin] : []), 'swap_trident'], 'swap_trident');
};
