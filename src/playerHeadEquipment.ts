import { bindEquipmentLifecycle, type EquipmentOwner, type HeadEquipment, type Signal } from '@dontstarve-web/signals';
import { createHatEquipmentLifecycle, isHatId } from '@dontstarve-web/prefab/hats';
import { DREADSTONEHAT_ID, createDreadstoneHatLifecycle } from '@dontstarve-web/prefab/dreadstonehat';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';
import { ItemEntity } from '@dontstarve-web/inventory';

export interface PlayerHeadEquipmentOptions {
  headEquipmentExistenceState: Signal<HeadEquipment | null>;
  animation?: Pick<WilsonAnimationController, 'equipmentContext'>;
  owner?: EquipmentOwner;
}

export function bindPlayerHeadEquipment(options: PlayerHeadEquipmentOptions) {
  return bindEquipmentLifecycle({
    existenceState: options.headEquipmentExistenceState,
    owner: options.owner,
    createLifecycle(equipment) {
      const context = options.animation?.equipmentContext;
      if (!context || !isHatId(equipment.itemId)) return;
      const art = createHatEquipmentLifecycle({ id: equipment.entity?.id ?? 'head', prefab: equipment.itemId, skinId: equipment.skinId }, context);
      if (equipment.itemId !== DREADSTONEHAT_ID || !(equipment.entity instanceof ItemEntity) || equipment.entity.isRemoved) return art;
      const domain = createDreadstoneHatLifecycle(equipment.entity);
      return {
        onequip(owner) { art.onequip(owner); domain.onequip(owner); },
        onunequip() { domain.onunequip(); art.onunequip(); },
      };
    },
    present() {},
  });
}
