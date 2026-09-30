// src/main.ts

import './style.css';
import {
  INVENTORY_RECIPES,
  equipmentSlotAddress,
  mountGameUi,
  type CraftingStateDetail,
  type CraftRequestDetail,
  type DebugCommandDetail,
  type SlotAddress,
  type SlotContextMenuDetail,
  type SlotSelectDetail,
  type SlotTransferRequest,
} from '@three-roaming/ui';
import type { WilsonAnimationController } from '@three-roaming/prefab/player';
import { StorageSlot } from '@three-roaming/inventory';
import { preloadImageArchive } from '@three-roaming/animation/imageAtlas';
import { player } from './player';
import {
  CHEST_CONTAINER_ID,
  CHEST_SLOT_COUNT,
  createChestInventoryPanel,
} from './chestInventoryPanel';
import { executeDebugCommand } from './debugCommands';
import { isPlaceableBuildingId } from './placeableBuilding';
import {
  createInventoryStore,
} from './inventory';
import { startScene } from './scene';

void preloadImageArchive(`${import.meta.env.BASE_URL}dst/data/databundles/images.zip`).catch(() => undefined);
const gameUi = mountGameUi({ assetBaseUrl: `${import.meta.env.BASE_URL}dst/data/ui/` });
const chestInventoryPanel = createChestInventoryPanel(gameUi.chestPanel);
export const inventory = createInventoryStore();
inventory.registerSlots(Array.from({ length: CHEST_SLOT_COUNT }, (_, index) => ({
  address: { containerId: CHEST_CONTAINER_ID, slotKey: String(index) },
  slot: new StorageSlot(),
})));
const playerAnimation = player.userData.animationController as WilsonAnimationController | undefined;
const handSlotAddress = equipmentSlotAddress('hand');

function isHandSlot(address: SlotAddress): boolean {
  return address.containerId === handSlotAddress.containerId
    && address.slotKey === handSlotAddress.slotKey;
}

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

function syncHandEquipment(): void {
  const handItem = inventory.get(handSlotAddress);
  playerAnimation?.setCarryItem(handItem?.itemId === 'torch' ? 'torch' : null);
}

function syncInventorySlot(address: SlotAddress): void {
  if (address.containerId === CHEST_CONTAINER_ID
    && gameUi.chestPanel.slotContainer?.id !== CHEST_CONTAINER_ID) return;
  const inventoryBar = address.containerId === CHEST_CONTAINER_ID
    ? gameUi.chestPanel
    : gameUi.inventoryBar;
  const stack = inventory.get(address);
  if (!stack) {
    inventoryBar.setSlot(address, null);
    return;
  }

  const spec = inventory.getStackSpec(stack);
  inventoryBar.setSlot(address, {
    id: stack.itemId,
    ...(stack.skinId === undefined ? {} : { skinId: stack.skinId }),
    name: spec.name,
    count: stack.count,
    maxStack: spec.maxStack,
    icon: spec.icon,
    ...(spec.atlas ? { atlas: spec.atlas } : {}),
    ...(spec.equippable ? { equippable: spec.equippable } : {}),
  });
}

function syncCraftingInventory(): void {
  gameUi.crafting.setInventoryCounts(inventory.counts());
  gameUi.crafting.setBufferedRecipes(inventory.buffered());
}

inventory.addresses().forEach(syncInventorySlot);
syncCraftingInventory();
syncHandEquipment();
inventory.subscribe((changedSlots) => {
  changedSlots.forEach(syncInventorySlot);
  syncCraftingInventory();
  if (changedSlots.some((address) =>
    address.containerId === handSlotAddress.containerId
    && address.slotKey === handSlotAddress.slotKey)) {
    syncHandEquipment();
  }
});

const { buildingPlacement, groundItems } = startScene(
  (buildingId) => inventory.takeBuffered(buildingId) || inventory.takeItem(buildingId),
  (item) => {
    if (!inventory.add(item.itemId, item.count, item.skinId)) return false;
    playerAnimation?.playPickup();
    return true;
  },
  ({ buildId, isOpen, model }) => {
    if (buildId !== 'treasurechest') return;
    chestInventoryPanel.setOpen(model, isOpen);
    if (isOpen) {
      inventory.addresses()
        .filter(({ containerId }) => containerId === CHEST_CONTAINER_ID)
        .forEach(syncInventorySlot);
    }
  },
);
gameUi.debugConsole.addEventListener('game:debug-command', (event) => {
  const { command } = (event as CustomEvent<DebugCommandDetail>).detail;
  void executeDebugCommand(command, inventory, async (prefabId) => {
    if (!isPlaceableBuildingId(prefabId)) return false;
    await buildingPlacement.spawn(prefabId);
    return true;
  }).then((result) => {
    if (result.ok) console.info(result.message);
    else console.warn(result.message);
  }).catch((error: unknown) => {
    console.error(`Unable to execute debug command: ${command}`, error);
  });
});

window.addEventListener('game:slot-transfer-request', (event) => {
  const detail = (event as CustomEvent<SlotTransferRequest>).detail;
  if (!Number.isSafeInteger(detail.amount) || detail.amount <= 0) return;

  const transferred = inventory.applySlotChanges([
    {
      slot: detail.from,
      itemId: detail.itemId,
      ...(detail.skinId === undefined ? {} : { skinId: detail.skinId }),
      delta: -detail.amount,
    },
    {
      slot: detail.to,
      itemId: detail.itemId,
      ...(detail.skinId === undefined ? {} : { skinId: detail.skinId }),
      delta: detail.amount,
    },
  ]);
  if (!transferred || detail.itemId !== 'torch') return;
  if (isHandSlot(detail.to)) playerAnimation?.playItemTransition('item_out');
  else if (isHandSlot(detail.from)) playerAnimation?.playItemTransition('item_in');
});
gameUi.inventoryBar.addEventListener('game:slot-select', (event) => {
  const { slot } = (event as CustomEvent<SlotSelectDetail>).detail;
  const stack = inventory.get(slot);
  if (!stack || !isPlaceableBuildingId(stack.itemId)) return;
  void buildingPlacement.begin(stack.itemId, stack.skinId).catch((error: unknown) => {
    console.error(`Unable to start ${stack.itemId} placement`, error);
  });
});
gameUi.inventoryBar.addEventListener('game:slot-context-menu', (event) => {
  const { slot, shiftKey } = (event as CustomEvent<SlotContextMenuDetail>).detail;
  const stack = inventory.get(slot);
  if (!stack) return;
  if (shiftKey) {
    const spec = inventory.getStackSpec(stack);
    const position = player.position.clone();
    void groundItems.drop({
      itemId: stack.itemId,
      ...(stack.skinId === undefined ? {} : { skinId: stack.skinId }),
      name: spec.name,
      icon: spec.icon,
      ...(spec.atlas ? { atlas: spec.atlas } : {}),
      count: 1,
    }, position, () => inventory.applySlotChanges([
      {
        slot,
        itemId: stack.itemId,
        ...(stack.skinId === undefined ? {} : { skinId: stack.skinId }),
        delta: -1,
      },
    ])).then((dropped) => {
      if (dropped) playerAnimation?.playPickup();
    }).catch((error: unknown) => {
      console.error(`Unable to drop ${stack.itemId}`, error);
    });
    return;
  }
  if (stack.itemId === 'meatballs') playerAnimation?.playEat();
});
gameUi.crafting.addEventListener('game:craft-request', (event) => {
  const { recipeId, skinId } = (event as CustomEvent<CraftRequestDetail>).detail;
  const recipe = INVENTORY_RECIPES[recipeId];
  if (!recipe) return;

  inventory.craft(recipe, skinId);
  // Buffered builds place as soon as they are crafted. Walls are not buffered:
  // crafting only fills the inventory, and placing starts from the slot click.
  if (isPlaceableBuildingId(recipeId) && inventory.isBuffered(recipeId)) {
    void buildingPlacement.begin(recipeId, inventory.bufferedSkin(recipeId)).catch((error: unknown) => {
      console.error(`Unable to start ${recipeId} placement`, error);
    });
  }
});
gameUi.crafting.addEventListener('game:crafting-state-change', (event) => {
  const { crafting } = (event as CustomEvent<CraftingStateDetail>).detail;
  playerAnimation?.setCrafting(crafting);
});
