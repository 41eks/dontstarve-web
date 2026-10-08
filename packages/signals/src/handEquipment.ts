import { createEquipmentExistenceState, type Equipment, type EquipmentEntity, type EquipmentLifecycle } from './equipment';

export type HandEquipmentEntity = EquipmentEntity;
export type HandEquipment = Equipment<'HANDS'>;
export type HandEquipmentLifecycle = EquipmentLifecycle<'HANDS'>;

/** Independent hand existence state; null requests removal of the current item. */
export function createHandEquipmentExistenceState() {
  return createEquipmentExistenceState('HANDS');
}
