import type { Object3D } from 'three';
import { SpriteState } from '@dontstarve-web/display';
import { bindInstance, PrefabInstance } from '../../prefab/src/prefabInstance';

/**
 * Give a test's own model the entity a display would draw for it, with these tags: action entities project
 * instance-backed models, whose tags and removal belong to the instance.
 */
export function withEntity<T extends Object3D>(model: T, prefab: string, tags: readonly string[] = []): T {
  const instance = new PrefabInstance(prefab, new SpriteState({ name: '' }));
  for (const tag of tags) instance.addTag(tag);
  bindInstance(model, instance);
  return model;
}
