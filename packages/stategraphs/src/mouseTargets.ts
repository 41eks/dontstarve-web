import { findActionEntity } from '../../prefab/src/actionEntity';
import type { Object3D } from 'three';
import type { FoundEntity } from '../../prefab/src/activePrefabs';
import { mouseTargets } from '../../prefab/src/mouseTargets';

/** Resolve a drawn descendant to its registered prefab root, independently of available actions. */
export function isMouseTarget(model: Object3D): boolean {
  const entity = findActionEntity(model) as FoundEntity | undefined;
  return entity?.model === model && mouseTargets.has(entity);
}

