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
  type SlotTransferRequest,
} from '@three-roaming/ui';
import type { WilsonAnimationController } from '@three-roaming/wilson/player';
import { preloadImageArchive } from '@three-roaming/wilson/imageAtlas';
import { player } from './player';
import { executeDebugCommand } from './debugCommands';
import { isPlaceableBuildingId } from './placeableBuilding';
import {
  INVENTORY_ITEM_DEFINITIONS,
  InventoryStore,
} from './inventory';
import { startScene } from './scene';

void preloadImageArchive(`${import.meta.env.BASE_URL}dst/data/databundles/images.zip`).catch(() => undefined);
const gameUi = mountGameUi({ assetBaseUrl: `${import.meta.env.BASE_URL}dst/data/ui/` });
export const inventory = new InventoryStore(INVENTORY_ITEM_DEFINITIONS);
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
  const stack = inventory.get(address);
  if (!stack) {
    gameUi.inventoryBar.setSlot(address, null);
    return;
  }

  const spec = inventory.getItemSpec(stack.itemId);
  gameUi.inventoryBar.setSlot(address, {
    id: stack.itemId,
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
  (buildingId) => inventory.takeBuffered(buildingId),
  (item) => {
    if (!inventory.add(item.itemId, item.count)) return false;
    playerAnimation?.playPickup();
    return true;
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
    { slot: detail.from, itemId: detail.itemId, delta: -detail.amount },
    { slot: detail.to, itemId: detail.itemId, delta: detail.amount },
  ]);
  if (!transferred || detail.itemId !== 'torch') return;
  if (isHandSlot(detail.to)) playerAnimation?.playItemTransition('item_out');
  else if (isHandSlot(detail.from)) playerAnimation?.playItemTransition('item_in');
});
gameUi.inventoryBar.addEventListener('game:slot-context-menu', (event) => {
  const { slot, shiftKey } = (event as CustomEvent<SlotContextMenuDetail>).detail;
  const stack = inventory.get(slot);
  if (!stack) return;
  if (shiftKey) {
    const spec = inventory.getItemSpec(stack.itemId);
    const position = player.position.clone();
    void groundItems.drop({
      itemId: stack.itemId,
      name: spec.name,
      icon: spec.icon,
      ...(spec.atlas ? { atlas: spec.atlas } : {}),
      count: 1,
    }, position, () => inventory.applySlotChanges([
      { slot, itemId: stack.itemId, delta: -1 },
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
  const { recipeId } = (event as CustomEvent<CraftRequestDetail>).detail;
  const recipe = INVENTORY_RECIPES[recipeId];
  if (!recipe) return;

  const crafted = inventory.craft(recipe);
  if (isPlaceableBuildingId(recipeId) && (crafted || inventory.isBuffered(recipeId))) {
    void buildingPlacement.begin(recipeId).catch((error: unknown) => {
      console.error(`Unable to start ${recipeId} placement`, error);
    });
  }
});
gameUi.crafting.addEventListener('game:crafting-state-change', (event) => {
  const { crafting } = (event as CustomEvent<CraftingStateDetail>).detail;
  playerAnimation?.setCrafting(crafting);
});
