import type { HeadEquipment, Signal } from '@dontstarve-web/signals';
import { isHatId } from '@dontstarve-web/prefab/hats';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';
import { bindPlayerEquipment } from './playerEquipment';

export interface PlayerHeadEquipmentOptions {
  headEquipmentExistenceState: Signal<HeadEquipment | null>;
  animation?: Pick<WilsonAnimationController, 'setHat'>;
}

export function bindPlayerHeadEquipment(options: PlayerHeadEquipmentOptions) {
  let disposed = false;
  const binding = bindPlayerEquipment({
    existenceState: options.headEquipmentExistenceState,
    present(equipment) {
      const itemId = equipment && isHatId(equipment.itemId) ? equipment.itemId : null;
      void options.animation?.setHat(itemId, equipment?.skinId)
        .catch((error: unknown) => console.error('Unable to equip hat', error));
    },
  });
  return { ...binding, dispose() {
    if (disposed) return;
    disposed = true;
    binding.dispose();
    // Clear only presentation: setHat also invalidates pending asset requests; the inventory stays authoritative.
    void options.animation?.setHat(null).catch((error: unknown) => console.error('Unable to remove hat', error));
  } };
}
