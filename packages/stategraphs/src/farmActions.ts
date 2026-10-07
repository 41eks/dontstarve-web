import type * as THREE from 'three';

export interface FarmSoilTarget {
  id: string;
  model: THREE.Group;
  position: THREE.Vector3;
  isValid(): boolean;
}
export interface PreparedSeedPlant {
  apply(takeSeed: () => boolean): boolean;
  dispose(): void;
}
export interface PreparedFarmTill { apply(): boolean; dispose(): void; }

/** Farm prefabs prepare their art and own atomic changes to soil entities. */
export interface FarmActionWorld {
  readonly soilTargets: readonly FarmSoilTarget[];
  canTill(point: Pick<THREE.Vector3, 'x' | 'z'>): boolean;
  prepareTill(point: THREE.Vector3): Promise<PreparedFarmTill | undefined>;
  prepareSeedPlant(id: string): Promise<PreparedSeedPlant | undefined>;
}

export interface TerraformMap {
  readonly size: number;
  canTerraform(point: Pick<THREE.Vector3, 'x' | 'z'>): boolean;
  dig(point: Pick<THREE.Vector3, 'x' | 'z'>): boolean;
  tileCenter(point: Pick<THREE.Vector3, 'x' | 'z'>): Pick<THREE.Vector3, 'x' | 'z'>;
}
