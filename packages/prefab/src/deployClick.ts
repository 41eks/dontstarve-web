import type * as THREE from 'three';
import type { ItemEntity } from '@dontstarve-web/inventory';
import type { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { modelHasTag } from './prefabInstance';

/** The cursor-held item a deployment acts on. */
export interface DeploySource {
  readonly entity: ItemEntity;
  isValid(): boolean;
  take(): ItemEntity | undefined;
  putBack(item: ItemEntity): void;
  /** inventory.lua ReturnActiveItem. */
  returnActiveItem(): void;
}

/** GetRightClickActions: an active item only gets point actions on no entity, or on one that does not catch the mouse. */
export function allowsPointDeploy(target: THREE.Object3D | undefined): boolean {
  return !target || ['walkableplatform', 'walkableperipheral', 'ignoremouseover'].some(tag => modelHasTag(target, tag));
}

/** playercontroller.lua OnRightClick for an active deployable item: no action at the pointer returns the item. */
export function deployRightClick(event: PointerEvent, picker: PlayerActionPicker, source: DeploySource,
  deploy: (point: THREE.Vector3) => boolean, cancel: () => void): void {
  const right = picker.getMouseActions(event).right;
  if (right ? right.action !== 'DEPLOY' : !picker.canPickClickAction()) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const point = right && picker.pointer.groundPoint();
  if (point && deploy(point)) return;
  cancel();
  if (!right) source.returnActiveItem();
}
