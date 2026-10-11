import type { HeadEquipment, Signal } from '@dontstarve-web/signals';
import { isHatId } from '@dontstarve-web/prefab/hats';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';
import { bindPlayerEquipment } from './playerEquipment';

export interface PlayerHeadEquipmentOptions {
  headEquipmentExistenceState: Signal<HeadEquipment | null>;
  animation?: Pick<WilsonAnimationController, 'setHat'>;
}

export function bindPlayerHeadEquipment(options: PlayerHeadEquipmentOptions) {
  return bindPlayerEquipment({
    existenceState: options.headEquipmentExistenceState,
    present(equipment) {
      void options.animation?.setHat(equipment && isHatId(equipment.itemId) ? equipment.itemId : null, equipment?.skinId)
        .catch((error: unknown) => console.error('Unable to equip hat', error));
    },
  });
}
