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
} from '@dontstarve-web/ui';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';
import { isHatId } from '@dontstarve-web/prefab/hats';
import { isLightStaff, setupLightStaffCasting } from '@dontstarve-web/prefab/yellowstaff';
import { BugNetCaptureController } from '@dontstarve-web/prefab/bugnet';
import { HammerActionController } from '@dontstarve-web/prefab/hammer';
import { PickaxeActionController } from '@dontstarve-web/prefab/pickaxe';
import { PitchforkActionController, isPitchforkTool } from '@dontstarve-web/prefab/pitchfork';
import { ReskinActionController } from '@dontstarve-web/prefab/reskin_tool';
import { DisposeSounds, UpdateSoundListener } from '@dontstarve-web/prefab/sound';
import { disposeAnimationAssets, disposeAtlasImages } from '@dontstarve-web/animation';
import { turfMap } from './building';
import { backTasks, frontTasks } from './animate';
import { input } from './InputManager';
import { PointerRaycaster } from '@dontstarve-web/prefab/pointerRaycaster';
import { view } from './view';
import { BACKPACK_SLOT_COUNT, PLAYER_BACKPACK_CONTAINER_ID, backpackSlotAddress, inventorySlotAddress, PreparedFoodSlot, StorageSlot } from '@dontstarve-web/inventory';
import { player } from './player';
import { cursorUi, dstLighting, renderer } from './universal';
import { DstLightingRenderer } from './dstLighting';
import { createChestInventoryPanel } from './chestInventoryPanel';
import {
  STORAGE_BUILDING_IDS, buildingContainerId, buildingContainerDefinition, isStorageBuildingId,
  type StorageBuildingId,
} from '@dontstarve-web/prefab/containers';
import { executeDebugCommand } from './debugCommands';
import { isPlaceableBuildingId } from './placeableBuilding';
import {
  createInventoryStore,
} from './inventory';
import { locomotor, startScene } from './scene';
import { getDstClock, getDstCycle } from './tuning';
import { initialSave } from './save/initialSave';
import { inventoryStateFromSave } from './save/inventoryState';
import { SAVE_CATALOG } from './save/catalog';
import { serializeSave } from './save/serialize';
import { downloadSaveJson } from './save/download';
import { setupEmoteWheel } from './emoteWheel';
import { inventoryReceiveEffect } from './inventoryReceive';
import { playerStats, setPlayerSanityPercent, WILSON_MAX_SANITY } from './playerStats';

const lighting = await DstLightingRenderer.create(
  renderer,
  `${import.meta.env.BASE_URL}dst/data/images/colour_cubes`,
  {
    season: initialSave.world.systems.season?.name ?? 'spring',
    phase: getDstCycle(initialSave.world.elapsedSeconds).phase,
    sanityPercent: playerStats.sanity / WILSON_MAX_SANITY,
  },
);
window.dispatchEvent(new CustomEvent('game:lighting-ready', { detail: lighting }));

UpdateSoundListener(player.position);
backTasks.push(() => UpdateSoundListener(player.position));

const gameUi = mountGameUi({ assetBaseUrl: `${import.meta.env.BASE_URL}dst/data/ui/` });
function syncPlayerStats(): void {
  gameUi.statusHud.setStats(playerStats);
  dstLighting.setSanityPercent(playerStats.sanity / WILSON_MAX_SANITY);
}
syncPlayerStats();
const chestInventoryPanel = createChestInventoryPanel(gameUi.chestPanel);
const cookPotInventoryPanel = createChestInventoryPanel(gameUi.cookPotPanel, 'cookpot');
const iceBoxInventoryPanel = createChestInventoryPanel(gameUi.iceBoxPanel, 'icebox');
export const inventory = createInventoryStore();
inventory.registerSlots(Array.from({ length: BACKPACK_SLOT_COUNT }, (_, index) => ({
  address: backpackSlotAddress(index), slot: new StorageSlot(),
})));
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
const bodySlotAddress = equipmentSlotAddress('body');

function isHandSlot(address: SlotAddress): boolean {
  return address.containerId === handSlotAddress.containerId
    && address.slotKey === handSlotAddress.slotKey;
}

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

function syncHandEquipment(): void {
  const handItem = inventory.get(handSlotAddress);
  const itemId = handItem?.itemId;
  const carryItem = itemId === 'torch' || itemId === 'lantern'
    || isLightStaff(itemId) || itemId === 'bugnet' || itemId === 'hammer' || itemId === 'reskin_tool'
    || itemId === 'pickaxe' || itemId === 'goldenpickaxe'
    || (itemId !== undefined && isPitchforkTool(itemId)) ? itemId : null;
  void playerAnimation?.setCarryItem(carryItem, handItem?.skinId)
    .catch((error: unknown) => console.error('Unable to equip hand item', error));
  dstLighting.setTorchOwner(handItem?.itemId === 'torch' ? player : null);
  cursorUi.setHandAction(isLightStaff(itemId) ? ': 施放法术' : null, handPointer);
}

function syncHeadEquipment(): void {
  const item = inventory.get(headSlotAddress);
  void playerAnimation?.setHat(item && isHatId(item.itemId) ? item.itemId : null, item?.skinId)
    .catch((error: unknown) => console.error('Unable to equip hat', error));
}

function syncBodyEquipment(): void {
  const item = inventory.get(bodySlotAddress);
  const equipped = item?.itemId === 'backpack';
  void playerAnimation?.setBackpack(equipped, item?.skinId)
    .catch((error: unknown) => console.error('Unable to equip backpack', error));
  if (equipped && !gameUi.backpackPanel.slotContainer) {
    gameUi.backpackPanel.open({ containerId: PLAYER_BACKPACK_CONTAINER_ID, slotCount: BACKPACK_SLOT_COUNT, title: '背包' });
    Array.from({ length: BACKPACK_SLOT_COUNT }, (_, index) => backpackSlotAddress(index)).forEach(syncInventorySlot);
  } else if (!equipped) gameUi.backpackPanel.close();
  inventory.setStorageAccessible(PLAYER_BACKPACK_CONTAINER_ID, equipped);
}

function syncInventorySlot(address: SlotAddress): void {
  const isBackpack = address.containerId === PLAYER_BACKPACK_CONTAINER_ID;
  if (isBackpack && !gameUi.backpackPanel.slotContainer) return;
  const storagePrefab = storageContainers.get(address.containerId);
  const panel = storagePrefab === undefined ? undefined : storagePanel(storagePrefab);
  if (panel && panel.slotContainer?.id !== address.containerId) return;
  const inventoryBar = isBackpack ? gameUi.backpackPanel : panel ?? gameUi.inventoryBar;
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
syncBodyEquipment();
syncCraftingInventory();
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
  if (changedSlots.some((address) =>
    address.containerId === bodySlotAddress.containerId && address.slotKey === bodySlotAddress.slotKey)) {
    syncBodyEquipment();
  }
});

let cancelNetCapture = () => {};
let cancelHandTool = () => {};
const { buildingPlacement, groundItems, dwarfStars, polarLights, flowerPlanting, rockManager, reskinEffects, registry, getSaveState, dispose: disposeScene } = await startScene(
  (buildingId) => inventory.takeBuffered(buildingId) || inventory.takeItem(buildingId),
  (item, action, sourcePosition) => {
    if (!inventory.add(item.itemId, item.count, item.skinId,
      inventoryReceiveEffect(gameUi.inventoryBar, view.camera, view.renderer.domElement, sourcePosition))) return false;
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
  (count, sourcePosition) => {
    if (!inventory.add('lightbulb', count, undefined,
      inventoryReceiveEffect(gameUi.inventoryBar, view.camera, view.renderer.domElement, sourcePosition))) return false;
    cancelNetCapture();
    locomotor.stop();
    flowerPlanting.cancel();
    buildingPlacement.cancel();
    playerAnimation?.playPickup();
    return true;
  },
  (elapsedSeconds, dt) => gameUi.statusHud.setClock(getDstClock(elapsedSeconds), dt),
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
if (playerAnimation) setupLightStaffCasting(view, playerAnimation, dwarfStars,
  () => inventory.get(handSlotAddress)?.itemId === 'yellowstaff',
  () => locomotor.stop(),
  (error) => console.error('Unable to summon dwarf star', error));
if (playerAnimation) setupLightStaffCasting(view, playerAnimation, polarLights,
  () => inventory.get(handSlotAddress)?.itemId === 'opalstaff',
  () => locomotor.stop(),
  (error) => console.error('Unable to summon polar light', error));

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
  const pitchfork = new PitchforkActionController(view, playerAnimation, locomotor,
    () => isPitchforkTool(handTool() ?? ''), turfMap,
    () => (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'] as const).some((key) => input.isPressed(key)),
    () => {
      cancelNetCapture();
      flowerPlanting.cancel();
      buildingPlacement.cancel();
    });
  const reskin = new ReskinActionController(view, playerAnimation, locomotor,
    () => {
      const tool = inventory.get(handSlotAddress);
      return tool?.itemId === 'reskin_tool' ? tool : undefined;
    },
    () => [...buildingPlacement.reskinTargets, ...groundItems.reskinTargets], reskinEffects,
    () => (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'] as const).some((key) => input.isPressed(key)),
    () => {
      cancelNetCapture(); hammer.cancel(); pickaxe.cancel(); pitchfork.cancel();
      flowerPlanting.cancel(); buildingPlacement.cancel();
    },
    (error) => console.error('Unable to reskin target', error));
  cancelHandTool = () => { hammer.cancel(); pickaxe.cancel(); pitchfork.cancel(); reskin.cancel(); };
  frontTasks.push((dt) => { hammer.update(dt); pickaxe.update(dt); pitchfork.update(dt); reskin.update(dt); });
  window.addEventListener('pagehide', () => {
    reskin.dispose();
  }, { once: true });
}

setupEmoteWheel(gameUi.emoteWheel, view.renderer.domElement, playerAnimation,
  () => locomotor.stop(), () => {
    cancelNetCapture();
    cancelHandTool();
    flowerPlanting.cancel();
    buildingPlacement.cancel();
  }, () => cursorUi.update());

let lastSavedSnapshotId = initialSave.snapshot.id;
window.addEventListener('pagehide', () => {
  gameUi.inventoryBar.cancelReceiveAnimations();
  gameUi.savingIndicator.remove();
  disposeScene();
  DisposeSounds();
  disposeAnimationAssets();
  disposeAtlasImages();
}, { once: true });
gameUi.debugConsole.addEventListener('game:debug-command', (event) => {
  const { command } = (event as CustomEvent<DebugCommandDetail>).detail;
  void executeDebugCommand(command, inventory, (prefabId) => registry.spawn(prefabId), () => gameUi.savingIndicator.whileSaving(() => {
    const json = serializeSave(initialSave, {
      ...getSaveState(), inventory: inventory.exportState(), playerStats,
    }, SAVE_CATALOG, lastSavedSnapshotId);
    downloadSaveJson(json);
    lastSavedSnapshotId = (JSON.parse(json) as typeof initialSave).snapshot.id;
  }), (percent) => {
    setPlayerSanityPercent(percent);
    syncPlayerStats();
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
  if ((detail.from.containerId === PLAYER_BACKPACK_CONTAINER_ID || detail.to.containerId === PLAYER_BACKPACK_CONTAINER_ID)
    && (inventory.get(bodySlotAddress)?.itemId !== 'backpack' || detail.itemId === 'backpack')) return;

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
    && !isLightStaff(detail.itemId) && detail.itemId !== 'bugnet' && detail.itemId !== 'hammer'
    && detail.itemId !== 'pickaxe' && detail.itemId !== 'goldenpickaxe' && !isPitchforkTool(detail.itemId))) return;
  if (isHandSlot(detail.to)) playerAnimation?.playItemTransition('item_out', detail.itemId);
  else if (isHandSlot(detail.from)) playerAnimation?.playItemTransition('item_in', detail.itemId);
});
window.addEventListener('game:slot-select', (event) => {
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
  if (stack.itemId === 'backpack') {
    const equipped = slot.containerId === bodySlotAddress.containerId && slot.slotKey === bodySlotAddress.slotKey;
    const target = equipped
      ? Array.from({ length: 15 }, (_, index) => inventorySlotAddress(index)).find((address) => !inventory.get(address))
      : inventory.get(bodySlotAddress) === null ? bodySlotAddress : undefined;
    if (target) inventory.applySlotChanges([
      { slot, itemId: stack.itemId, skinId: stack.skinId, delta: -1 },
      { slot: target, itemId: stack.itemId, skinId: stack.skinId, delta: 1 },
    ]);
  }
});
gameUi.crafting.addEventListener('game:craft-request', (event) => {
  cancelHandTool();
  const { recipeId, skinId } = (event as CustomEvent<CraftRequestDetail>).detail;
  const recipe = INVENTORY_RECIPES[recipeId];
  if (!recipe) return;

  inventory.craft(recipe, skinId,
    inventoryReceiveEffect(gameUi.inventoryBar, view.camera, view.renderer.domElement, player.position));
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
