import type * as THREE from 'three';

/** Renderer-independent light description; radius is in this scene's world units. */
export interface PrefabLocalLight {
  readonly radius: number;
  readonly intensity: number;
  readonly falloff: number;
  readonly colour: readonly [number, number, number];
}

const LOCAL_LIGHT_KEY = 'dstPrefabLocalLight';
const LIGHT_OVERRIDE_KEY = 'dstLightOverride';

/** Minimum material light, matching AnimState:SetLightOverride. No emitted light. */
export function setPrefabLightOverride(owner: THREE.Object3D | THREE.Material, value: number | null): void {
  if (value === null) delete owner.userData[LIGHT_OVERRIDE_KEY];
  else owner.userData[LIGHT_OVERRIDE_KEY] = Math.min(1, Math.max(0, value));
}

export function getPrefabLightOverride(owner: THREE.Object3D | THREE.Material): number | undefined {
  return owner.userData[LIGHT_OVERRIDE_KEY] as number | undefined;
}

/** The entity origin is the light centre, independently of its billboard art. */
export function setPrefabLocalLight(owner: THREE.Object3D, light: PrefabLocalLight | null): void {
  if (light === null) delete owner.userData[LOCAL_LIGHT_KEY];
  else owner.userData[LOCAL_LIGHT_KEY] = light;
}

export function getPrefabLocalLight(owner: THREE.Object3D): PrefabLocalLight | undefined {
  return owner.userData[LOCAL_LIGHT_KEY] as PrefabLocalLight | undefined;
}
