import { createBackpackEquipmentLifecycle } from '@dontstarve-web/prefab/backpack';
import type { BodyEquipment, EquipmentOwner, Signal } from '@dontstarve-web/signals';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';
import { bindPlayerEquipment } from './playerEquipment';

export interface PlayerBodyEquipmentOptions {
  bodyEquipmentExistenceState: Signal<BodyEquipment | null>;
  animation?: Pick<WilsonAnimationController, 'equipmentContext'>;
  owner?: EquipmentOwner;
  setBackpackActive(active: boolean, entityId?: string): void;
}

export function bindPlayerBodyEquipment(options: PlayerBodyEquipmentOptions) {
  let visual: ReturnType<typeof createBackpackEquipmentLifecycle> | undefined;
  return bindPlayerEquipment({
    existenceState: options.bodyEquipmentExistenceState,
    owner: options.owner,
    createLifecycle(equipment) {
      const context = options.animation?.equipmentContext;
      if (!context || equipment.itemId !== 'backpack') return;
      visual = createBackpackEquipmentLifecycle({ id: equipment.entity?.id ?? 'body', prefab: equipment.itemId, skinId: equipment.skinId }, context);
      return visual;
    },
    present(equipment) {
      const equipped = equipment?.itemId === 'backpack';
      void visual?.ready.catch((error: unknown) => console.error('Unable to equip backpack', error));
      if (options.bodyEquipmentExistenceState.peek() !== equipment) return;
      options.setBackpackActive(equipped, equipped ? equipment?.entity?.id : undefined);
    },
  });
}
