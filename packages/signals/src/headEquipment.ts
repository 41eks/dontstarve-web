import { createEquipmentExistenceState, type Equipment, type EquipmentLifecycle } from './equipment';

export type HeadEquipment = Equipment<'HEAD'>;
export type HeadEquipmentLifecycle = EquipmentLifecycle<'HEAD'>;

/** Independent head existence state; null requests removal of the current item. */
export function createHeadEquipmentExistenceState() {
  return createEquipmentExistenceState('HEAD');
}
