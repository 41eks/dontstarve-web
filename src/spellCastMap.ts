import * as THREE from 'three';
import type { SpellCastMap } from '@dontstarve-web/stategraphs/spellcaster';
import { turfMap } from './building';
import { scene } from './universal';
import { WORLD_TILES } from '@dontstarve-web/prefab/turfMap';

/** The current surface map has no ocean tiles; point casting still preserves Lua's water capability. */
export const spellCastMap: SpellCastMap = {
  isAboveGroundAtPoint: point => turfMap.getTileAtWorld(point) !== WORLD_TILES.INVALID,
  isOceanAtPoint: () => false,
  isGroundTargetBlocked: point => {
    let blocked = false;
    // Map:IsGroundTargetBlocked checks these tags, rather than every collision body.
    scene.traverse(model => {
      if (blocked || !(model.userData.tags?.includes('groundtargetblocker') || model.userData.tags?.includes('groundhole'))) return;
      const position = model.getWorldPosition(new THREE.Vector3());
      const distance = (position.x - point.x) ** 2 + (position.z - point.z) ** 2;
      const radius = (model.userData.groundTargetBlockerRadius ?? model.userData.groundHoleOuterRadius ?? model.userData.physicsRadius ?? 0)
        + (model.userData.groundHoleRangeOverride ?? 1.5);
      const inner = model.userData.groundHoleInnerRadius;
      blocked = distance < radius ** 2 && (inner === undefined || distance >= inner ** 2);
    });
    return blocked;
  },
};
