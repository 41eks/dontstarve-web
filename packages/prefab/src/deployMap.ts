import type * as THREE from 'three';
import type { DeployInst, DeployMap } from '../../componets/src/deployable';
import { createDockWorld } from './dock_kit';
import { ignoresPlacement, type PlacementQuery } from './placementEntities';
import { PLANTABLES } from './plantables';
import { TILE_SIZE } from './tile';
import { isLandTile, type TurfMap } from './turfMap';
import type { WorldContext } from './worldContext';

export interface DeployPlacerMap extends DeployMap {
  /** map.lua GetTileCenterPoint, which the grid placer snaps to. */
  tileCenter(point: THREE.Vector3): { x: number; z: number };
}

/** The Map:CanPlaceTurfAtPoint / CanDeployPlantAtPoint rules and SpawnPrefab targets deployable items use. */
export function createDeployMap({ turf, blockers, plants, worldEvents }: {
  turf: TurfMap;
  blockers: PlacementQuery;
  plants: Readonly<Record<string, { transplant(position: THREE.Vector3, skinId?: string): boolean }>>;
  worldEvents?: WorldContext['worldEvents'];
}): DeployPlacerMap {
  const docks = createDockWorld(turf, blockers);
  return {
    canDeployDock: point => docks.canDeployDock(point),
    createDock: point => docks.createDock(point),
    isPassableAtPoint: point => isLandTile(turf.getTileAtWorld(point)),
    isOceanTileAtPoint: point => turf.isOceanAtWorld(point),
    canPlaceTurf: point => turf.canPlaceTurf(point),
    setTile: (col, row, tileId) => turf.setTile(col, row, tileId as Parameters<TurfMap['setTile']>[2]),
    tileCenter: point => turf.tileCenter(point),
    canDeployPlant: (point, _inst, spacing) => turf.canDeployPlantAtPoint(point) && !blockers.someNear(point, spacing, blocker => {
      if ((blocker.visible === false && !blocker.logicalTree) || ignoresPlacement(blocker, ['NOBLOCK', 'player', 'FX', 'INLIMBO', 'DECOR', 'walkableplatform', 'walkableperipheral', 'isdead'])) return false;
      const inventoryRadius = blocker.getInventoryRadius?.(.5 * (TILE_SIZE / 4)) ?? blocker.inventoryRadius;
      const radius = blocker.smartRadius !== undefined ? blocker.smartRadius + spacing / 2
        : inventoryRadius !== undefined ? Math.min(spacing, inventoryRadius + spacing / 2) : spacing;
      return blocker.position.distanceToSquared(point) < radius ** 2;
    }),
    deployPlant: (point, inst: DeployInst & { skinId?: string }) => plants[PLANTABLES[inst.prefab].prefab].transplant(point, inst.skinId),
    itemPlanted: (doer, pos) => worldEvents?.emit('itemplanted', { doer, pos }),
  };
}
