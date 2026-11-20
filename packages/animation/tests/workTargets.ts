import type { Object3D } from 'three';
import type { PrefabDisplay } from '@dontstarve-web/display';
import { prefabDisplay } from '@dontstarve-web/display';
import { actionEntities } from '../../prefab/src/actionEntity';
import type { ActionEntity } from '../../prefab/src/prefabInstance';
import { createBufferedAction } from '../../stategraphs/src/actionfns';
import type { ItemEntity } from '../../inventory/src/entity';
import type { PickupDoer } from '../../stategraphs/src/pickup';
import { actionDoer } from './actionDoer';
import type { WorkAction } from '../../componets/src/workable';

/** A live entity whose workable currently takes `action`, as componentactions finds it through its tags. */
export interface WorkTarget {
  readonly entity: ActionEntity;
  readonly model: Object3D;
  readonly id: string;
  readonly display: PrefabDisplay;
  readonly position: ReturnType<ActionEntity['getPosition']>;
  isValid(): boolean;
  /** One ACTIONS[action].fn on this target, as the stategraph's hit frame runs it. */
  work(doer?: { readonly components?: Partial<PickupDoer['components']> }, tool?: ItemEntity): boolean;
}

/** `model` itself, or drawn somewhere below `root` (its scene, say). */
function contains(root: Object3D, model: Object3D): boolean {
  for (let node: Object3D | null = model; node; node = node.parent) { if (node === root) { return true; } }
  return false;
}

/**
 * The live entities tagged `<action>_workable`, optionally only the one drawn by `model`, those drawn under a scene
 * `root`, or those of `prefab`. Tests use this in place of a manager's target list.
 */
export function workTargets(action: WorkAction, filter?: Object3D | string): WorkTarget[] {
  // An asleep entity keeps its components: it cannot be picked, but an action still reaches it.
  const isValid = (entity: ActionEntity) => !entity.isRemoved && entity.hasTag(`${action}_workable`);
  return [...actionEntities()].filter(entity => isValid(entity)
    && (filter === undefined || (typeof filter === 'string' ? entity.prefab === filter : contains(filter, entity.transform.model))))
    .map((entity): WorkTarget => ({
      entity, model: entity.transform.model,
      id: entity.entityId ?? '',
      get display() { return prefabDisplay(entity.transform.model)!; },
      get position() { return entity.getPosition(); },
      isValid: () => isValid(entity),
      work: (doer = {}, tool) => createBufferedAction(action, { doer: actionDoer(doer.components), target: entity, invobject: tool }).do(),
    }));
}
