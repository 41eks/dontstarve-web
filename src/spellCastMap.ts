import * as THREE from 'three';
import type { SpellCastMap } from '@dontstarve-web/stategraphs/spellcaster';
import { turfMap } from './building';
import { scene } from './universal';
import { WORLD_TILES } from '@dontstarve-web/prefab/turfMap';
import { modelHasTag, prefabInstance } from '@dontstarve-web/prefab/prefabInstance';

/** Map:IsOceanAtPoint: the dug OCEAN_COASTAL tiles are the only water, and none of them is a visual ground. */
export const spellCastMap: SpellCastMap = {
  isAboveGroundAtPoint: point => turfMap.getTileAtWorld(point) !== WORLD_TILES.INVALID,
  isOceanAtPoint: point => turfMap.isOceanAtWorld(point),
  isGroundTargetBlocked: point => {
    let blocked = false;
    // Map:IsGroundTargetBlocked checks these tags, rather than every collision body.
    scene.traverse(model => {
      if (blocked || !(modelHasTag(model, 'groundtargetblocker') || modelHasTag(model, 'groundhole'))) return;
      const position: THREE.Vector3 = model.userData.getGroundPosition?.() ?? model.getWorldPosition(new THREE.Vector3());
      const distance = position.distanceToSquared(point);
      const radius = (model.userData.groundTargetBlockerRadius ?? model.userData.groundHoleOuterRadius ?? prefabInstance(model)?.getPhysicsRadius(0) ?? 0)
        + (model.userData.groundHoleRangeOverride ?? 1.5);
      const inner = model.userData.groundHoleInnerRadius;
      blocked = distance < radius ** 2 && (inner === undefined || distance >= inner ** 2);
    });
    return blocked;
  },
};
