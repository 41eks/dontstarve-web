import type * as THREE from 'three';

/** Renderer-independent light description; radius is in this scene's world units. */
export interface PrefabLocalLight {
  readonly radius: number;
  readonly intensity: number;
  readonly falloff: number;
  readonly colour: readonly [number, number, number];
}

const LOCAL_LIGHT_KEY = 'dstPrefabLocalLight';

/** The entity origin is the light centre, independently of its billboard art. */
export function setPrefabLocalLight(owner: THREE.Object3D, light: PrefabLocalLight | null): void {
  if (light === null) delete owner.userData[LOCAL_LIGHT_KEY];
  else owner.userData[LOCAL_LIGHT_KEY] = light;
}

export function getPrefabLocalLight(owner: THREE.Object3D): PrefabLocalLight | undefined {
  return owner.userData[LOCAL_LIGHT_KEY] as PrefabLocalLight | undefined;
}
