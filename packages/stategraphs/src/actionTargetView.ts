import type * as THREE from 'three';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import type { PrefabInstance } from '../../prefab/src/prefabInstance';

/** Logical prefabs declare their instance; legacy targets still supply a drawn model. */
export type ActionTargetView =
  | { readonly instance: PrefabInstance<ArchiveSpriteCommands>; readonly display: PrefabDisplay; readonly model?: never }
  | { readonly model: THREE.Group; readonly instance?: never; readonly display?: never };

/** Pointer picking uses the model owned by the display of a logical target. */
export function actionTargetModel(target: ActionTargetView): THREE.Group {
  return target.display ? target.display.model : target.model;
}
