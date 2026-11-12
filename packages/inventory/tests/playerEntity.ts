import { createEmptyEntity } from '../../prefab/src/prefabInstance';

/** The entity an inventory belongs to in these tests: a player at `position`, as inventory.inst. */
export function playerEntity(position: { readonly x: number; readonly y: number; readonly z: number } = { x: 0, y: 0, z: 0 }) {
  const { instance } = createEmptyEntity('wilson');
  instance.addTag('player');
  instance.setPosition(position.x, position.y, position.z);
  return instance;
}
