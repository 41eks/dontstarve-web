import type { ItemEntity } from '@dontstarve-web/inventory';
import { Deployable } from '../../componets/src/deployable';
import type { GroundTileName } from './groundTiles';
import catalog from './groundItems.json';
import { WORLD_TILES } from './turfMap';
import { TILE_SIZE } from './tile';
import { PlaySound } from './sound';
import { configureBurnableItemEntity } from './burnableItems';

export function turfTileName(prefab: string): GroundTileName | undefined {
  return (catalog.items as Readonly<Record<string, { groundTile?: GroundTileName }>>)[prefab]?.groundTile;
}

/** componentutil.lua HandleDugGround resolves loot through GroundTiles.turf. */
export function turfItemForTile(tileId: number): string | undefined {
  return Object.keys(catalog.items).find(id => {
    const name = turfTileName(id);
    return name !== undefined && WORLD_TILES[name] === tileId;
  });
}

/** turfs.lua make_turf: groundtile tags, deployable(TURF), and one consumed turf. */
export function configureTurfEntity(entity: ItemEntity): void {
  const name = turfTileName(entity.prefab);
  if (!name) return;
  configureBurnableItemEntity(entity);
  entity.addTag('groundtile');
  entity.addTag('molebait');
  entity.addTag('deployable');
  entity.components.deployable = entity.component('deployable', () => new Deployable(entity, (point, deployer, map) => {
    if (entity.components.inventoryitem.owner || entity.components.stackable.count !== 1) {
      throw new Error('Turf deployment requires one detached item');
    }
    PlaySound('dontstarve/wilson/dig', deployer.position);
    map.setTile(Math.floor(point.x / TILE_SIZE), Math.floor(point.z / TILE_SIZE), WORLD_TILES[name]);
    entity.remove();
  }));
}
