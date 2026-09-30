// src/main.ts

import './style.css';
import {
  INVENTORY_RECIPES,
  equipmentSlotAddress,
  mountGameUi,
  type CraftingStateDetail,
  type CraftRequestDetail,
  type ChestCloseDetail,
  type DebugCommandDetail,
  type SlotAddress,
  type SlotContextMenuDetail,
  type SlotSelectDetail,
  type SlotTransferRequest,
} from '@three-roaming/ui';
import type { WilsonAnimationController } from '@three-roaming/prefab/player';
import { PreparedFoodSlot, StorageSlot } from '@three-roaming/inventory';
import { preloadImageArchive } from '@three-roaming/animation/imageAtlas';
import { player } from './player';
import {
  CHEST_SLOT_COUNT,
  COOK_POT_SLOT_COUNT,
  createChestInventoryPanel,
} from './chestInventoryPanel';
import { executeDebugCommand } from './debugCommands';
import { isPlaceableBuildingId } from './placeableBuilding';
import {
  createInventoryStore,
} from './inventory';
import { startScene } from './scene';
import { initialSave } from './save/initialSave';
import { chestContainerId, cookPotContainerId, inventoryStateFromSave } from './save/inventoryState';
import { SAVE_CATALOG } from './save/catalog';
import { serializeSave } from './save/serialize';
import { downloadSaveJson } from './save/download';

void preloadImageArchive(`${import.meta.env.BASE_URL}dst/data/databundles/images.zip`).catch(() => undefined);
const gameUi = mountGameUi({ assetBaseUrl: `${import.meta.env.BASE_URL}dst/data/ui/` });
const chestInventoryPanel = createChestInventoryPanel(gameUi.chestPanel);
const cookPotInventoryPanel = createChestInventoryPanel(gameUi.cookPotPanel, 'cookpot');
export const inventory = createInventoryStore();
const chestContainers = new Set<string>();
const cookPotContainers = new Set<string>();
function registerCookPot(entityId: string): void {
  const containerId = cookPotContainerId(entityId);
  if (cookPotContainers.has(containerId)) return;
  inventory.registerSlots(Array.from({ length: COOK_POT_SLOT_COUNT }, (_, index) => ({
    address: { containerId, slotKey: String(index) }, slot: new PreparedFoodSlot(),
  })));
  cookPotContainers.add(containerId);
}
function registerChest(entityId: string): void {
  const containerId = chestContainerId(entityId);
  if (chestContainers.has(containerId)) return;
  inventory.registerSlots(Array.from({ length: CHEST_SLOT_COUNT }, (_, index) => ({
    address: { containerId, slotKey: String(index) }, slot: new StorageSlot(),
  })));
  chestContainers.add(containerId);
}
for (const record of initialSave.world.entities.treasurechest ?? []) registerChest(record.id);
for (const record of initialSave.world.entities.cookpot ?? []) registerCookPot(record.id);
inventory.replaceState(inventoryStateFromSave(initialSave), INVENTORY_RECIPES);
for (const panel of [gameUi.chestPanel, gameUi.cookPotPanel]) {
  panel.addEventListener('game:chest-close', (event) => {
    const { containerId } = (event as CustomEvent<ChestCloseDetail>).detail;
    inventory.setStorageAccessible(containerId, false);
  });
}
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
  const storagePanel = cookPotContainers.has(address.containerId) ? gameUi.cookPotPanel
    : chestContainers.has(address.containerId) ? gameUi.chestPanel : undefined;
  if (storagePanel && storagePanel.slotContainer?.id !== address.containerId) return;
  const inventoryBar = storagePanel ?? gameUi.inventoryBar;
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
    maxStack: cookPotContainers.has(address.containerId) ? 1 : spec.maxStack,
    icon: spec.icon,
    ...(spec.atlas ? { atlas: spec.atlas } : {}),
    ...(spec.equippable ? { equippable: spec.equippable } : {}),
  });
}

function syncCraftingInventory(): void {
  gameUi.crafting.setMaterialSummary(inventory.materialSummary());
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

const { buildingPlacement, groundItems, getSaveState } = await startScene(
  (buildingId) => inventory.takeBuffered(buildingId) || inventory.takeItem(buildingId),
  (item) => {
    if (!inventory.add(item.itemId, item.count, item.skinId)) return false;
    playerAnimation?.playPickup();
    return true;
  },
  ({ buildId, isOpen, model }) => {
    if (buildId !== 'treasurechest' && buildId !== 'cookpot') return;
    const entityId = String(model.userData.entityId);
    const isCookPot = buildId === 'cookpot';
    (isCookPot ? registerCookPot : registerChest)(entityId);
    (isCookPot ? cookPotInventoryPanel : chestInventoryPanel).setOpen(model, isOpen);
    const id = (isCookPot ? cookPotContainerId : chestContainerId)(entityId);
    inventory.setStorageAccessible(id, isOpen);
    if (isOpen) {
      inventory.addresses()
        .filter(({ containerId }) => containerId === id)
        .forEach(syncInventorySlot);
    }
  },
);
let lastSavedSnapshotId = initialSave.snapshot.id;
gameUi.debugConsole.addEventListener('game:debug-command', (event) => {
  const { command } = (event as CustomEvent<DebugCommandDetail>).detail;
  void executeDebugCommand(command, inventory, async (prefabId) => {
    if (!isPlaceableBuildingId(prefabId)) return false;
    await buildingPlacement.spawn(prefabId);
    return true;
  }, () => {
    const json = serializeSave(initialSave, {
      ...getSaveState(), inventory: inventory.exportState(),
    }, SAVE_CATALOG, lastSavedSnapshotId);
    downloadSaveJson(json);
    lastSavedSnapshotId = (JSON.parse(json) as typeof initialSave).snapshot.id;
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
