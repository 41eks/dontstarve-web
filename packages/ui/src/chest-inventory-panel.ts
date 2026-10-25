import { prefabInstance } from '@dontstarve-web/prefab/prefabInstance';
import * as THREE from 'three';
import type { DstChestPanelElement } from './chest-panel';
import { buildingContainerId, buildingContainerDefinition, type StorageBuildingId } from '@dontstarve-web/prefab/containers';
import { PLAYER_COLLIDER_RADIUS } from '@dontstarve-web/prefab/player';
import definitions from '@dontstarve-web/prefab/definitions.json' with { type: 'json' };
import type { InventoryStack } from '@dontstarve-web/inventory';
import type { SlotItem } from './slot/slot-model';
import type { CookRequestDetail } from './cook-pot-panel';
import { createEffect, WorldContentKey, type GetWatchWorldContent, type ReadonlySignal } from '@dontstarve-web/signals';

export const CHEST_SLOT_COUNT = 9;
export const COOK_POT_SLOT_COUNT = 4;
const ANCHOR_MARGIN = 1;
/** The player's animated bounds change every frame, so its anchor box is a fixed multiple of the collider radius. */
const PLAYER_HEIGHT_RADII = 3.6;
const PLAYER_HALF_WIDTH_RADII = 2.5;

export interface ChestInventoryPanelController {
  setOpen(model: THREE.Object3D, isOpen: boolean, prefab?: StorageBuildingId): void;
  bindActions(dispatcher: { performContainerAction(model: THREE.Object3D, action: 'COOK', doer: object): boolean }): void;
  dispose(): void;
}

export interface ChestInventoryPanelOptions {
  camera: THREE.Camera;
  canvas: Pick<HTMLCanvasElement, 'getBoundingClientRect'>;
  player: THREE.Object3D;
  /** The anchor follows the world's player positions, which are published once per 60 active frames. */
  getWatchWorldContent: GetWatchWorldContent;
  toItem?: (record: Readonly<InventoryStack>) => SlotItem;
}

export function createChestInventoryPanel(
  element: DstChestPanelElement,
  { camera, canvas, player, getWatchWorldContent, toItem }: ChestInventoryPanelOptions,
  prefab: StorageBuildingId = 'treasurechest',
): ChestInventoryPanelController {
  const bounds = new THREE.Box3();
  // Animated frames change the model's bounds every frame, so measure once per opening and follow the model's position.
  const bounds0 = new THREE.Box3();
  const origin = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  let openModel: THREE.Object3D | undefined;
  let openPrefab = prefab;
  let stopBurnt: (() => void) | undefined;
  let actions: { performContainerAction(model: THREE.Object3D, action: 'COOK', doer: object): boolean } | undefined;
  const cook = (event: Event) => {
    const { containerId } = (event as CustomEvent<CookRequestDetail>).detail;
    if (!openModel || element.slotContainer?.id !== containerId) return;
    actions?.performContainerAction(openModel, 'COOK', player);
  };
  element.addEventListener('game:cook-request', cook);

  const update = () => {
    if (!openModel || !openModel.visible || (!element.slotContainer && !element.isClosing)) {
      if (!element.hidden) element.hidden = true;
      return;
    }

    if (openPrefab.startsWith('mushroom_light')) {
      // Static model: measure its animated bounds once per opening and follow its position.
      openModel.updateWorldMatrix(true, true);
      openModel.getWorldPosition(origin);
      if (bounds0.isEmpty()) {
        bounds0.setFromObject(openModel);
        bounds0.min.sub(origin);
        bounds0.max.sub(origin);
      }
      bounds.min.copy(bounds0.min).add(origin);
      bounds.max.copy(bounds0.max).add(origin);
    } else {
      const { position } = player;
      const half = PLAYER_COLLIDER_RADIUS * PLAYER_HALF_WIDTH_RADII;
      bounds.min.set(position.x - half, position.y, position.z - half);
      bounds.max.set(position.x + half, position.y + PLAYER_COLLIDER_RADIUS * PLAYER_HEIGHT_RADII, position.z + half);
    }
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
    if (element.hidden === inView) element.hidden = !inView;
    if (!inView) return;

    const canvasBounds = canvas.getBoundingClientRect();
    element.setAnchor(
      canvasBounds.left + (anchor.x + 1) * canvasBounds.width / 2,
      canvasBounds.top + (1 - anchor.y) * canvasBounds.height / 2,
    );
  };
  const cleanups: (() => void)[] = [];
  const playerpositions = getWatchWorldContent(WorldContentKey.PlayerPositions, stop => cleanups.push(stop));
  createEffect(() => { playerpositions.get(); update(); });
  const close = () => {
    stopBurnt?.(); stopBurnt = undefined;
    openModel?.userData.components?.container?.Close(player);
    if (!element.isClosing) {
      openModel = undefined;
      element.hidden = true;
    }
  };
  element.addEventListener('game:chest-close', close);

  return {
    bindActions(dispatcher) { actions = dispatcher; },
    dispose() {
      cleanups.forEach(stop => stop());
      stopBurnt?.(); stopBurnt = undefined;
      element.removeEventListener('game:cook-request', cook);
      element.removeEventListener('game:chest-close', close);
      actions = undefined; openModel = undefined;
    },
    setOpen(model, isOpen, buildingPrefab = prefab) {
      if (isOpen) {
        const burnt = model.userData.burntSignal as ReadonlySignal<boolean> | undefined;
        if (burnt?.peek()) return;
        if (openModel !== model && element.slotContainer) element.close();
        stopBurnt?.(); stopBurnt = undefined;
        openModel = model;
        bounds0.makeEmpty();
        openPrefab = buildingPrefab;
        const container = buildingContainerDefinition(buildingPrefab);
        element.open({
          containerId: buildingContainerId(buildingPrefab, String(prefabInstance(model)?.entityId)),
          slotCount: container.slotCount,
          columns: container.columns,
          panelArchive: container.panelArchive,
          slotGrid: container.slotGrid,
          singleItems: container.singleItems,
          title: definitions.animatedBuildings[buildingPrefab].buildLabel,
        });
        const component = model.userData.components?.container;
        if (component && toItem) element.bindContainer(component.toSignal(), toItem);
        stopBurnt = burnt?.subscribe(value => { if (value) element.close(); });
      } else if (openModel === model) {
        stopBurnt?.(); stopBurnt = undefined;
        element.close();
      }
      update();
    },
  };
}
