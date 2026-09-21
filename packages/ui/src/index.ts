import { DstCraftingUiElement } from './crafting-ui';
import { DstInventoryBarElement } from './inventory-bar';
import { DstMapControlsElement } from './map-controls';
import { DstStatusHudElement } from './status-hud';

export { DstCraftingUiElement, type CraftRequestDetail } from './crafting-ui';
export {
  INVENTORY_RECIPES,
  type InventoryRecipeDefinition,
} from './categories/shared';
export {
  DstInventoryBarElement,
  type EquipmentKind,
  type InventoryBarItem,
  type InventorySlotChangeDetail,
  type InventorySlotRef,
  type InventorySlotSelectDetail,
} from './inventory-bar';
export { DstMapControlsElement, type CameraTurnDirection } from './map-controls';
export { DstStatusHudElement } from './status-hud';

export interface MountGameUiOptions {
  assetBaseUrl?: string;
  craftingTarget?: ParentNode;
  overlayTarget?: ParentNode;
}

export interface GameUiElements {
  crafting: DstCraftingUiElement;
  inventoryBar: DstInventoryBarElement;
  mapControls: DstMapControlsElement;
  statusHud: DstStatusHudElement;
}

export function defineGameUiElements(): void {
  if (!customElements.get('dst-crafting-ui')) {
    customElements.define('dst-crafting-ui', DstCraftingUiElement);
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
  const crafting = getOrCreate('dst-crafting-ui', craftingTarget);
  const statusHud = getOrCreate('dst-status-hud', overlayTarget);
  const inventoryBar = getOrCreate('dst-inventory-bar', overlayTarget);
  const mapControls = getOrCreate('dst-map-controls', overlayTarget);

  if (options.assetBaseUrl) {
    for (const element of [crafting, statusHud, inventoryBar, mapControls]) {
      element.setAttribute('asset-base', options.assetBaseUrl);
    }
  }

  return { crafting, inventoryBar, mapControls, statusHud };
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
    'dst-crafting-ui': DstCraftingUiElement;
    'dst-inventory-bar': DstInventoryBarElement;
    'dst-map-controls': DstMapControlsElement;
    'dst-status-hud': DstStatusHudElement;
  }
}
