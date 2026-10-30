import type * as THREE from 'three';

export interface FarmSoilTarget {
  id: string;
  model: THREE.Group;
  position: THREE.Vector3;
  isValid(): boolean;
}
/** Farm prefabs own atomic changes to soil entities, committed on the action's hit frame. */
export interface FarmActionWorld {
  readonly soilTargets: readonly FarmSoilTarget[];
  canTill(point: THREE.Vector3): boolean;
  till(point: THREE.Vector3): boolean;
  plantSeed(id: string, seedItemId: string | undefined, takeSeed: () => boolean): boolean;
}

export interface TerraformMap {
  readonly size: number;
  canTerraform(point: Pick<THREE.Vector3, 'x' | 'z'>): boolean;
  dig(point: Pick<THREE.Vector3, 'x' | 'z'>): boolean;
  tileCenter(point: Pick<THREE.Vector3, 'x' | 'z'>): Pick<THREE.Vector3, 'x' | 'z'>;
}
