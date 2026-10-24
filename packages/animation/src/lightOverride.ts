import type * as THREE from 'three';

const LIGHT_OVERRIDE_KEY = 'dstLightOverride';

/** Minimum material light, matching AnimState:SetLightOverride. No emitted light. */
export function setLightOverride(owner: THREE.Object3D | THREE.Material, value: number | null): void {
  if (value === null) delete owner.userData[LIGHT_OVERRIDE_KEY];
  else owner.userData[LIGHT_OVERRIDE_KEY] = Math.min(1, Math.max(0, value));
}

export function getLightOverride(owner: THREE.Object3D | THREE.Material): number | undefined {
  return owner.userData[LIGHT_OVERRIDE_KEY] as number | undefined;
}
