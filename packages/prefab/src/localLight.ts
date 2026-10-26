import type * as THREE from 'three';
import type { LightJson } from '@dontstarve-web/display';
import { createEmptyEntity, type PrefabInstance } from './prefabInstance';

/** inst.Light's settings; radius is in this scene's world units. Entities declare them on `instance.light`. */
export type PrefabLocalLight = LightJson;

/**
 * SpawnPrefab(light) + entity:SetParent(owner.entity), as torchfire's CreateLight, lanternlight and
 * alterguardianhatlight: a non-persistent FX entity that declares only its light. `remove()` is inst:Remove().
 */
export function spawnLightEntity(parent: THREE.Object3D | undefined, prefab: string):
  { instance: PrefabInstance; model: THREE.Object3D; remove(): void } {
  const { instance, display } = createEmptyEntity(prefab);
  instance.addTag('FX');
  instance.persists = false;
  parent?.add(display.model);
  // Its light goes out with the removal; the display then releases the model.
  return { instance, model: display.model, remove: () => { instance.light.set(null); instance.remove(); } };
}
