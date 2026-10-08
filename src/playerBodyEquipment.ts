import type { BodyEquipment, Signal } from '@dontstarve-web/signals';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';
import { bindPlayerEquipment } from './playerEquipment';

export interface PlayerBodyEquipmentOptions {
  bodyEquipmentExistenceState: Signal<BodyEquipment | null>;
  animation?: Pick<WilsonAnimationController, 'setBackpack'>;
  setBackpackActive(active: boolean): void;
}

export function bindPlayerBodyEquipment(options: PlayerBodyEquipmentOptions) {
  return bindPlayerEquipment({
    existenceState: options.bodyEquipmentExistenceState,
    present(equipment) {
      const equipped = equipment?.itemId === 'backpack';
      void options.animation?.setBackpack(equipped, equipment?.skinId)
        .catch((error: unknown) => console.error('Unable to equip backpack', error));
      if (options.bodyEquipmentExistenceState.peek() !== equipment) return;
      options.setBackpackActive(equipped);
    },
  });
}
