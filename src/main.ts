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
import { isHatId } from '@three-roaming/prefab/hats';
import { setupYellowStaffCasting } from '@three-roaming/prefab/yellowstaff';
import { BugNetCaptureController } from '@three-roaming/prefab/bugnet';
import { HammerActionController } from '@three-roaming/prefab/hammer';
import { PickaxeActionController } from '@three-roaming/prefab/pickaxe';
import { newEntityId } from '@three-roaming/prefab/saveRecord';
import { isBulbPlantPrefab } from '@three-roaming/prefab/bulb_plant';
import { isRockPrefab } from '@three-roaming/prefab/rocks';
import { frontTasks } from './animate';
import { input } from './InputManager';
import { PointerRaycaster } from '@three-roaming/prefab/pointerRaycaster';
import { view } from './view';
import { PreparedFoodSlot, StorageSlot } from '@three-roaming/inventory';
import { loadImageAtlas } from '@three-roaming/animation/imageAtlas';
import { player } from './player';
import { cursorUi, dstLighting } from './universal';
import { createChestInventoryPanel } from './chestInventoryPanel';
import {
  STORAGE_BUILDING_IDS, buildingContainerId, buildingContainerDefinition, isStorageBuildingId,
  type StorageBuildingId,
} from '@three-roaming/prefab/containers';
import { executeDebugCommand } from './debugCommands';
import { isPlaceableBuildingId } from './placeableBuilding';
import {
  createInventoryStore,
} from './inventory';
import { locomotor, startScene } from './scene';
import { initialSave } from './save/initialSave';
import { inventoryStateFromSave } from './save/inventoryState';
import { SAVE_CATALOG } from './save/catalog';
import { serializeSave } from './save/serialize';
import { downloadSaveJson } from './save/download';
import { setupEmoteWheel } from './emoteWheel';

void loadImageAtlas(`${import.meta.env.BASE_URL}dst/data/databundles/images.zip`).catch(() => undefined);
const gameUi = mountGameUi({ assetBaseUrl: `${import.meta.env.BASE_URL}dst/data/ui/` });
const chestInventoryPanel = createChestInventoryPanel(gameUi.chestPanel);
const cookPotInventoryPanel = createChestInventoryPanel(gameUi.cookPotPanel, 'cookpot');
const iceBoxInventoryPanel = createChestInventoryPanel(gameUi.iceBoxPanel, 'icebox');
export const inventory = createInventoryStore();
const storageContainers = new Map<string, StorageBuildingId>();
function storagePanel(prefab: StorageBuildingId) {
  return prefab === 'cookpot' ? gameUi.cookPotPanel
    : prefab === 'icebox' ? gameUi.iceBoxPanel : gameUi.chestPanel;
}
function registerStorage(prefab: StorageBuildingId, entityId: string): void {
  const containerId = buildingContainerId(prefab, entityId);
  if (storageContainers.has(containerId)) return;
  const definition = buildingContainerDefinition(prefab);
  inventory.registerSlots(Array.from({ length: definition.slotCount }, (_, index) => ({
    address: { containerId, slotKey: String(index) },
    slot: definition.singleItems ? new PreparedFoodSlot() : new StorageSlot(),
  })));
  storageContainers.set(containerId, prefab);
}
for (const prefab of STORAGE_BUILDING_IDS) {
  for (const record of initialSave.world.entities[prefab] ?? []) registerStorage(prefab, record.id);
}
inventory.replaceState(inventoryStateFromSave(initialSave), INVENTORY_RECIPES);
for (const panel of [gameUi.chestPanel, gameUi.cookPotPanel, gameUi.iceBoxPanel]) {
  panel.addEventListener('game:chest-close', (event) => {
    const { containerId } = (event as CustomEvent<ChestCloseDetail>).detail;
    inventory.setStorageAccessible(containerId, false);
  });
}
const playerAnimation = player.userData.animationController as WilsonAnimationController | undefined;
const handSlotAddress = equipmentSlotAddress('hand');
const handPointer = new PointerRaycaster(view);
const headSlotAddress = equipmentSlotAddress('head');

function isHandSlot(address: SlotAddress): boolean {
  return address.containerId === handSlotAddress.containerId
    && address.slotKey === handSlotAddress.slotKey;
}

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

function syncHandEquipment(): void {
  const handItem = inventory.get(handSlotAddress);
  const carryItem = handItem?.itemId === 'torch' || handItem?.itemId === 'lantern'
    || handItem?.itemId === 'yellowstaff' || handItem?.itemId === 'bugnet' || handItem?.itemId === 'hammer'
    || handItem?.itemId === 'pickaxe' || handItem?.itemId === 'goldenpickaxe' ? handItem.itemId : null;
  void playerAnimation?.setCarryItem(carryItem, handItem?.skinId)
    .catch((error: unknown) => console.error('Unable to equip hand item', error));
  dstLighting.setTorchOwner(handItem?.itemId === 'torch' ? player : null);
  cursorUi.setHandAction(handItem?.itemId === 'yellowstaff' ? ': 施放法术' : null, handPointer);
}

function syncHeadEquipment(): void {
  const item = inventory.get(headSlotAddress);
  void playerAnimation?.setHat(item && isHatId(item.itemId) ? item.itemId : null, item?.skinId)
    .catch((error: unknown) => console.error('Unable to equip hat', error));
}

function syncInventorySlot(address: SlotAddress): void {
  const storagePrefab = storageContainers.get(address.containerId);
  const panel = storagePrefab === undefined ? undefined : storagePanel(storagePrefab);
  if (panel && panel.slotContainer?.id !== address.containerId) return;
  const inventoryBar = panel ?? gameUi.inventoryBar;
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
    maxStack: storagePrefab && buildingContainerDefinition(storagePrefab).singleItems ? 1 : spec.maxStack,
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
syncHeadEquipment();
inventory.subscribe((changedSlots) => {
  changedSlots.forEach(syncInventorySlot);
  syncCraftingInventory();
  if (changedSlots.some((address) =>
    address.containerId === handSlotAddress.containerId
    && address.slotKey === handSlotAddress.slotKey)) {
    syncHandEquipment();
  }
  if (changedSlots.some((address) =>
    address.containerId === headSlotAddress.containerId
    && address.slotKey === headSlotAddress.slotKey)) {
    syncHeadEquipment();
  }
});

let cancelNetCapture = () => {};
let cancelHandTool = () => {};
const { buildingPlacement, groundItems, dwarfStars, flowerPlanting, bulbPlants, beefalos, rockManager, getSaveState } = await startScene(
  (buildingId) => inventory.takeBuffered(buildingId) || inventory.takeItem(buildingId),
  (item, action) => {
    if (!inventory.add(item.itemId, item.count, item.skinId)) return false;
    if (action !== 'net') playerAnimation?.playPickup();
    return true;
  },
  ({ buildId, isOpen, model }) => {
    if (!isStorageBuildingId(buildId)) return;
    const entityId = String(model.userData.entityId);
    registerStorage(buildId, entityId);
    (buildId === 'cookpot' ? cookPotInventoryPanel : buildId === 'icebox' ? iceBoxInventoryPanel : chestInventoryPanel)
      .setOpen(model, isOpen, buildId);
    const id = buildingContainerId(buildId, entityId);
    inventory.setStorageAccessible(id, isOpen);
    if (isOpen) {
      inventory.addresses()
        .filter(({ containerId }) => containerId === id)
        .forEach(syncInventorySlot);
    }
  },
  () => playerAnimation?.playPickup(),
  (count) => {
    if (!inventory.add('lightbulb', count)) return false;
    cancelNetCapture();
    locomotor.stop();
    flowerPlanting.cancel();
    buildingPlacement.cancel();
    playerAnimation?.playPickup();
    return true;
  },
);
if (playerAnimation) {
  const bugNet = new BugNetCaptureController(view, playerAnimation, locomotor,
    () => inventory.get(handSlotAddress)?.itemId === 'bugnet',
    () => groundItems.netCaptureTargets,
    () => (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'] as const).some((key) => input.isPressed(key)));
  cancelNetCapture = () => bugNet.cancel();
  groundItems.setNetCaptureHandler((target) => {
    if (!bugNet.request(target)) return false;
    flowerPlanting.cancel();
    buildingPlacement.cancel();
    return true;
  });
  frontTasks.push((dt) => bugNet.update(dt));
}
if (playerAnimation) setupYellowStaffCasting(view, playerAnimation, dwarfStars,
  () => inventory.get(handSlotAddress)?.itemId === 'yellowstaff',
  () => locomotor.stop(),
  (error) => console.error('Unable to summon dwarf star', error));

if (playerAnimation) {
  const hammer = new HammerActionController(view, playerAnimation, locomotor,
    () => inventory.get(handSlotAddress)?.itemId === 'hammer',
    () => buildingPlacement.hammerTargets,
    () => (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'] as const).some((key) => input.isPressed(key)),
    () => {
      cancelNetCapture();
      flowerPlanting.cancel();
      buildingPlacement.cancel();
    });
  const handTool = () => inventory.get(handSlotAddress)?.itemId;
  const pickaxe = new PickaxeActionController(view, playerAnimation, locomotor,
    () => handTool() === 'pickaxe' || handTool() === 'goldenpickaxe',
    () => rockManager.mineTargets,
    () => (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'] as const).some((key) => input.isPressed(key)),
    () => {
      cancelNetCapture();
      flowerPlanting.cancel();
      buildingPlacement.cancel();
    });
  cancelHandTool = () => { hammer.cancel(); pickaxe.cancel(); };
  frontTasks.push((dt) => { hammer.update(dt); pickaxe.update(dt); });
}

setupEmoteWheel(gameUi.emoteWheel, view.renderer.domElement, playerAnimation,
  () => locomotor.stop(), () => {
    cancelNetCapture();
    cancelHandTool();
    flowerPlanting.cancel();
    buildingPlacement.cancel();
  }, () => cursorUi.update());

let lastSavedSnapshotId = initialSave.snapshot.id;
gameUi.debugConsole.addEventListener('game:debug-command', (event) => {
  const { command } = (event as CustomEvent<DebugCommandDetail>).detail;
  void executeDebugCommand(command, inventory, async (prefabId) => {
    if (prefabId === 'beefalo') {
      await beefalos.spawnNear(player.position);
      return true;
    }
    if (isBulbPlantPrefab(prefabId)) {
      await bulbPlants.spawn(prefabId, player.position.clone());
      return true;
    }
    if (prefabId === 'fireflies') {
      const spec = inventory.getItemSpec(prefabId);
      await groundItems.spawnFromSave(newEntityId(), { ...spec, itemId: prefabId, count: 1 }, player.position.clone());
      return true;
    }
    if (isRockPrefab(prefabId)) {
      await rockManager.spawn(prefabId, player.position.clone());
      return true;
    }
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
  if (!transferred || (detail.itemId !== 'torch' && detail.itemId !== 'lantern'
    && detail.itemId !== 'yellowstaff' && detail.itemId !== 'bugnet' && detail.itemId !== 'hammer'
    && detail.itemId !== 'pickaxe' && detail.itemId !== 'goldenpickaxe')) return;
  if (isHandSlot(detail.to)) playerAnimation?.playItemTransition('item_out', detail.itemId);
  else if (isHandSlot(detail.from)) playerAnimation?.playItemTransition('item_in', detail.itemId);
});
gameUi.inventoryBar.addEventListener('game:slot-select', (event) => {
  const { slot } = (event as CustomEvent<SlotSelectDetail>).detail;
  cancelHandTool();
  flowerPlanting.cancel();
  const stack = inventory.get(slot);
  if (!stack || !isPlaceableBuildingId(stack.itemId)) return;
  // Placement claims the click so the stack is not picked up for a transfer.
  event.preventDefault();
  locomotor.stop();
  void buildingPlacement.begin(stack.itemId, stack.skinId).catch((error: unknown) => {
    console.error(`Unable to start ${stack.itemId} placement`, error);
  });
});
gameUi.inventoryBar.addEventListener('game:slot-context-menu', (event) => {
  const { slot, shiftKey } = (event as CustomEvent<SlotContextMenuDetail>).detail;
  cancelHandTool();
  const stack = inventory.get(slot);
  if (!stack) return;
  if (shiftKey) {
    flowerPlanting.cancel();
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
  if (stack.itemId === 'butterfly') {
    locomotor.stop();
    buildingPlacement.cancel();
    void flowerPlanting.begin(() => inventory.applySlotChanges([{
      slot, itemId: 'butterfly', delta: -1,
      ...(stack.skinId === undefined ? {} : { skinId: stack.skinId }),
    }])).catch((error: unknown) => {
      console.error('Unable to start butterfly planting', error);
    });
    return;
  }
  if (stack.itemId === 'meatballs') playerAnimation?.playEat();
});
gameUi.crafting.addEventListener('game:craft-request', (event) => {
  cancelHandTool();
  const { recipeId, skinId } = (event as CustomEvent<CraftRequestDetail>).detail;
  const recipe = INVENTORY_RECIPES[recipeId];
  if (!recipe) return;

  inventory.craft(recipe, skinId);
  // Buffered builds place as soon as they are crafted. Walls are not buffered:
  // crafting only fills the inventory, and placing starts from the slot click.
  if (isPlaceableBuildingId(recipeId) && inventory.isBuffered(recipeId)) {
    flowerPlanting.cancel();
    locomotor.stop();
    void buildingPlacement.begin(recipeId, inventory.bufferedSkin(recipeId)).catch((error: unknown) => {
      console.error(`Unable to start ${recipeId} placement`, error);
    });
  }
});
gameUi.crafting.addEventListener('game:crafting-state-change', (event) => {
  const { crafting } = (event as CustomEvent<CraftingStateDetail>).detail;
  if (crafting) cancelHandTool();
  if (crafting) locomotor.stop();
  playerAnimation?.setCrafting(crafting);
});
