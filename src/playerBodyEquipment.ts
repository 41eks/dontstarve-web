import { createBackpackEquipmentLifecycle } from '@dontstarve-web/prefab/backpack';
import { ARMORSNURTLESHELL_ID, armorSnurtleshellVisual, createArmorSnurtleshellLifecycle } from '@dontstarve-web/prefab/armorsnurtleshell';
import { AMULET_ID, amuletVisual, createAmuletEquipmentLifecycle } from '@dontstarve-web/prefab/amulet';
import { wornEquipmentLifecycle } from '@dontstarve-web/prefab/equipmentVisual';
import { ItemEntity } from '@dontstarve-web/inventory';
import { bindEquipmentLifecycle, type BodyEquipment, type EquipmentOwner, type Signal } from '@dontstarve-web/signals';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';

export interface PlayerBodyEquipmentOptions {
  bodyEquipmentExistenceState: Signal<BodyEquipment | null>;
  animation?: Pick<WilsonAnimationController, 'equipmentContext' | 'stategraph'>;
  owner?: EquipmentOwner;
  setBackpackActive(active: boolean, entityId?: string): void;
}

export function bindPlayerBodyEquipment(options: PlayerBodyEquipmentOptions) {
  return bindEquipmentLifecycle({
    existenceState: options.bodyEquipmentExistenceState,
    owner: options.owner,
    createLifecycle(equipment) {
      const context = options.animation?.equipmentContext;
      if (!context) return;
      if (equipment.itemId === ARMORSNURTLESHELL_ID && equipment.entity instanceof ItemEntity && !equipment.entity.isRemoved) {
        const entity = equipment.entity;
        const art = wornEquipmentLifecycle(armorSnurtleshellVisual({ id: entity.id, prefab: entity.prefab, skinId: equipment.skinId }), context);
        const domain = createArmorSnurtleshellLifecycle(entity);
        return {
          onequip(owner) { domain.onequip(owner); art.onequip(owner); },
          onunequip() {
            domain.onunequip(); art.onunequip();
            // The global unequip handler leaves the shell states.
            if (options.animation?.stategraph.hasStateTag('shell')) options.animation.stategraph.pushEvent('unequip');
          },
        };
      }
      if (equipment.itemId === AMULET_ID && equipment.entity instanceof ItemEntity && !equipment.entity.isRemoved) {
        const entity = equipment.entity;
        const art = wornEquipmentLifecycle(amuletVisual({ id: entity.id, prefab: entity.prefab, skinId: equipment.skinId }), context);
        return createAmuletEquipmentLifecycle(entity, art);
      }
      if (equipment.itemId !== 'backpack') return;
      return createBackpackEquipmentLifecycle({ id: equipment.entity?.id ?? 'body', prefab: equipment.itemId, skinId: equipment.skinId }, context);
    },
    present(equipment) {
      const equipped = equipment?.itemId === 'backpack';
      if (options.bodyEquipmentExistenceState.peek() !== equipment) return;
      options.setBackpackActive(equipped, equipped ? equipment?.entity?.id : undefined);
    },
  });
}
