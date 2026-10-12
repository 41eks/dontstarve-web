import * as THREE from 'three';
import { getLightOverride, setLightOverride } from '@dontstarve-web/animation/lightOverride';

/** Renderer-independent light description; radius is in this scene's world units. */
export interface PrefabLocalLight {
  readonly radius: number;
  readonly intensity: number;
  readonly falloff: number;
  readonly colour: readonly [number, number, number];
}

const LOCAL_LIGHT_KEY = 'dstPrefabLocalLight';

/** Minimum material light, matching AnimState:SetLightOverride. No emitted light. */
export const setPrefabLightOverride = setLightOverride;
export const getPrefabLightOverride = getLightOverride;

/** The entity origin is the light centre, independently of its billboard art. */
export function setPrefabLocalLight(owner: THREE.Object3D, light: PrefabLocalLight | null): void {
  if (light === null) delete owner.userData[LOCAL_LIGHT_KEY];
  else owner.userData[LOCAL_LIGHT_KEY] = light;
}

export function getPrefabLocalLight(owner: THREE.Object3D): PrefabLocalLight | undefined {
  return owner.userData[LOCAL_LIGHT_KEY] as PrefabLocalLight | undefined;
}

/** SpawnPrefab(light fx) + entity:SetParent(owner.entity). The returned remover is inst:Remove(). */
export function attachPrefabLight(parent: THREE.Object3D, name: string, light: PrefabLocalLight): () => void {
  const node = new THREE.Object3D();
  node.name = name;
  setPrefabLocalLight(node, light);
  parent.add(node);
  return () => {
    setPrefabLocalLight(node, null);
    node.removeFromParent();
  };
}
