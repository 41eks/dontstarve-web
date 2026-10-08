import * as THREE from 'three';
import type { DstChestPanelElement } from './chest-panel';
import { buildingContainerId, buildingContainerDefinition, type StorageBuildingId } from '@dontstarve-web/prefab/containers';
import definitions from '@dontstarve-web/prefab/definitions.json' with { type: 'json' };

export const CHEST_SLOT_COUNT = 9;
export const COOK_POT_SLOT_COUNT = 4;
const ANCHOR_MARGIN = 1;

export interface ChestInventoryPanelController {
  setOpen(model: THREE.Object3D, isOpen: boolean, prefab?: StorageBuildingId): void;
  update(): void;
}

export interface ChestInventoryPanelOptions {
  camera: THREE.Camera;
  canvas: Pick<HTMLCanvasElement, 'getBoundingClientRect'>;
  player: THREE.Object3D;
}

export function createChestInventoryPanel(
  element: DstChestPanelElement,
  { camera, canvas, player }: ChestInventoryPanelOptions,
  prefab: StorageBuildingId = 'treasurechest',
): ChestInventoryPanelController {
  const bounds = new THREE.Box3();
  const anchor = new THREE.Vector3();
  let openModel: THREE.Object3D | undefined;
  let openPrefab = prefab;

  const update = () => {
    if (!openModel || !openModel.visible || (!element.slotContainer && !element.isClosing)) {
      element.hidden = true;
      return;
    }

    const anchorModel = openPrefab.startsWith('mushroom_light') ? openModel : player;
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
    if (openPrefab === 'cookpot' || openPrefab.startsWith('mushroom_light')) {
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

    const canvasBounds = canvas.getBoundingClientRect();
    element.setAnchor(
      canvasBounds.left + (anchor.x + 1) * canvasBounds.width / 2,
      canvasBounds.top + (1 - anchor.y) * canvasBounds.height / 2,
    );
  };
  element.addEventListener('game:chest-close', () => {
    if (!element.isClosing) {
      openModel = undefined;
      element.hidden = true;
    }
  });

  return {
    update,
    setOpen(model, isOpen, buildingPrefab = prefab) {
      if (isOpen) {
        if (openModel !== model && element.slotContainer) element.close();
        openModel = model;
        openPrefab = buildingPrefab;
        const container = buildingContainerDefinition(buildingPrefab);
        element.open({
          containerId: buildingContainerId(buildingPrefab, String(model.userData.entityId)),
          slotCount: container.slotCount,
          columns: container.columns,
          panelArchive: container.panelArchive,
          singleItems: container.singleItems,
          title: definitions.animatedBuildings[buildingPrefab].buildLabel,
        });
      } else if (openModel === model) {
        element.close();
      }
      update();
    },
  };
}
