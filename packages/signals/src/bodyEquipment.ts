import { createEquipmentExistenceState, type Equipment, type EquipmentLifecycle } from './equipment';

export type BodyEquipment = Equipment<'BODY'>;
export type BodyEquipmentLifecycle = EquipmentLifecycle<'BODY'>;

/** Independent body existence state; null requests removal of the current item. */
export function createBodyEquipmentExistenceState() {
  return createEquipmentExistenceState('BODY');
}
