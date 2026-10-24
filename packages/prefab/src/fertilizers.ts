import type { ItemEntity } from '@dontstarve-web/inventory';
import { Fertilizer } from '../../componets/src/fertilizer';

// poop.lua, guano.lua, spoiledfood.lua: TUNING.*_WITHEREDCYCLES.
export const FERTILIZER_CYCLES: Readonly<Record<string, number>> = { poop: 1, guano: 1, spoiled_food: .5 };
export function configureFertilizerEntity(entity: ItemEntity): void {
  if (!entity.components.fertilizer) entity.components.fertilizer = entity.component('fertilizer', () => new Fertilizer(entity, FERTILIZER_CYCLES[entity.prefab]));
}
