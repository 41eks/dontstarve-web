import * as THREE from 'three';
import type { DstChestPanelElement } from './chest-panel';
import type { EntitySlots } from './slot/slot-binding';
import {
  buildingContainerDefinition,
  containerPanelAnchor,
  type ContainerButtonAction,
  type ContainerPanelAnchor,
  type StorageBuildingId,
} from '@dontstarve-web/prefab/containers';
import { PLAYER_COLLIDER_RADIUS } from '@dontstarve-web/prefab/player_common';
import definitions from '@dontstarve-web/prefab/definitions.json' with { type: 'json' };
import type { ItemEntity } from '@dontstarve-web/inventory';
import type { SlotItem } from './slot/slot-model';
import type { GameUiEventMap } from './events';
import { createEffect, WorldContentKey, type GetWatchWorldContent } from '@dontstarve-web/signals';

export const CHEST_SLOT_COUNT = 9;
export const COOK_POT_SLOT_COUNT = 4;
const ANCHOR_MARGIN = 1;
/** The player's animated bounds change every frame, so its anchor box is a fixed multiple of the collider radius. */
const PLAYER_HEIGHT_RADII = 3.6;
const PLAYER_HALF_WIDTH_RADII = 2.5;

/** The container a panel shows: its address and the slots the panel mirrors. */
export interface ChestPanelContents {
  containerId: string;
  slots: EntitySlots<ItemEntity>;
}

export interface ChestInventoryPanelController {
  open(model: THREE.Object3D, prefab: StorageBuildingId, contents: ChestPanelContents): void;
  close(model: THREE.Object3D): void;
  bindActions(dispatcher: ContainerActionDispatcher): void;
  dispose(): void;
}

/** widget.buttoninfo.fn: BufferedAction(doer, inst, ACTIONS[action]):Do() on the open container's entity. */
export interface ContainerActionDispatcher {
  performContainerAction(model: THREE.Object3D, action: ContainerButtonAction, doer: object): boolean;
}

export interface ChestInventoryPanelOptions {
  camera: THREE.Camera;
  canvas: Pick<HTMLCanvasElement, 'getBoundingClientRect'>;
  player: THREE.Object3D;
  /** The anchor follows the world's player positions, which are published once per 60 active frames. */
  getWatchWorldContent: GetWatchWorldContent;
  toItem?: (item: ItemEntity) => SlotItem;
  /** The player closed the panel: the owner closes the model's container. */
  closeContainer: (model: THREE.Object3D) => void;
}

export function createChestInventoryPanel(
  element: DstChestPanelElement,
  { camera, canvas, player, getWatchWorldContent, toItem, closeContainer }: ChestInventoryPanelOptions,
): ChestInventoryPanelController {
  const bounds = new THREE.Box3();
  // Animated frames change the model's bounds every frame, so measure once per opening and follow the model's position.
  const bounds0 = new THREE.Box3();
  const origin = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  let openModel: THREE.Object3D | undefined;
  let panelAnchor: ContainerPanelAnchor = 'player-top';
  let actions: ContainerActionDispatcher | undefined;
  let openButton: ContainerButtonAction | undefined;
  const pressButton = (event: GameUiEventMap['game:container-button']) => {
    const { containerId } = event.detail;
    if (!openModel || !openButton || element.slotContainer?.id !== containerId) {
      return;
    }
    actions?.performContainerAction(openModel, openButton, player);
  };
  element.addEventListener('game:container-button', pressButton);

  const update = () => {
    if (!openModel || !openModel.visible || (!element.slotContainer && !element.isClosing)) {
      if (!element.hidden) {
        element.hidden = true;
      }
      return;
    }

    if (panelAnchor === 'building-right') {
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

    anchor
      .set((bounds.min.x + bounds.max.x) / 2, bounds.max.y + ANCHOR_MARGIN, (bounds.min.z + bounds.max.z) / 2)
      .project(camera);
    if (panelAnchor !== 'player-top') {
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
    const inView =
      anchor.z >= -1 && anchor.z <= 1 && anchor.x >= -1.2 && anchor.x <= 1.2 && anchor.y >= -1.2 && anchor.y <= 1.2;
    if (element.hidden === inView) {
      element.hidden = !inView;
    }
    if (!inView) {
      return;
    }

    const canvasBounds = canvas.getBoundingClientRect();
    element.setAnchor(
      canvasBounds.left + ((anchor.x + 1) * canvasBounds.width) / 2,
      canvasBounds.top + ((1 - anchor.y) * canvasBounds.height) / 2,
    );
  };
  const cleanups: (() => void)[] = [];
  const playerpositions = getWatchWorldContent(WorldContentKey.PlayerPositions, stop => cleanups.push(stop));
  createEffect(() => {
    playerpositions.get();
    update();
  });
  const close = () => {
    if (openModel) {
      closeContainer(openModel);
    }
    if (!element.isClosing) {
      openModel = undefined;
      element.hidden = true;
    }
  };
  element.addEventListener('game:chest-close', close);

  return {
    bindActions(dispatcher) {
      actions = dispatcher;
    },
    dispose() {
      cleanups.forEach(stop => stop());
      element.removeEventListener('game:container-button', pressButton);
      element.removeEventListener('game:chest-close', close);
      actions = undefined;
      openModel = undefined;
    },
    open(model, prefab, { containerId, slots }) {
      // One element shows one container at a time.
      if (openModel !== model && element.slotContainer) {
        element.close();
      }
      openModel = model;
      bounds0.makeEmpty();
      const container = buildingContainerDefinition(prefab);
      panelAnchor = containerPanelAnchor(prefab);
      openButton = container.button?.action;
      element.open({
        containerId,
        slotCount: container.slotCount,
        columns: container.columns,
        panelArchive: container.panelArchive,
        slotGrid: container.slotGrid,
        singleItems: container.singleItems,
        slotBackground: container.slotBackground,
        button: container.button,
        title: definitions.animatedBuildings[prefab].buildLabel,
      });
      if (toItem) {
        element.bindContainer(slots, toItem);
      }
      update();
    },
    close(model) {
      if (openModel === model) {
        element.close();
      }
      update();
    },
  };
}
