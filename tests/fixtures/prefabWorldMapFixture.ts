import type { PrefabWorldMap } from '../../packages/prefab/src/worldContext';

/** Only the map queries the current case exercises need overrides. */
export function prefabWorldMap(overrides: Partial<PrefabWorldMap> = {}): PrefabWorldMap {
  return {
    isAboveGroundAtPoint: () => true,
    isLandTileAtPoint: () => true,
    isOceanAtPoint: () => false,
    isPassableAtPoint: () => true,
    isGroundTargetBlocked: () => false,
    canTerraform: () => false,
    dig: () => false,
    canTill: () => false,
    till: () => false,
    ...overrides,
  };
}
