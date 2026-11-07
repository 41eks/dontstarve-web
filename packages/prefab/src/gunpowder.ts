import { Explosive, type ExplosiveTarget } from '../../componets/src/explosive';
import { FindEntities } from './actionEntity';
import { bindBurnableItem } from './burnableItems';
import { groundItemPrefab, type ItemPrefabDefinition } from './groundItems';
import type { ItemPrefabWorld } from './groundPrefab';
import { TILE_SIZE } from './tile';

export const GUNPOWDER_ID = 'gunpowder';
const CANT_TAGS = ['INLIMBO', 'notarget'] as const; // explosive.lua CANT_TAGS

/** gunpowder.lua: a burnable explosive whose fuse ends in explode_small. */
export function gunpowderPrefabs(world: ItemPrefabWorld): Record<string, ItemPrefabDefinition> {
  return {
    [GUNPOWDER_ID]: groundItemPrefab(GUNPOWDER_ID, world, {
      configure: inst => {
        const fx = world.fx;
        if (!fx) throw new Error('Gunpowder requires the explode_small effect');
        bindBurnableItem(inst, world);
        const explosive = inst.component('explosive', () => new Explosive(inst,
          (center, radius) => FindEntities(center, radius, [], CANT_TAGS) as unknown as readonly ExplosiveTarget[], TILE_SIZE / 4));
        inst.components.explosive = explosive;
        explosive.SetOnExplodeFn(entity => fx.spawn('explode_small', entity.getPosition()));
      },
    }),
  };
}
