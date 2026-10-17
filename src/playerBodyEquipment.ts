import { createBackpackEquipmentLifecycle } from '@dontstarve-web/prefab/backpack';
import { ARMORSNURTLESHELL_ID, createArmorSnurtleshellLifecycle, prepareArmorSnurtleshellVisual } from '@dontstarve-web/prefab/armorsnurtleshell';
import { AMULET_ID, createAmuletEquipmentLifecycle, prepareAmuletVisual } from '@dontstarve-web/prefab/amulet';
import { preparedEquipmentLifecycle } from '@dontstarve-web/prefab/equipmentVisual';
import { ItemEntity } from '@dontstarve-web/inventory';
import type { BodyEquipment, EquipmentOwner, Signal } from '@dontstarve-web/signals';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';
import { bindPlayerEquipment } from './playerEquipment';

export interface PlayerBodyEquipmentOptions {
  bodyEquipmentExistenceState: Signal<BodyEquipment | null>;
  animation?: Pick<WilsonAnimationController, 'equipmentContext' | 'stategraph'>;
  owner?: EquipmentOwner;
  setBackpackActive(active: boolean, entityId?: string): void;
}

export function bindPlayerBodyEquipment(options: PlayerBodyEquipmentOptions) {
  let visual: { readonly ready: Promise<void> } | undefined;
  const binding = bindPlayerEquipment({
    existenceState: options.bodyEquipmentExistenceState,
    owner: options.owner,
    createLifecycle(equipment) {
      const context = options.animation?.equipmentContext;
      if (!context) return;
      if (equipment.itemId === ARMORSNURTLESHELL_ID && equipment.entity instanceof ItemEntity && !equipment.entity.isRemoved) {
        const entity = equipment.entity;
        const art = preparedEquipmentLifecycle(() => prepareArmorSnurtleshellVisual(context.assets,
          { id: entity.id, prefab: entity.prefab, skinId: equipment.skinId }), context);
        const domain = createArmorSnurtleshellLifecycle(entity);
        visual = art;
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
        const art = preparedEquipmentLifecycle(() => prepareAmuletVisual(context.assets,
          { id: entity.id, prefab: entity.prefab, skinId: equipment.skinId }), context);
        visual = art;
        return createAmuletEquipmentLifecycle(entity, art);
      }
      if (equipment.itemId !== 'backpack') return;
      const backpack = createBackpackEquipmentLifecycle({ id: equipment.entity?.id ?? 'body', prefab: equipment.itemId, skinId: equipment.skinId }, context);
      visual = backpack;
      return backpack;
    },
    present(equipment) {
      const equipped = equipment?.itemId === 'backpack';
      void visual?.ready.catch((error: unknown) => console.error('Unable to equip body item', error));
      if (options.bodyEquipmentExistenceState.peek() !== equipment) return;
      options.setBackpackActive(equipped, equipped ? equipment?.entity?.id : undefined);
    },
  });
  return { ...binding, /** The worn art is applied once this settles. */ get ready() { return visual?.ready ?? Promise.resolve(); } };
}
