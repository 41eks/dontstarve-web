import { PLAYER_EQUIPMENT_CONTAINER_ID, type ItemEntity } from '@dontstarve-web/inventory';
import { FishingRod, type FishingWorld } from '../../componets/src/fishingrod';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';

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

/** fishingrod.lua: finiteuses removes the rod; each collected fish costs one use. */
export function configureFishingRodEntity(entity: ItemEntity): void {
  entity.addTag('fishingrod');
  entity.components.finiteuses.setMaxUses(FISHINGROD_USES);
  entity.components.finiteuses.setOnFinished(() => entity.isRemoved || entity.remove());
  entity.component('fishingrod_uses', () => {
    const stop = entity.ListenForEvent('fishingcollect', () => { entity.components.finiteuses.use(1); });
    return { dispose: stop };
  });
}

/** The rod component is attached on first use, when the running scene supplies its scheduler and world. */
export function getFishingRod(entity: ItemEntity, scheduler: GameTimeScheduler, world: FishingWorld): FishingRod {
  const rod = entity.component('fishingrod', () => {
    const rod = new FishingRod({
      addTag: tag => entity.addTag(tag),
      PushEvent: (name, data) => entity.PushEvent(name, data),
      getDurabilityPercent: () => entity.components.finiteuses.percent.peek(),
      isEquipped: () => {
        const address = entity.components.inventoryitem.owner?.address;
        return address?.containerId === PLAYER_EQUIPMENT_CONTAINER_ID && address.slotKey === 'hand';
      },
    }, scheduler, world);
    rod.SetWaitTimes(...FISHINGROD_WAIT_TIMES);
    rod.SetStrainTimes(...FISHINGROD_STRAIN_TIMES);
    return rod;
  });
  rod.bind(scheduler, world);
  return rod;
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
