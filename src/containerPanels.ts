import type { InventoryStore, ItemEntity } from '@dontstarve-web/inventory';
import { buildingContainerId, isStorageBuildingId } from '@dontstarve-web/prefab/containers';
import { prefabInstance } from '@dontstarve-web/prefab/prefabInstance';
import type { PlayerInstance } from '@dontstarve-web/prefab/player_common';
import type { WorldContext } from '@dontstarve-web/prefab/worldContext';
import type { GetWatchWorldContent } from '@dontstarve-web/signals';
import { createChestInventoryPanel, type GameUiEventMap, type mountGameUi, type SlotItem } from '@dontstarve-web/ui';
import type { PlaceableBuildingInteractionChange } from './placeableBuilding';

interface ContainerPanelOptions {
  gameUi: Pick<ReturnType<typeof mountGameUi>, 'chestPanel' | 'cookPotPanel' | 'iceBoxPanel'>;
  view: Pick<WorldContext, 'camera' | 'renderer' | 'player'>;
  inventory: Pick<InventoryStore, 'setStorageAccessible'>;
  playerEntity: PlayerInstance;
  inventorySlotItem: (entity: ItemEntity) => SlotItem;
  getWatchWorldContent: GetWatchWorldContent;
}

export function createContainerPanels({
  gameUi: { chestPanel, cookPotPanel, iceBoxPanel },
  view: { camera, renderer, player },
  inventory,
  playerEntity,
  inventorySlotItem,
  getWatchWorldContent,
}: ContainerPanelOptions) {
  const elements = [chestPanel, cookPotPanel, iceBoxPanel] as const;
  const onPanelClose = ({ detail: { containerId } }: GameUiEventMap['game:chest-close']) =>
    inventory.setStorageAccessible(containerId, false);
  for (const element of elements) {
    element.addEventListener('game:chest-close', onPanelClose);
  }

  const panelOptions = {
    camera,
    canvas: renderer.domElement,
    player,
    getWatchWorldContent,
    toItem: inventorySlotItem,
    // Close the instance for the doer RUMMAGE opened it with.
    closeContainer: (model: WorldContext['player']) => prefabInstance(model)?.components.container?.Close(playerEntity),
  };
  const chest = createChestInventoryPanel(chestPanel, panelOptions);
  const cookPot = createChestInventoryPanel(cookPotPanel, panelOptions);
  const iceBox = createChestInventoryPanel(iceBoxPanel, panelOptions);
  const panels = [chest, cookPot, iceBox];

  return {
    onContainerInteraction({ buildId, model, isOpen }: PlaceableBuildingInteractionChange): void {
      if (!isStorageBuildingId(buildId)) {
        return;
      }
      // Furnaces and cook pots share the panel that has a widget button.
      const panel =
        buildId === 'cookpot' || buildId === 'dragonflyfurnace' ? cookPot : buildId === 'icebox' ? iceBox : chest;
      const instance = prefabInstance(model);
      const containerId = instance && buildingContainerId(buildId, String(instance.entityId));
      if (!isOpen) {
        panel.close(model);
      } else if (containerId && instance.components.container) {
        panel.open(model, buildId, { containerId, slots: instance.components.container.slots });
      }
      if (containerId) {
        inventory.setStorageAccessible(containerId, isOpen);
      }
    },
    bindActions(dispatcher: Parameters<typeof chest.bindActions>[0]): void {
      for (const panel of panels) {
        panel.bindActions(dispatcher);
      }
    },
    dispose(): void {
      for (const element of elements) {
        element.removeEventListener('game:chest-close', onPanelClose);
      }
      for (const panel of panels) {
        panel.dispose();
      }
    },
  };
}
