import { PLAYER_EQUIPMENT_CONTAINER_ID, type ItemEntity } from '@dontstarve-web/inventory';
import { FishingRod, type FishingWorld } from '../../componets/src/fishingrod';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { ComponentUpdates } from '../../componets/src/componentUpdates';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory, type HeldEquipFunctions } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { AddFiniteUses, AddWeapon, WILSON_ATTACK } from './handTool';

export const FISHINGROD_ID = 'fishingrod';
/** tuning.lua FISHINGROD_USES; the wait and strain windows are set by fishingrod.lua. */
export const FISHINGROD_USES = 9;
export const FISHINGROD_WAIT_TIMES = [4, 40] as const;
export const FISHINGROD_STRAIN_TIMES = [0, 5] as const;
/** SGwilson.lua fishing states. */
export const FISHING_SOUNDS = [
  'dontstarve/common/fishingpole_cast', 'dontstarve/common/fishingpole_baitsplash', 'dontstarve/common/fishingpole_fishinwater',
  'dontstarve/common/fishingpole_fishcaught', 'dontstarve/common/fishingpole_fishland', 'dontstarve/common/fishingpole_lostrod',
] as const;

const FISHINGROD_DAMAGE = WILSON_ATTACK * .125; // tuning.lua FISHINGROD_DAMAGE

/**
 * fishingrod.lua fn: weapon, and finiteuses that removes the rod with each collected fish costing one use. The fishingrod
 * component joins when the rod is first held in a running scene (`getFishingRod`).
 */
export function configureFishingRodEntity(inst: ItemEntity): void {
  inst.addTag('fishingrod');
  inst.addTag('allow_action_on_impassable');
  const weapon = AddWeapon(inst, FISHINGROD_DAMAGE, true);
  weapon.attackwear = 4;
  AddFiniteUses(inst, FISHINGROD_USES);
  inst.component('fishingrod_uses', () => {
    const stop = inst.ListenForEvent('fishingcollect', () => { inst.components.finiteuses.use(1); });
    return { dispose: stop };
  });
}

/** The running scene's services a rod needs: game time, per-frame component updates and where a landed fish goes. */
export interface FishingRodWorld extends FishingWorld {
  readonly scheduler: GameTimeScheduler;
  readonly componentUpdates: ComponentUpdates;
}

/** The rod component is attached when the rod is first held in a running scene, which supplies its scheduler and world. */
export function getFishingRod(entity: ItemEntity, scheduler: GameTimeScheduler, world: FishingWorld, updates?: ComponentUpdates): FishingRod {
  const rod = entity.component('fishingrod', () => {
    const rod = new FishingRod({
      addTag: tag => entity.addTag(tag),
      PushEvent: (name, data) => entity.PushEvent(name, data),
      getDurabilityPercent: () => entity.components.finiteuses.percent.peek(),
      isEquipped: () => {
        const address = entity.components.inventoryitem.owner?.address;
        return address?.containerId === PLAYER_EQUIPMENT_CONTAINER_ID && address.slotKey === 'hand';
      },
    }, scheduler, world, updates);
    rod.SetWaitTimes(...FISHINGROD_WAIT_TIMES);
    rod.SetStrainTimes(...FISHINGROD_STRAIN_TIMES);
    return rod;
  });
  rod.bind(scheduler, world, updates);
  entity.components.fishingrod = rod;
  return rod;
}

/** Holding the rod in the scene gives it its fishingrod component; the rod stops fishing once it leaves the hand. */
export function createFishingRodLifecycle(entity: ItemEntity, world: FishingRodWorld): HeldEquipFunctions {
  return {
    onequip() { getFishingRod(entity, world.scheduler, world, world.componentUpdates); },
    onunequip() { entity.components.fishingrod?.StopFishing(); },
  };
}

/** fishingrod.lua onequip: swap_object plus the fishingline and FX_fishing symbols from swap_fishingrod. */
export const fishingRodVisual: EquipmentVisualFactory = item => {
  const skin = skinArchive('fishingrod', GROUND_ITEM_DEFINITIONS.fishingrod.skinArchives, item.skinId);
  const visual = handEquipmentVisual(item, [...skin ? [skin] : [], 'swap_fishingrod'], 'swap_fishingrod');
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
