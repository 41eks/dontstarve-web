import type { PrefabDisplay } from '@dontstarve-web/display';
import { Explosive, type ExplosiveTarget } from '../../componets/src/explosive';
import { FindEntities } from './actionEntity';
import { configureBurnableItemEntity, createBurnableItemVisual } from './burnableItems';
import { createResidentGroundItem } from './groundItems';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';
import { TILE_SIZE } from './tile';

export const GUNPOWDER_ID = 'gunpowder';
const CANT_TAGS = ['INLIMBO', 'notarget'] as const; // explosive.lua CANT_TAGS

/** gunpowder.lua: a burnable explosive whose fuse ends in explode_small; the scene is the explosion's world. */
export function createGunpowderGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  const displays = new Set<PrefabDisplay>();
  return {
    itemIds: [GUNPOWDER_ID],
    configureEntity: configureBurnableItemEntity,
    create(item, inst) {
      if (!context.fx) throw new Error('Gunpowder requires the explode_small effect');
      const visual = createBurnableItemVisual(context, GUNPOWDER_ID, createResidentGroundItem(context, { ...item, entity: inst }), displays);
      const explosive = inst.component('explosive', () => new Explosive(inst,
        (center, radius) => FindEntities(center, radius, [], CANT_TAGS) as unknown as readonly ExplosiveTarget[], TILE_SIZE / 4));
      inst.components.explosive = explosive;
      explosive.SetOnExplodeFn(entity => context.fx!.spawn('explode_small', entity.getPosition()));
      return visual;
    },
    renderEntities: () => [...displays].flatMap(display => display.fxRenderEntries),
    dispose() { displays.clear(); },
  };
}
