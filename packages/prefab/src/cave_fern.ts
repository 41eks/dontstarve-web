import type * as THREE from 'three';
import { PickablePlantManager, type PickablePlantDefinition, type PickablePlantRecord, type PickablePlantWorld } from './pickablePlant';

export const CAVE_FERN_ID = 'cave_fern' as const;
export const CAVE_FERN_WITHERED_ID = 'cave_fern_withered' as const;
export const CAVE_FERN_IDS = [CAVE_FERN_ID, CAVE_FERN_WITHERED_ID] as const;
export type CaveFernId = typeof CAVE_FERN_IDS[number];
/** cave_fern.lua / cave_fern_withered.lua `names`. */
export const CAVE_FERN_ANIMATIONS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10'] as const;
/** pickable:SetUp(product, 10), moot because remove_when_picked removes the fern. */
const CAVE_FERN_REGROW_TIME = 10;

export type CaveFernRecord = PickablePlantRecord;
export type CaveFernWorld = PickablePlantWorld;

/** cave_fern.lua / cave_fern_withered.lua: bank `ferns`, a random pose, quickpick + remove_when_picked, small burnable. */
function caveFernDefinition(prefab: CaveFernId, buildArchive: string, product: string): PickablePlantDefinition {
  return {
    prefab,
    animArchive: 'cave_ferns.zip',
    buildArchive,
    archiveSprite: { bank: 'ferns', instancedAnimations: 'all' },
    tags: [],
    product,
    regrowTime: CAVE_FERN_REGROW_TIME,
    variants: CAVE_FERN_ANIMATIONS,
    idle: { name: CAVE_FERN_ANIMATIONS[0] },
    picked: { sound: 'dontstarve/wilson/pickup_plants', clips: [] },
    removeWhenPicked: true,
    quickpick: true,
    burnTime: 10,
    burnFxLevel: 2,
    propagatorSize: 'small',
  };
}
export const CAVE_FERN_DEFINITIONS: Readonly<Record<CaveFernId, PickablePlantDefinition>> = {
  cave_fern: caveFernDefinition(CAVE_FERN_ID, 'cave_ferns.zip', 'foliage'),
  cave_fern_withered: caveFernDefinition(CAVE_FERN_WITHERED_ID, 'cave_ferns_withered_build.zip', 'cutgrass'),
};

/** cave_fern.lua / cave_fern_withered.lua: PICK foliage / cutgrass, burning, and a saved pose. */
export class CaveFernManager extends PickablePlantManager {
  spawn(prefabId: CaveFernId, position: THREE.Vector3, saved?: CaveFernRecord): Promise<THREE.Group> {
    return this.spawnPlant(CAVE_FERN_DEFINITIONS[prefabId], position, saved);
  }

  exportRecords(): { prefabId: CaveFernId; record: CaveFernRecord }[] {
    return this.exportPlants().map(({ prefab, record }) => ({ prefabId: prefab as CaveFernId, record }));
  }
}
