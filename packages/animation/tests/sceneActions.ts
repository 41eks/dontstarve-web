import type { Object3D } from 'three';
import { findActionEntity } from '../../prefab/src/actionEntity';
import { createBufferedAction } from '../../stategraphs/src/actionfns';
import { collectSceneActions, type SceneActionDoer } from '../../stategraphs/src/componentactions';
import type { PlayerActionDoer } from '../../stategraphs/src/actionfns';
import { actionDoer } from './actionDoer';

type Doer = PlayerActionDoer;

/** A player with an inventory, for scene entries that only read the doer's tags and slots. */
export const sceneDoer: Doer = actionDoer();

/** GetSceneActions: what the entity drawn by `model` offers the doer on a button (none without an entity). */
export function sceneActions(model: Object3D, doer: SceneActionDoer = sceneDoer, right = false): string[] {
  const entity = findActionEntity(model);
  return entity ? collectSceneActions(entity, doer, right) : [];
}

/** The BufferedAction PlayerController would buffer for that action, as actions.lua's validfn judges it. */
export function sceneAction(action: string, model: Object3D, doer: Doer = sceneDoer) {
  const target = findActionEntity(model);
  if (!target) { throw new Error(`No action entity for ${model.name}`); }
  return createBufferedAction(action, { doer, target });
}

/** Offered by the scene entry and valid now. */
export function canDoSceneAction(action: string, model: Object3D, doer: Doer = sceneDoer): boolean {
  return sceneActions(model, doer).includes(action) && sceneAction(action, model, doer).isValid();
}
