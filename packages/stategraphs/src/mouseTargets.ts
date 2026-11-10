import { findActionEntity } from '../../prefab/src/actionEntity';
import type { Object3D } from 'three';
import { mouseTargets } from '../../prefab/src/mouseTargets';

/** Resolve a drawn descendant to its registered prefab root, independently of available actions. */
export function isMouseTarget(model: Object3D): boolean {
  const entity = findActionEntity(model);
  return entity !== undefined && mouseTargets.has(entity);
}

