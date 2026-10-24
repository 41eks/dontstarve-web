import type * as THREE from 'three';
import { PickablePlantManager, type PickablePlantDefinition, type PickablePlantRecord, type PickablePlantWorld } from './pickablePlant';

export const GRASS_ID = 'grass' as const;
export const GRASS_REGROW_TIME = 3 * 480;

export type GrassRecord = PickablePlantRecord;
export type GrassWorld = PickablePlantWorld;

/** grass.lua: grass bank with the grass1 build, picking → picked, and dug_grass loot. */
export const GRASS_DEFINITION: PickablePlantDefinition = {
  prefab: GRASS_ID,
  animArchive: 'grass.zip',
  buildArchive: 'grass1.zip',
  archiveSprite: { bank: 'grass', instancedAnimations: 'all' },
  tags: ['plant', 'renewable', 'silviculture', 'lunarplant_target'],
  product: 'cutgrass',
  regrowTime: GRASS_REGROW_TIME,
  idle: { name: 'idle' },
  picked: { sound: 'dontstarve/wilson/pickup_reeds', clips: ['picking', 'picked'] },
  empty: { name: 'picked', frame: 'last' },
  grow: 'grow',
  dugLoot: 'dug_grass',
};

/** grass.lua's native grass, with source component ownership for PICK, DIG and burning. */
export class GrassManager extends PickablePlantManager {
  spawn(position: THREE.Vector3, saved?: GrassRecord): Promise<THREE.Group> {
    return this.spawnPlant(GRASS_DEFINITION, position, saved);
  }

  exportRecords(): GrassRecord[] { return this.exportPlants().map(({ record }) => record); }
}
