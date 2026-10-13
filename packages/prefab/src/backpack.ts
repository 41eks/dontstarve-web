import type { ItemEntity } from '@dontstarve-web/inventory';

/** backpack.lua's common initialization; skins keep the same native map icon. */
export function configureBackpackEntity(entity: ItemEntity): void {
  entity.AddMiniMapEntity().SetIcon('backpack.png');
}
