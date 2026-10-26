import type * as THREE from 'three';

const LIGHT_OVERRIDE_KEY = 'dstLightOverride';

/**
 * Minimum light of one material, for art that is drawn lit inside another entity's merged mesh (the hat glow).
 * An entity's own AnimState:SetLightOverride is declared on its sprite json and read from its display.
 */
export function setMaterialLightOverride(material: THREE.Material, value: number | null): void {
  if (value === null) delete material.userData[LIGHT_OVERRIDE_KEY];
  else material.userData[LIGHT_OVERRIDE_KEY] = Math.min(1, Math.max(0, value));
}

export function getMaterialLightOverride(material: THREE.Material): number | undefined {
  return material.userData[LIGHT_OVERRIDE_KEY] as number | undefined;
}
