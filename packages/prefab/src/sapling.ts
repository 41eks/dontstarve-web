import type * as THREE from 'three';
import { PickablePlantManager, type PickablePlantDefinition, type PickablePlantRecord, type PickablePlantWorld } from './pickablePlant';

export const SAPLING_PREFABS = ['sapling', 'sapling_moon'] as const;
export type SaplingPrefabId = typeof SAPLING_PREFABS[number];
/** TUNING.SAPLING_REGROW_TIME = total_day_time * 4. */
export const SAPLING_REGROW_TIME = 4 * 480;

export type SaplingRecord = PickablePlantRecord;
export type SaplingWorld = PickablePlantWorld;

/** sapling.lua sapling_common: bank/build share the prefab name; is_moon digs up dug_sapling_moon. */
function saplingDefinition(prefab: SaplingPrefabId): PickablePlantDefinition {
  return {
    prefab,
    animArchive: `${prefab}.zip`,
    buildArchive: `${prefab}.zip`,
    tags: ['plant', 'renewable', 'silviculture', 'lunarplant_target'],
    product: 'twigs',
    regrowTime: SAPLING_REGROW_TIME,
    idle: { name: 'sway', randomFrame: true },
    // onpickedfn only plays the clip; pickable.picksound is read by WX-78's stategraph, not the player's.
    picked: { clips: ['picked'] },
    empty: { name: 'empty', frame: 'first' },
    grow: 'grow',
    dugLoot: `dug_${prefab}`,
  };
}
export const SAPLING_DEFINITIONS: Readonly<Record<SaplingPrefabId, PickablePlantDefinition>> = {
  sapling: saplingDefinition('sapling'),
  sapling_moon: saplingDefinition('sapling_moon'),
};

/** sapling.lua: PICK twigs, DIG, burning and winter-paused regrowth. */
export class SaplingManager extends PickablePlantManager {
  spawn(prefabId: SaplingPrefabId, position: THREE.Vector3, saved?: SaplingRecord): Promise<THREE.Group> {
    return this.spawnPlant(SAPLING_DEFINITIONS[prefabId], position, saved);
  }

  exportRecords(): { prefabId: SaplingPrefabId; record: SaplingRecord }[] {
    return this.exportPlants().map(({ prefab, record }) => ({ prefabId: prefab as SaplingPrefabId, record }));
  }
}
