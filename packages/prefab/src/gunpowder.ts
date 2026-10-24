import type { PrefabDisplay } from '@dontstarve-web/display';
import type { ItemEntity } from '@dontstarve-web/inventory';
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
    async create(item) {
      if (!context.fx) throw new Error('Gunpowder requires the explode_small effect');
      const base = await createResidentGroundItem(context, item);
      let visual;
      try {
        visual = await createBurnableItemVisual(context, GUNPOWDER_ID, base, displays);
        await context.fx.prepare('explode_small');
      } catch (error) { (visual ?? base.visual).dispose(); throw error; }
      return { ...visual, bindEntity(entity: ItemEntity) {
        visual.bindEntity?.(entity);
        const explosive = entity.component('explosive', () => new Explosive(entity,
          (center, radius) => FindEntities(center, radius, [], CANT_TAGS) as unknown as readonly ExplosiveTarget[],
          TILE_SIZE / 4));
        entity.components.explosive = explosive;
        // explosive.explosivedamage only feeds combat targets, which this scene does not model.
        explosive.SetOnExplodeFn(inst => context.fx!.spawn('explode_small', inst.getPosition()));
      } };
    },
    renderEntities: () => [...displays].flatMap(display => display.fxRenderEntries),
    dispose() { displays.clear(); },
  };
}
