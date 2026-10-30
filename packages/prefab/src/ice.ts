import type { ItemEntity } from '@dontstarve-web/inventory';
import { createResidentGroundItem } from './groundItems';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';

export const ICE_ID = 'ice';

/**
 * inv_rocks_ice.lua: tags, and onperish. A held stack is removed whole; a world stack can no longer be
 * picked up and is removed after `melt` (see createIceGroundFactory).
 * Not ported: DoDeltaMoistureToEntity on the owner and the farming_manager soil moisture, which need wetness/farming systems.
 */
export function configureIceEntity(entity: ItemEntity): void {
  for (const tag of ['frozen', 'molebait', 'watersource']) entity.addTag(tag);
  entity.components.perishable.perishfn = () => { if (entity.components.inventoryitem.owner) entity.remove(); };
}

export function createIceGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  return {
    itemIds: [ICE_ID],
    configureEntity: configureIceEntity,
    create(item, inst) {
      const { visual, instance } = createResidentGroundItem(context, { ...item, sprite: inst.sprite });
      let stop: (() => void) | undefined;
      let melting = false;
      const melt = (entity: ItemEntity) => {
        if (melting || entity.isRemoved || entity.components.inventoryitem.owner) return;
        melting = true;
        entity.persists = false;
        entity.components.inventoryitem.canbepickedup = false;
        instance.sprite.playOnce('melt', () => entity.remove());
      };
      return {
        ...visual,
        bindEntity(entity) {
          stop?.();
          stop = entity.ListenForEvent('perished', () => melt(entity));
          if (entity.components.perishable.timer.peek().status === 'perished') melt(entity);
        },
        dispose() { stop?.(); visual.dispose(); },
      };
    },
  };
}
