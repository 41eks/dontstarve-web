import { addComponent } from './components';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { FishingRod } from '../../componets/src/fishingrod';
import type { Vector3 } from 'three';
import type { HookedFish } from '../../componets/src/fishable';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { AddFiniteUses, AddWeapon, WILSON_ATTACK } from './handTool';

export const FISHINGROD_ID = 'fishingrod';
/** tuning.lua FISHINGROD_USES; the wait and strain windows are set by fishingrod.lua. */
export const FISHINGROD_USES = 9;
export const FISHINGROD_WAIT_TIMES = [4, 40] as const;
export const FISHINGROD_STRAIN_TIMES = [0, 5] as const;
/** SGwilson.lua fishing states. */
export const FISHING_SOUNDS = [
  'dontstarve/common/fishingpole_cast',
  'dontstarve/common/fishingpole_baitsplash',
  'dontstarve/common/fishingpole_fishinwater',
  'dontstarve/common/fishingpole_fishcaught',
  'dontstarve/common/fishingpole_fishland',
  'dontstarve/common/fishingpole_lostrod',
] as const;

const FISHINGROD_DAMAGE = WILSON_ATTACK * 0.125; // tuning.lua FISHINGROD_DAMAGE

function onfished(inst: ItemEntity): void {
  inst.components.finiteuses.use(1);
}

function onunequip(inst: ItemEntity): void {
  inst.components.fishingrod?.StopFishing();
}

function landFish(inst: ItemEntity, fish: HookedFish, position: Vector3): void {
  inst.worldServices?.dropLoot?.([{ itemId: fish.prefab, count: 1 }], position);
}

/** fishingrod.lua fn: weapon, finiteuses and the rod's game-time fishing component. */
export function configureFishingRodEntity(inst: ItemEntity): void {
  inst.addTag('fishingrod');
  inst.addTag('allow_action_on_impassable');
  const weapon = AddWeapon(inst, FISHINGROD_DAMAGE, true);
  weapon.attackwear = 4;
  AddFiniteUses(inst, FISHINGROD_USES);
  if (!inst.getComponent('fishingrod_uses')) {
    inst.component('fishingrod_uses', () => {
      const stopCollect = inst.ListenForEvent('fishingcollect', onfished);
      const stopUnequip = inst.ListenForEvent('unequipped', onunequip);
      return {
        dispose() {
          stopCollect();
          stopUnequip();
        },
      };
    });
  }
  const world = inst.worldServices;
  if (world?.scheduler && world.dropLoot && !inst.components.fishingrod) {
    const rod = addComponent(inst, 'fishingrod', FishingRod, world.scheduler, landFish, world.componentUpdates);
    rod.SetWaitTimes(...FISHINGROD_WAIT_TIMES);
    rod.SetStrainTimes(...FISHINGROD_STRAIN_TIMES);
  }
}

/** fishingrod.lua onequip: swap_object plus the fishingline and FX_fishing symbols from swap_fishingrod. */
export const fishingRodVisual: EquipmentVisualFactory = item => {
  const skin = skinArchive('fishingrod', GROUND_ITEM_DEFINITIONS.fishingrod.skinArchives, item.skinId);
  const visual = handEquipmentVisual(item, [...(skin ? [skin] : []), 'swap_fishingrod'], 'swap_fishingrod');
  let owner: Parameters<typeof visual.onequip>[0] | undefined;
  return {
    onequip(equipper) {
      owner = equipper;
      visual.onequip(equipper);
      equipper.AnimState.OverrideSymbol('fishingline', 'swap_fishingrod', 'fishingline');
      equipper.AnimState.OverrideSymbol('FX_fishing', 'swap_fishingrod', 'FX_fishing');
    },
    onunequip() {
      owner?.AnimState.ClearOverrideSymbol('fishingline');
      owner?.AnimState.ClearOverrideSymbol('FX_fishing');
      owner = undefined;
      visual.onunequip();
    },
  };
};
