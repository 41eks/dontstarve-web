import { DstChestPanelElement } from './chest-panel';
import { DstCraftingUiElement } from './crafting-ui';
import { DstDebugConsoleElement } from './debug-console';
import { DstInventoryBarElement } from './inventory-bar';
import { DstMapControlsElement } from './map-controls';
import { DstStatusHudElement } from './status-hud';

export { DstChestPanelElement, type ChestCloseDetail, type OpenChestOptions } from './chest-panel';
export {
  CRAFT_DURATION_MS,
  DstCraftingUiElement,
  type CraftingStateDetail,
  type CraftRequestDetail,
} from './crafting-ui';
export { DstDebugConsoleElement, type DebugCommandDetail } from './debug-console';
export {
  INVENTORY_PRODUCT_SPECS,
  INVENTORY_RECIPES,
  type InventoryProductSpec,
  type InventoryRecipeDefinition,
} from './categories/shared';
export {
  DstInventoryBarElement,
  type EquipmentKind,
  type InventoryBarItem,
  INVENTORY_SLOT_COUNT,
  PLAYER_EQUIPMENT_CONTAINER_ID,
  PLAYER_INVENTORY_CONTAINER_ID,
  equipmentSlotAddress,
  inventorySlotAddress,
} from './inventory-bar';
export { DstMapControlsElement, type CameraTurnDirection } from './map-controls';
export {
  createSlotContainer,
  type CreateSlotContainerOptions,
  type SlotContainer,
  type SlotContainerKind,
} from './slot/slot-container';
export {
  createSlot,
  sameSlotAddress,
  type CreateSlotOptions,
  type SlotAddress,
  type SlotContextMenuDetail,
  type SlotItem,
  type SlotModel,
  type SlotSelectDetail,
} from './slot/slot-model';
export { createSlotRenderer, type CreateSlotRendererOptions, type SlotRenderer } from './slot/slot-renderer';
export {
  SlotTransferController,
  slotTransferController,
  type SlotDragEndResult,
  type SlotTransferRequest,
} from './slot/slot-transfer';
export { DstStatusHudElement } from './status-hud';

export interface MountGameUiOptions {
  assetBaseUrl?: string;
  chestTarget?: ParentNode;
  craftingTarget?: ParentNode;
  overlayTarget?: ParentNode;
}

export interface GameUiElements {
  chestPanel: DstChestPanelElement;
  crafting: DstCraftingUiElement;
  debugConsole: DstDebugConsoleElement;
  inventoryBar: DstInventoryBarElement;
  mapControls: DstMapControlsElement;
  statusHud: DstStatusHudElement;
}

export function defineGameUiElements(): void {
  if (!customElements.get('dst-chest-panel')) {
    customElements.define('dst-chest-panel', DstChestPanelElement);
  }
  if (!customElements.get('dst-crafting-ui')) {
    customElements.define('dst-crafting-ui', DstCraftingUiElement);
  }
  if (!customElements.get('dst-debug-console')) {
    customElements.define('dst-debug-console', DstDebugConsoleElement);
  }
  if (!customElements.get('dst-status-hud')) {
    customElements.define('dst-status-hud', DstStatusHudElement);
  }
  if (!customElements.get('dst-inventory-bar')) {
    customElements.define('dst-inventory-bar', DstInventoryBarElement);
  }
  if (!customElements.get('dst-map-controls')) {
    customElements.define('dst-map-controls', DstMapControlsElement);
  }
}

export function mountGameUi(options: MountGameUiOptions = {}): GameUiElements {
  defineGameUiElements();

  const craftingTarget = options.craftingTarget ?? document.querySelector('#app') ?? document.body;
  const overlayTarget = options.overlayTarget ?? document.body;
  const chestTarget = options.chestTarget ?? overlayTarget;
  const chestPanel = getOrCreate('dst-chest-panel', chestTarget);
  const crafting = getOrCreate('dst-crafting-ui', craftingTarget);
  const debugConsole = getOrCreate('dst-debug-console', overlayTarget);
  const statusHud = getOrCreate('dst-status-hud', overlayTarget);
  const inventoryBar = getOrCreate('dst-inventory-bar', overlayTarget);
  const mapControls = getOrCreate('dst-map-controls', overlayTarget);

  if (options.assetBaseUrl) {
    for (const element of [chestPanel, crafting, debugConsole, statusHud, inventoryBar, mapControls]) {
      element.setAttribute('asset-base', options.assetBaseUrl);
    }
  }

  return { chestPanel, crafting, debugConsole, inventoryBar, mapControls, statusHud };
}

function getOrCreate<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  target: ParentNode,
): HTMLElementTagNameMap[K] {
  const existing = target.querySelector<HTMLElementTagNameMap[K]>(tagName);
  if (existing) return existing;

  const element = document.createElement(tagName);
  target.append(element);
  return element;
}

declare global {
  interface HTMLElementTagNameMap {
    'dst-chest-panel': DstChestPanelElement;
    'dst-crafting-ui': DstCraftingUiElement;
    'dst-debug-console': DstDebugConsoleElement;
    'dst-inventory-bar': DstInventoryBarElement;
    'dst-map-controls': DstMapControlsElement;
    'dst-status-hud': DstStatusHudElement;
  }
}
