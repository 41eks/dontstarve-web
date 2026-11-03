import { Transform } from '../../prefab/src/transform';
import type { Group, Object3D } from 'three';
import { SpriteState } from '@dontstarve-web/display';
import { bindInstance, PrefabInstance } from '../../prefab/src/prefabInstance';

/**
 * Give a test's own model the entity a display would draw for it, with these tags: action entities project
 * instance-backed models, whose tags and removal belong to the instance.
 */
export function withEntity<T extends Object3D>(model: T, prefab: string, tags: readonly string[] = []): T {
  const instance = new PrefabInstance(prefab, new SpriteState({ name: '' }), new Transform(undefined, model as unknown as Group));
  for (const tag of tags) instance.addTag(tag);
  bindInstance(model, instance);
  return model;
}
