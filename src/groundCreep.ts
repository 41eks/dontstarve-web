import { GroundCreep, type GroundCreepPlayer } from '../packages/componets/src/groundcreep';
import type { GameTimeScheduler } from '../packages/componets/src/gameTimeScheduler';
import { isInvisibleTile, isLandTile } from '@dontstarve-web/prefab/groundTileQuads';
import type { TurfMap } from '@dontstarve-web/prefab/turfMap';

/**
 * world.lua AddGroundCreep: the world's creep grid over the map's tiles. Creep covers land tiles that are not
 * invisible (TileGroupManager IsLandTile and not IsInvisibleTile), read live so dug or placed turf applies.
 */
export function createGroundCreep(
  turfMap: Pick<TurfMap, 'cellRange' | 'tileIdAtCell'>,
  scheduler: GameTimeScheduler,
  getPlayers: () => readonly GroundCreepPlayer[],
): GroundCreep {
  return new GroundCreep(
    {
      cellRange: () => turfMap.cellRange(),
      canHoldCreep: (col, row) => {
        const tile = turfMap.tileIdAtCell(col, row);
        return isLandTile(tile) && !isInvisibleTile(tile);
      },
    },
    scheduler,
    getPlayers,
  );
}
