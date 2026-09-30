import * as THREE from 'three';
import type { DstChestPanelElement } from '@three-roaming/ui';
import { backTasks } from './animate';
import { camera } from './camera';
import { renderer } from './universal';

export const CHEST_CONTAINER_ID = 'world:treasurechest:0';
export const CHEST_SLOT_COUNT = 9;
const ANCHOR_MARGIN = 1;

export interface ChestInventoryPanelController {
  setOpen(model: THREE.Object3D, isOpen: boolean): void;
}

export function createChestInventoryPanel(
  element: DstChestPanelElement,
): ChestInventoryPanelController {
  const bounds = new THREE.Box3();
  const anchor = new THREE.Vector3();
  let openModel: THREE.Object3D | undefined;

  const update = () => {
    if (!openModel || !openModel.visible || !element.slotContainer) {
      element.hidden = true;
      return;
    }

    openModel.updateWorldMatrix(true, true);
    bounds.setFromObject(openModel);
    if (bounds.isEmpty()) {
      element.hidden = true;
      return;
    }

    anchor.set(
      (bounds.min.x + bounds.max.x) / 2,
      bounds.max.y + ANCHOR_MARGIN,
      (bounds.min.z + bounds.max.z) / 2,
    ).project(camera);
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
    openModel = undefined;
    element.hidden = true;
  });

  return {
    setOpen(model, isOpen) {
      if (isOpen) {
        openModel = model;
        element.open({
          containerId: CHEST_CONTAINER_ID,
          slotCount: CHEST_SLOT_COUNT,
          title: '箱子',
        });
      } else if (openModel === model) {
        openModel = undefined;
        element.close();
      }
      update();
    },
  };
}
