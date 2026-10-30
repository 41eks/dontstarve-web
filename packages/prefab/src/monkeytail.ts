import { prefabInstance } from './prefabInstance';
import { Pickable } from './components/pickable';
import type * as THREE from 'three';
import { PickablePlantManager, type PickablePlantDefinition, type PickablePlantRecord } from './pickablePlant';

export const MONKEYTAIL_ID = 'monkeytail' as const;
export const MONKEYTAIL_REGROW_TIME = 3 * 480;
export const MONKEYTAIL_DEFINITION: PickablePlantDefinition = {
  prefab: MONKEYTAIL_ID, animArchive: 'grass.zip', buildArchive: 'reeds_monkeytails.zip',
  archiveSprite: { bank: 'grass', instancedAnimations: 'all' },
  tags: ['plant', 'silviculture', 'witherable'], product: 'cutreeds', regrowTime: MONKEYTAIL_REGROW_TIME,
  idle: { name: 'idle', randomFrame: true },
  picked: { sound: 'dontstarve/wilson/pickup_reeds', clips: ['picking', 'picked'] },
  empty: { name: 'picked', frame: 'last' }, grow: 'grow', barren: 'idle_dead',
  dugLoot: 'dug_monkeytail', maxCycles: () => 5 + Math.floor(Math.random() * 3),
  witherable: true, burnTime: 15, burnFxLevel: 2, deploySmartRadius: 1.5,
};

/** monkeytail.lua: wild reeds regrow indefinitely; transplanted plants require fertilizer. */
export class MonkeytailManager extends PickablePlantManager {
  spawn(position: THREE.Vector3, saved?: PickablePlantRecord): THREE.Group {
    return this.spawnPlant(MONKEYTAIL_DEFINITION, position, saved);
  }
  /** dug_monkeytail ondeploy: SpawnPrefab, then OnTransplant; the display loads the art. */
  transplant(position: THREE.Vector3): boolean {
    (prefabInstance(this.spawnPlant(MONKEYTAIL_DEFINITION, position))!.components.pickable as Pickable).OnTransplant();
    return true;
  }
  exportRecords(): PickablePlantRecord[] { return this.exportPlants().map(({ record }) => record); }
}
