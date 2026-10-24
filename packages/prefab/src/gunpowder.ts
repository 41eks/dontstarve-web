import type { ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Explosive, type ExplosiveTarget } from '../../componets/src/explosive';
import { FindEntities } from './actionEntity';
import { configureBurnableItemEntity, burnableFireRenderEntry, createBurnableItemVisual } from './burnableItems';
import { createGroundItemSprite } from './groundItems';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';
import { TILE_SIZE } from './tile';

export const GUNPOWDER_ID = 'gunpowder';
const CANT_TAGS = ['INLIMBO', 'notarget'] as const; // explosive.lua CANT_TAGS

/** gunpowder.lua: a burnable explosive whose fuse ends in explode_small; the scene is the explosion's world. */
export function createGunpowderGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  const fires = new Set<ArchiveSprite>();
  return {
    itemIds: [GUNPOWDER_ID],
    configureEntity: configureBurnableItemEntity,
    async create(item) {
      if (!context.fx) throw new Error('Gunpowder requires the explode_small effect');
      const sprite = await createGroundItemSprite(context.assets, GUNPOWDER_ID, item.skinId);
      let visual;
      try {
        visual = await createBurnableItemVisual(context, GUNPOWDER_ID, sprite, fires);
        await context.fx.prepare('explode_small');
      } catch (error) { (visual ?? sprite).dispose(); throw error; }
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
    update(dt, quaternion) { for (const fire of fires) { fire.model.quaternion.copy(quaternion); fire.update(dt); } },
    renderEntities: () => [...fires].map(burnableFireRenderEntry),
    dispose() { for (const fire of fires) fire.dispose(); fires.clear(); },
  };
}
