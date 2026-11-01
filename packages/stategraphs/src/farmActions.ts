import type * as THREE from 'three';

/** Farm prefabs own atomic changes to soil entities, committed on the action's hit frame. */
export interface FarmActionWorld {
  canTill(point: THREE.Vector3): boolean;
  till(point: THREE.Vector3): boolean;
}

export interface TerraformMap {
  readonly size: number;
  canTerraform(point: Pick<THREE.Vector3, 'x' | 'z'>): boolean;
  dig(point: Pick<THREE.Vector3, 'x' | 'z'>): boolean;
  tileCenter(point: Pick<THREE.Vector3, 'x' | 'z'>): Pick<THREE.Vector3, 'x' | 'z'>;
}
