import type * as THREE from 'three';
import { ItemEntity } from '@dontstarve-web/inventory';
import type { DeployMap } from '../../componets/src/deployable';
import { createDockWorld } from './dock_kit';
import { IsDeployPointClear, type MapEntities } from './mapEntities';
import { isLandTile, type TurfMap } from './turfMap';
import type { WorldContext } from './worldContext';

export interface DeployPlacerMap extends DeployMap {
  /** map.lua GetTileCenterPoint, which the grid placer snaps to. */
  tileCenter(point: THREE.Vector3): { x: number; z: number };
}

/** The Map:CanPlaceTurfAtPoint / CanDeployPlantAtPoint rules and the SpawnPrefab deployable items use. */
export function createDeployMap({
  turf,
  ents,
  spawnPrefab,
  farm,
  worldEvents,
}: {
  turf: TurfMap;
  /** The world's entities, which TheWorld.Map's placement checks find. */
  ents: MapEntities;
  spawnPrefab?: DeployMap['SpawnPrefab'];
  farm?: {
    canDeploy(point: THREE.Vector3, inst?: object): boolean;
    deploy(point: THREE.Vector3, item: ItemEntity): boolean;
  };
  worldEvents?: WorldContext['worldEvents'];
}): DeployPlacerMap {
  const docks = createDockWorld(turf, ents);
  return {
    canDeployPlow: (point, inst) => farm?.canDeploy(point, inst) ?? false,
    deployPlow: (point, inst) => inst instanceof ItemEntity && (farm?.deploy(point, inst) ?? false),
    canDeployDock: point => docks.canDeployDock(point),
    createDock: point => docks.createDock(point),
    isPassableAtPoint: point => isLandTile(turf.getTileAtWorld(point)),
    isOceanTileAtPoint: point => turf.isOceanAtWorld(point),
    canPlaceTurf: point => turf.canPlaceTurf(point),
    setTile: (col, row, tileId) => turf.setTile(col, row, tileId as Parameters<TurfMap['setTile']>[2]),
    tileCenter: point => turf.tileCenter(point),
    // map.lua CanDeployPlantAtPoint.
    canDeployPlant: (point, inst, spacing) =>
      turf.canDeployPlantAtPoint(point) && IsDeployPointClear(ents, point, inst, spacing),
    SpawnPrefab: (prefab, position, skinId) => spawnPrefab?.(prefab, position, skinId),
    itemPlanted: (doer, pos) => worldEvents?.emit('itemplanted', { doer, pos }),
  };
}
