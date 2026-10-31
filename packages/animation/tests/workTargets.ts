import type { Object3D } from 'three';
import type { PrefabDisplay } from '@dontstarve-web/display';
import { prefabDisplay } from '@dontstarve-web/display';
import { activePrefabs, type FoundEntity } from '../../prefab/src/activePrefabs';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { createBufferedAction } from '../../stategraphs/src/actionfns';
import type { BufferedActionDoer, BufferedActionObject } from '../../stategraphs/src/bufferedaction';
import type { WorkAction } from '../../componets/src/workable';

/** A live entity whose workable currently takes `action`, as componentactions finds it through its tags. */
export interface WorkTarget {
  readonly entity: FoundEntity;
  readonly model: Object3D;
  readonly id: string;
  readonly display: PrefabDisplay;
  readonly position: ReturnType<FoundEntity['getPosition']>;
  isValid(): boolean;
  /** One ACTIONS[action].fn on this target, as the stategraph's hit frame runs it. */
  work(doer?: BufferedActionDoer, tool?: BufferedActionObject): boolean;
}

/** `model` itself, or drawn somewhere below `root` (its scene, say). */
function contains(root: Object3D, model: Object3D): boolean {
  for (let node: Object3D | null = model; node; node = node.parent) if (node === root) return true;
  return false;
}

/**
 * The world's active entities tagged `<action>_workable` (TheSim:FindEntities with that tag), optionally only the
 * one drawn by `model`, those drawn under a scene `root`, or those of `prefab`. Tests use this in place of a manager's target list.
 */
export function workTargets(action: WorkAction, filter?: Object3D | string): WorkTarget[] {
  // An asleep entity keeps its components: it cannot be picked, but an action still reaches it.
  const isValid = (entity: FoundEntity) => !entity.isRemoved && entity.hasTag(`${action}_workable`);
  return activePrefabs.filter(entity => isValid(entity)
    && (filter === undefined || (typeof filter === 'string' ? entity.prefab === filter : contains(filter, entity.model))))
    .map(entity => ({
      entity, model: entity.model,
      id: String(prefabInstance(entity.model)?.entityId ?? (entity as { id?: unknown }).id ?? ''),
      get display() { return prefabDisplay(entity.model)!; },
      get position() { return entity.getPosition(); },
      isValid: () => isValid(entity),
      work: (doer = {}, tool) => createBufferedAction(action, { doer, target: entity, invobject: tool }).do(),
    }) as WorkTarget);
}
