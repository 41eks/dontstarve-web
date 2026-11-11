import { addComponent } from './components';
import { Explosive } from '../../componets/src/explosive';
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
        const explosive = addComponent(inst, 'explosive', Explosive,
          (center, radius) => inst.TheSim.FindEntities(center, radius, [], CANT_TAGS), TILE_SIZE / 4);
        explosive.SetOnExplodeFn(entity => fx.spawn('explode_small', entity.getPosition()));
      },
    }),
  };
}
