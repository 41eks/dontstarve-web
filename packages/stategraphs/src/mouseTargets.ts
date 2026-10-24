import type { Object3D } from 'three';
import { activePrefabs, type FoundEntity } from '../../prefab/src/activePrefabs';

/** Resolve a drawn descendant to its active prefab root, independently of available actions. */
export function isMouseTarget(model: Object3D): boolean {
  const entity = model.userData.actionEntity as FoundEntity | undefined;
  return !!model.parent && entity?.model === model && !entity.isRemoved
    && !entity.hasTag('NOCLICK') && activePrefabs.includes(entity);
}

