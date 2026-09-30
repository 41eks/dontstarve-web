import * as THREE from 'three';
import type { DstChestPanelElement } from '@three-roaming/ui';
import { backTasks } from './animate';
import { camera } from './camera';
import { renderer } from './universal';
import { player } from './player';
import { chestContainerId, cookPotContainerId } from './save/inventoryState';

export const CHEST_SLOT_COUNT = 9;
export const COOK_POT_SLOT_COUNT = 4;
const ANCHOR_MARGIN = 1;

export interface ChestInventoryPanelController {
  setOpen(model: THREE.Object3D, isOpen: boolean): void;
}

export function createChestInventoryPanel(
  element: DstChestPanelElement,
  prefab: 'treasurechest' | 'cookpot' = 'treasurechest',
): ChestInventoryPanelController {
  const bounds = new THREE.Box3();
  const anchor = new THREE.Vector3();
  let openModel: THREE.Object3D | undefined;

  const update = () => {
    if (!openModel || !openModel.visible || (!element.slotContainer && !element.isClosing)) {
      element.hidden = true;
      return;
    }

    const anchorModel = prefab === 'treasurechest' ? player : openModel;
    anchorModel.updateWorldMatrix(true, true);
    bounds.setFromObject(anchorModel);
    if (bounds.isEmpty()) {
      element.hidden = true;
      return;
    }

    anchor.set(
      (bounds.min.x + bounds.max.x) / 2,
      bounds.max.y + ANCHOR_MARGIN,
      (bounds.min.z + bounds.max.z) / 2,
    ).project(camera);
    if (prefab === 'cookpot') {
      // Project all box corners so the panel stays to the sprite's screen-right
      // even when the camera heading changes.
      let right = -Infinity;
      const corner = new THREE.Vector3();
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            corner.set(x, y, z).project(camera);
            right = Math.max(right, corner.x);
          }
        }
      }
      anchor.copy(bounds.getCenter(corner)).project(camera);
      anchor.x = right;
    }
    const inView = anchor.z >= -1 && anchor.z <= 1
      && anchor.x >= -1.2 && anchor.x <= 1.2
      && anchor.y >= -1.2 && anchor.y <= 1.2;
    element.hidden = !inView;
    if (!inView) return;

    const canvasBounds = renderer.domElement.getBoundingClientRect();
    element.setAnchor(
      canvasBounds.left + (anchor.x + 1) * canvasBounds.width / 2,
      canvasBounds.top + (1 - anchor.y) * canvasBounds.height / 2,
    );
  };
  backTasks.push(update);
  element.addEventListener('game:chest-close', () => {
    if (!element.isClosing) {
      openModel = undefined;
      element.hidden = true;
    }
  });

  return {
    setOpen(model, isOpen) {
      if (isOpen) {
        if (openModel !== model && element.slotContainer) element.close();
        openModel = model;
        element.open({
          containerId: (prefab === 'cookpot' ? cookPotContainerId : chestContainerId)(String(model.userData.entityId)),
          slotCount: prefab === 'cookpot' ? COOK_POT_SLOT_COUNT : CHEST_SLOT_COUNT,
          title: prefab === 'cookpot' ? '烹饪锅' : '箱子',
        });
      } else if (openModel === model) {
        element.close();
      }
      update();
    },
  };
}
