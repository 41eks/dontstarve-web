import { GroundCreep, type GroundCreepPlayer } from '../packages/componets/src/groundcreep';
import type { GameTimeScheduler } from '../packages/componets/src/gameTimeScheduler';
import type { GroundCreepDeclaration } from '@dontstarve-web/display';
import { creepTileQuads, GROUND_CREEP_ART, isInvisibleTile, isLandTile } from '@dontstarve-web/prefab/groundTileQuads';
import type { TurfMap } from '@dontstarve-web/prefab/turfMap';

/** Above every ground layer (-1..-0.6) and below the ground overlays such as snow (-0.55). */
const GROUND_CREEP_RENDER_ORDER = -0.58;

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

/** world.lua GroundCreep:AddRenderLayer for groundcreepdefs.lua's layer, drawing the creep's own cells. */
export function groundCreepDeclaration(
  creep: GroundCreep,
  turfMap: Pick<TurfMap, 'cellRange'>,
): GroundCreepDeclaration {
  const range = turfMap.cellRange();
  return {
    art: GROUND_CREEP_ART,
    renderOrder: GROUND_CREEP_RENDER_ORDER,
    quads: bounds => creepTileQuads((col, row) => creep.IsCreepAtCell(col, row), range, bounds),
    changes: creep.changes,
  };
}
