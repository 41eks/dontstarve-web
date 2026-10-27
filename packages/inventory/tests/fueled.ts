import type { ItemEntity } from '../src';

/** A fueled prefab's inst:AddComponent("fueled") and InitializeFuelLevel. */
export function addFueled(maxfuel: number): (entity: ItemEntity) => void {
  return entity => { if (!entity.components.fueled) entity.AddFueled().InitializeFuelLevel(maxfuel); };
}
