import { Pickable } from './components/pickable';
import { DefaultBurnFn, DefaultExtinguishFn, DefaultBurntFn, MakeNoGrowInWinter } from './standardcomponents';
import type * as THREE from 'three';
import { PickablePlantManager, PickablePlantInstance, type PickablePlantContext, type PickablePlantDefinition, type PickablePlantRecord, type PickablePlantWorld } from './pickablePlant';

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

/** Related fern prefabs share their source constructor; Pickable owns removal after picking. */
export class CaveFernInstance extends PickablePlantInstance {
  constructor(prefab: CaveFernId, context: PickablePlantContext) {
    super(CAVE_FERN_DEFINITIONS[prefab], context);
    const pickable = new Pickable(this, prefab === CAVE_FERN_ID ? 'foliage' : 'cutgrass', CAVE_FERN_REGROW_TIME, 1,
      () => this.playPickSound('dontstarve/wilson/pickup_plants'), undefined, context.saved?.components.pickable,
      { scheduler: context.scheduler, growthDuration: context.growthDuration, onRemove: () => this.remove() });
    pickable.quickpick = true; pickable.remove_when_picked = true;
    this.bindBurnable({ propagator: 'small', burnTime: 10, fxLevel: 2,
      onIgnite: () => DefaultBurnFn(this), onExtinguish: () => DefaultExtinguishFn(this), onBurnt: () => DefaultBurntFn(this, context.world) });
    MakeNoGrowInWinter(this, context.getWatchWorldContent);
  }
}

/** cave_fern.lua / cave_fern_withered.lua: bank `ferns`, a random pose, quickpick + remove_when_picked, small burnable. */
function caveFernDefinition(prefab: CaveFernId, buildArchive: string): PickablePlantDefinition {
  return {
    prefab,
    createInstance: context => new CaveFernInstance(prefab, context),
    animArchive: 'cave_ferns.zip',
    buildArchive,
    archiveSprite: { bank: 'ferns', instancedAnimations: 'all' },
    tags: [],
    variants: CAVE_FERN_ANIMATIONS,
    idle: { name: CAVE_FERN_ANIMATIONS[0], loop: false },
  };
}
export const CAVE_FERN_DEFINITIONS: Readonly<Record<CaveFernId, PickablePlantDefinition>> = {
  cave_fern: caveFernDefinition(CAVE_FERN_ID, 'cave_ferns.zip'),
  cave_fern_withered: caveFernDefinition(CAVE_FERN_WITHERED_ID, 'cave_ferns_withered_build.zip'),
};

/** cave_fern.lua / cave_fern_withered.lua: PICK foliage / cutgrass, burning, and a saved pose. */
export class CaveFernManager extends PickablePlantManager {
  spawn(prefabId: CaveFernId, position: THREE.Vector3, saved?: CaveFernRecord): THREE.Group {
    return this.spawnPlant(CAVE_FERN_DEFINITIONS[prefabId], position, saved);
  }

  exportRecords(): { prefabId: CaveFernId; record: CaveFernRecord }[] {
    return this.exportPlants().map(({ prefab, record }) => ({ prefabId: prefab as CaveFernId, record }));
  }
}
