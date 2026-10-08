// src/main.ts

import './style.css';
export { handEquipment } from '@dontstarve-web/signals';
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
  slotTransferController,
} from '@dontstarve-web/ui';
import {
  setupLightStaffCasting,
  BugNetCaptureController,
  HammerActionController,
  PickaxeActionController,
  PitchforkActionController,
  FarmHoeActionController,
  ShovelActionController,
  SeedsActionController,
  type SeedSource,
  ReskinActionController,
  PointerRaycaster,
} from '@dontstarve-web/stategraphs';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';
import { isHatId } from '@dontstarve-web/prefab/hats';
import { isPitchforkTool } from '@dontstarve-web/prefab/pitchfork';
import { isFarmHoeTool } from '@dontstarve-web/prefab/farm_hoe';
import { isShovelTool } from '@dontstarve-web/prefab/shovel';
import { FARM_PLOW_ITEM_ID } from '@dontstarve-web/prefab/farm_plow';
import { SEEDS_HUNGER } from '@dontstarve-web/prefab/seeds';
import type { GroundItemDefinition } from '@dontstarve-web/prefab/groundPrefab';
import { DisposeSounds, UpdateSoundListener, PreloadSounds } from '@dontstarve-web/prefab/sound';
import { disposeAnimationAssets, disposeAtlasImages } from '@dontstarve-web/animation';
import { turfMap } from './building';
import { backTasks, frontTasks } from './animate';
import { input } from './InputManager';
import { view } from './view';
import { BACKPACK_SLOT_COUNT, PLAYER_BACKPACK_CONTAINER_ID, backpackSlotAddress, inventorySlotAddress, PreparedFoodSlot, StorageSlot } from '@dontstarve-web/inventory';
import { player } from './player';
import { bindPlayerHandEquipment } from './playerHandEquipment';
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

const handEquipmentBinding = await bindPlayerHandEquipment({
  animation: playerAnimation,
  soundPosition: player.position,
  setLightActive: active => dstLighting.setTorchOwner(active ? player : null),
  setHandAction: action => cursorUi.setHandAction(action, handPointer),
});

// Restore only after subscribing: the committed signal write drives equipment and animation.
inventory.replaceState(inventoryStateFromSave(initialSave), INVENTORY_RECIPES);

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
    ...(spec.maxFuel === undefined ? {} : {
      durabilityPercent: (stack.remainingFuel ?? spec.maxFuel) / spec.maxFuel,
    }),
  });
}

function syncCraftingInventory(): void {
  gameUi.crafting.setMaterialSummary(inventory.materialSummary());
  gameUi.crafting.setBufferedRecipes(inventory.buffered());
}

inventory.addresses().forEach(syncInventorySlot);
syncCraftingInventory();
syncHeadEquipment();
syncBodyEquipment();
syncCraftingInventory();
inventory.subscribe((changedSlots) => {
  changedSlots.forEach(syncInventorySlot);
  syncCraftingInventory();
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

frontTasks.push(dt => handEquipmentBinding.update(dt));
window.addEventListener('pagehide', () => handEquipmentBinding.dispose(), { once: true });

let cancelNetCapture = () => {};
let cancelHandTool = () => {};
const { buildingPlacement, groundItems, dwarfStars, polarLights, flowerPlanting, farmPlow, rockManager, wormholes, reskinEffects, registry, getSaveState, dispose: disposeScene } = await startScene(
  (buildingId, skinId) => inventory.takeBuffered(buildingId) || inventory.takeItem(buildingId, skinId),
  (item, action, sourcePosition) => {
    const effect = inventoryReceiveEffect(gameUi.inventoryBar, view.camera, view.renderer.domElement, sourcePosition);
    if (!item.entity || !inventory.receive(item.entity, effect)) return false;
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
  inventory.entities,
);
const seeds = playerAnimation ? new SeedsActionController(view, playerAnimation, locomotor, farmPlow,
  () => (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'] as const).some((key) => input.isPressed(key)),
  (error) => console.error('Unable to use seeds', error), () => slotTransferController.clearSelection()) : undefined;
if (seeds) {
  frontTasks.push(() => seeds.update());
  window.addEventListener('pagehide', () => seeds.dispose(), { once: true });
}
function seedSource(slot: SlotAddress): SeedSource {
  return {
    prepareEat: () => PreloadSounds('dontstarve/wilson/eat'),
    isValid: () => inventory.get(slot)?.itemId === 'seeds',
    take: () => inventory.get(slot)?.itemId === 'seeds'
      && inventory.applySlotChanges([{ slot, itemId: 'seeds', delta: -1 }]),
  };
}
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
    () => [...buildingPlacement.hammerTargets, ...farmPlow.hammerTargets, ...groundItems.hammerTargets],
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
  const farmHoe = new FarmHoeActionController(view, playerAnimation, locomotor,
    () => {
      const tool = inventory.get(handSlotAddress);
      return tool && isFarmHoeTool(tool.itemId) ? tool : undefined;
    }, farmPlow,
    () => (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'] as const).some((key) => input.isPressed(key)),
    () => {
      cancelNetCapture(); seeds?.cancel(); flowerPlanting.cancel(); buildingPlacement.cancel(); farmPlow.cancel();
    }, (error) => console.error('Unable to till farm soil', error));
  const shovel = new ShovelActionController(view, playerAnimation, locomotor,
    () => isShovelTool(handTool() ?? ''), () => farmPlow.digTargets,
    () => (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'] as const).some((key) => input.isPressed(key)),
    () => {
      cancelNetCapture(); seeds?.cancel(); flowerPlanting.cancel(); buildingPlacement.cancel(); farmPlow.cancel();
    });
  const reskin = new ReskinActionController(view, playerAnimation, locomotor,
    () => {
      const tool = inventory.get(handSlotAddress);
      return tool?.itemId === 'reskin_tool' ? tool : undefined;
    },
    () => [...buildingPlacement.reskinTargets, ...groundItems.reskinTargets, ...wormholes.reskinTargets], reskinEffects,
    () => (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'] as const).some((key) => input.isPressed(key)),
    () => {
      cancelNetCapture(); hammer.cancel(); pickaxe.cancel(); pitchfork.cancel(); farmHoe.cancel(); shovel.cancel();
      flowerPlanting.cancel(); buildingPlacement.cancel();
    },
    (error) => console.error('Unable to reskin target', error));
  cancelHandTool = () => { hammer.cancel(); pickaxe.cancel(); pitchfork.cancel(); farmHoe.cancel(); shovel.cancel(); reskin.cancel(); farmPlow.cancel(); seeds?.cancel(); };
  frontTasks.push((dt) => { hammer.update(dt); pickaxe.update(dt); pitchfork.update(dt); farmHoe.update(); shovel.update(dt); reskin.update(dt); });
  window.addEventListener('pagehide', () => {
    reskin.dispose(); farmHoe.dispose(); shovel.dispose();
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
  inventory.entities.dispose();
  DisposeSounds();
  disposeAnimationAssets();
  disposeAtlasImages();
}, { once: true });
gameUi.debugConsole.addEventListener('game:debug-command', (event) => {
  const { command } = (event as CustomEvent<DebugCommandDetail>).detail;
  void executeDebugCommand(command, inventory, (prefabId) => registry.spawn(prefabId), () => gameUi.savingIndicator.whileSaving(() => {
    handEquipmentBinding.flush();
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

  if (isHandSlot(detail.from) || isHandSlot(detail.to)) handEquipmentBinding.flush();
  const transferred = inventory.transfer(detail.from, detail.to, detail.amount, {
    itemId: detail.itemId, skinId: detail.skinId,
  });
  if (!transferred) return;
  if (isHandSlot(detail.to)) handEquipmentBinding.playTransition('item_out', detail.itemId);
  else if (isHandSlot(detail.from)) handEquipmentBinding.playTransition('item_in', detail.itemId);
});
let selectedRecordSlot: SlotAddress | undefined;
const recordPointer = new PointerRaycaster(view);
const recordLabel = view.createCursorLabel?.(recordPointer);
frontTasks.push(() => {
  if (selectedRecordSlot && inventory.get(selectedRecordSlot)?.itemId === 'record') recordLabel?.show(': 放入唱片', 'left');
  else recordLabel?.hide();
  recordLabel?.update();
});
window.addEventListener('pagehide', () => { recordPointer.dispose(); recordLabel?.hide(); }, { once: true });
groundItems.setPhonographRecordSource(() => {
  const slot = selectedRecordSlot;
  const stack = slot && inventory.get(slot);
  if (!slot || stack?.itemId !== 'record') return undefined;
  return { skinId: stack.skinId, take: () => {
    if (selectedRecordSlot !== slot) return false;
    const current = inventory.get(slot);
    if (current?.itemId !== 'record' || current.skinId !== stack.skinId) return false;
    if (!inventory.applySlotChanges([{ slot, itemId: 'record', skinId: stack.skinId, delta: -1 }])) return false;
    selectedRecordSlot = undefined;
    playerAnimation?.playPickup();
    return true;
  } };
});
window.addEventListener('keydown', (event) => {
  if (['Escape', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(event.code)) selectedRecordSlot = undefined;
});
window.addEventListener('game:slot-select', (event) => {
  const { slot } = (event as CustomEvent<SlotSelectDetail>).detail;
  cancelHandTool();
  flowerPlanting.cancel();
  const stack = inventory.get(slot);
  selectedRecordSlot = undefined;
  if (stack?.itemId === 'seeds' && seeds) {
    event.preventDefault(); cancelNetCapture(); locomotor.stop(); buildingPlacement.cancel();
    seeds.begin(seedSource(slot));
    slotTransferController.showSelection(slot);
    return;
  }
  if (stack?.itemId === FARM_PLOW_ITEM_ID) {
    event.preventDefault(); locomotor.stop(); buildingPlacement.cancel();
    const entity = inventory.getEntity(slot);
    if (!entity) return;
    void farmPlow.begin(() => inventory.extract(slot, 1, entity) ?? undefined).catch((error: unknown) => console.error('Unable to deploy farm plow', error));
    return;
  }
  if (!stack || !isPlaceableBuildingId(stack.itemId)) return;
  // Placement claims the click so the stack is not picked up for a transfer.
  event.preventDefault();
  locomotor.stop();
  void buildingPlacement.begin(stack.itemId, stack.skinId).catch((error: unknown) => {
    console.error(`Unable to start ${stack.itemId} placement`, error);
  });
});
window.addEventListener('game:slot-context-menu', (event) => {
  const { slot, shiftKey } = (event as CustomEvent<SlotContextMenuDetail>).detail;
  cancelHandTool();
  selectedRecordSlot = undefined;
  if (isHandSlot(slot)) handEquipmentBinding.flush();
  const stack = inventory.get(slot);
  if (!stack) return;
  if (shiftKey) {
    flowerPlanting.cancel();
    const spec = inventory.getStackSpec(stack);
    const position = player.position.clone();
    const entity = inventory.getEntity(slot);
    if (!entity) return;
    const definition: GroundItemDefinition = {
      itemId: stack.itemId,
      ...(stack.skinId === undefined ? {} : { skinId: stack.skinId }),
      name: spec.name,
      icon: spec.icon,
      ...(spec.atlas ? { atlas: spec.atlas } : {}),
      count: 1,
      ...(stack.remainingUses === undefined ? {} : { remainingUses: stack.remainingUses }),
      ...(stack.remainingFuel === undefined ? {} : { remainingFuel: stack.remainingFuel }),
      ...(stack.phonographRecord === undefined ? {} : { phonographRecord: stack.phonographRecord }),
    };
    void groundItems.drop(definition, position, () => {
      if (isHandSlot(slot)) handEquipmentBinding.flush();
      const current = inventory.get(slot);
      if (current?.itemId !== stack.itemId || current.skinId !== stack.skinId
        || current.remainingUses !== stack.remainingUses || current.phonographRecord !== stack.phonographRecord) return false;
      return inventory.extract(slot, 1, entity) ?? false;
    }).then((dropped) => {
      if (dropped) playerAnimation?.playPickup();
    }).catch((error: unknown) => {
      console.error(`Unable to drop ${stack.itemId}`, error);
    });
    return;
  }
  if (stack.itemId === 'record') {
    locomotor.stop(); flowerPlanting.cancel(); buildingPlacement.cancel();
    selectedRecordSlot = slot;
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
  if (stack.itemId === 'seeds' && seeds) {
    cancelNetCapture(); flowerPlanting.cancel(); buildingPlacement.cancel();
    void seeds.eat(seedSource(slot), () => {
      playerStats.hunger = Math.min(150, playerStats.hunger + SEEDS_HUNGER);
      syncPlayerStats();
    }).catch((error: unknown) => console.error('Unable to eat seeds', error));
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
