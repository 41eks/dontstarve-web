// src/main.ts

import './style.css';
import { GROUND_ITEM_DEFINITIONS } from '@dontstarve-web/prefab/groundItems';
import {
  INVENTORY_RECIPES,
  equipmentSlotAddress,
  mountGameUi,
  createChestInventoryPanel,
  type CraftingStateDetail,
  type CraftRequestDetail,
  type ChestCloseDetail,
  type CookRequestDetail,
  type DebugCommandDetail,
  type SlotAddress,
  type SlotItem,
  type SlotContextMenuDetail,
  type SlotSelectDetail,
  type SlotTransferRequest,
  slotTransferController,
} from '@dontstarve-web/ui';
import {
  SpellCastActionController,
  BugNetCaptureController,
  HammerActionController,
  PickaxeActionController,
  PitchforkActionController,
  FarmHoeActionController,
  ShovelActionController,
  FoodActionController,
  PickActionController,
  type FoodSource,
  ReskinActionController,
  PointerRaycaster,
} from '@dontstarve-web/stategraphs';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';
import { FARM_PLOW_ITEM_ID } from '@dontstarve-web/prefab/farm_plow';
import { FOOD_EFFECTS } from '@dontstarve-web/prefab/food';
import { startCookPotCooking } from '@dontstarve-web/prefab/cook_pot';
import { BASE_COOK_TIME, CalculateRecipe, canCookBeefaloFeed } from './cook';
import type * as THREE from 'three';
import type { GroundItemDefinition } from '@dontstarve-web/prefab/groundPrefab';
import { UpdateSoundListener, PreloadSounds } from '@dontstarve-web/prefab/sound';
import { turfMap } from './building';
import { backTasks, frontTasks, registerFrontTask } from './animate';
import { input } from './InputManager';
import { view, actionEvents } from './view';
import { spellCastMap } from './spellCastMap';
import { backpackContainerId, isBackpackContainerId, inventorySlotAddress, cursorSlotAddress, PreparedFoodSlot, StorageSlot, type InventoryStack } from '@dontstarve-web/inventory';
import { player } from './player';
import { bindPlayerHandEquipment } from './playerHandEquipment';
import { bindPlayerHeadEquipment } from './playerHeadEquipment';
import { bindPlayerBodyEquipment } from './playerBodyEquipment';
import { cursorUi, dstLighting, renderer } from './universal';
import { DstLightingRenderer } from './dstLighting';
import { camera } from './camera';
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
import { getDstClock } from './tuning';
import { initialSave } from './save/initialSave';
import { inventoryStateFromSave } from './save/inventoryState';
import { SAVE_CATALOG } from './save/catalog';
import { serializeSave } from './save/serialize';
import { downloadSaveJson } from './save/download';
import { setupEmoteWheel } from './emoteWheel';
import { inventoryReceiveEffect } from './inventoryReceive';
import { playerStats, getPlayerStats, setPlayerSanityPercent, applyPlayerFoodEffects } from './playerStats';

const lighting = await DstLightingRenderer.create(
  renderer,
  `${import.meta.env.BASE_URL}dst/data/images/colour_cubes`,
  {
    sanityPercent: playerStats.sanity.percent,
  },
);
window.dispatchEvent(new CustomEvent('game:lighting-ready', { detail: lighting }));

UpdateSoundListener(player.position);
backTasks.push(() => UpdateSoundListener(player.position));

const gameUi = mountGameUi({ assetBaseUrl: `${import.meta.env.BASE_URL}dst/data/ui/` });
gameUi.cookPotPanel.setCookingValidator(items => canCookBeefaloFeed(items.map(item =>
  item ? { itemId: item.id, count: item.count } : null)));
function syncPlayerStats(): void {
  gameUi.statusHud.setStats(getPlayerStats());
}
Object.values(playerStats).forEach(stat => stat.subscribe(syncPlayerStats));
syncPlayerStats();
const inventoryPanelOptions = { camera, canvas: renderer.domElement, player };
const chestInventoryPanel = createChestInventoryPanel(gameUi.chestPanel, inventoryPanelOptions);
const cookPotInventoryPanel = createChestInventoryPanel(gameUi.cookPotPanel, inventoryPanelOptions, 'cookpot');
const iceBoxInventoryPanel = createChestInventoryPanel(gameUi.iceBoxPanel, inventoryPanelOptions, 'icebox');
backTasks.push(chestInventoryPanel.update, cookPotInventoryPanel.update, iceBoxInventoryPanel.update);
export const inventory = createInventoryStore();
const cursorAddress = cursorSlotAddress();
export const handEquipment = inventory.handEquipment;
export const headEquipment = inventory.headEquipment;
export const bodyEquipment = inventory.bodyEquipment;
const storageContainers = new Map<string, StorageBuildingId>();
const cookPotModels = new Map<string, THREE.Group>();
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
const handPointer = view.mouseActions?.pointer ?? new PointerRaycaster(view);
const bodySlotAddress = equipmentSlotAddress('body');

function isHandSlot(address: SlotAddress): boolean {
  return address.containerId === handSlotAddress.containerId
    && address.slotKey === handSlotAddress.slotKey;
}

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

const handEquipmentBinding = await bindPlayerHandEquipment({
  handEquipmentExistenceState: inventory.handEquipmentExistenceState,
  animation: playerAnimation,
  soundPosition: player.position,
  setLightActive: active => dstLighting.setTorchOwner(active ? player : null),
  setHandAction: action => cursorUi.setHandAction(action, handPointer),
  lightStaffWorld: {
    map: spellCastMap,
    preparePrefab: prefab => (prefab === 'staffcoldlight' ? polarLights : dwarfStars).prepare(),
    spawnPrefab: (prefab, position) => (prefab === 'staffcoldlight' ? polarLights : dwarfStars).spawnPrepared(position),
  },
});

const headEquipmentBinding = bindPlayerHeadEquipment({
  headEquipmentExistenceState: inventory.headEquipmentExistenceState,
  animation: playerAnimation,
});
const bodyEquipmentBinding = bindPlayerBodyEquipment({
  bodyEquipmentExistenceState: inventory.bodyEquipmentExistenceState,
  animation: playerAnimation,
  setBackpackActive(equipped, entityId) {
    const containerId = equipped && entityId ? backpackContainerId(entityId) : undefined;
    if (gameUi.backpackPanel.slotContainer?.id !== containerId) gameUi.backpackPanel.close();
    if (containerId && !gameUi.backpackPanel.slotContainer) {
      const container = inventory.getEntity(bodySlotAddress)?.components.container;
      if (!container) return;
      const state = container.toSignal();
      gameUi.backpackPanel.open({ containerId, slotCount: state.peek().slotCount, title: '背包' });
      gameUi.backpackPanel.bindContainer(state, inventorySlotItem);
    }
  },
});

// Restore only after subscribing: committed signal writes drive all equipment.
handEquipmentBinding.withoutTransitions(() => inventory.replaceState(inventoryStateFromSave(initialSave), INVENTORY_RECIPES));

function syncInventorySlot(address: SlotAddress): void {
  const isBackpack = isBackpackContainerId(address.containerId);
  if (isBackpack) return;
  const storagePrefab = storageContainers.get(address.containerId);
  const panel = storagePrefab === undefined ? undefined : storagePanel(storagePrefab);
  if (panel && panel.slotContainer?.id !== address.containerId) return;
  const inventoryBar = panel ?? gameUi.inventoryBar;
  const stack = inventory.getEntity(address)?.snapshot();
  if (!stack) {
    inventoryBar.setSlot(address, null);
    return;
  }

  inventoryBar.setSlot(address, inventorySlotItem(stack,
    storagePrefab && buildingContainerDefinition(storagePrefab).singleItems ? 1 : undefined));
}

function inventorySlotItem(stack: Readonly<InventoryStack>, maxStack?: number): SlotItem {
  const spec = inventory.getStackSpec(stack);
  return {
    ...(stack.entityId === undefined ? {} : { entityId: stack.entityId }),
    id: stack.itemId,
    ...(stack.skinId === undefined ? {} : { skinId: stack.skinId }),
    name: spec.name,
    count: stack.count,
    maxStack: maxStack ?? spec.maxStack,
    icon: spec.icon,
    ...(spec.atlas ? { atlas: spec.atlas } : {}),
    ...(spec.equippable ? { equippable: spec.equippable } : {}),
    ...(spec.maxFuel === undefined ? {} : {
      durabilityPercent: (stack.remainingFuel ?? spec.maxFuel) / spec.maxFuel,
    }),
    ...(spec.maxUses === undefined ? {} : {
      durabilityPercent: (stack.remainingUses ?? spec.maxUses) / spec.maxUses,
    }),
  };
}

function syncCraftingInventory(): void {
  gameUi.crafting.setMaterialSummary(inventory.materialSummary());
  gameUi.crafting.setBufferedRecipes(inventory.buffered());
}

inventory.addresses().forEach(syncInventorySlot);
syncCraftingInventory();
inventory.subscribe((changedSlots) => {
  changedSlots.forEach(syncInventorySlot);
  syncCraftingInventory();
});

frontTasks.push(dt => {
  handEquipmentBinding.update(dt);
  headEquipmentBinding.update(dt);
  bodyEquipmentBinding.update(dt);
});

const { buildingPlacement, groundItems, dwarfStars, polarLights, flowerPlanting, farmPlow, rockManager, wormholes, reskinEffects, registry, getSaveState, registerDisposal } = await startScene(
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
    if (buildId === 'cookpot') cookPotModels.set(id, model);
    inventory.setStorageAccessible(id, isOpen);
    if (isOpen) {
      inventory.addresses()
        .filter(({ containerId }) => containerId === id)
        .forEach(syncInventorySlot);
    }
  },
  () => playerAnimation?.playPickup(),
  (elapsedSeconds, dt) => gameUi.statusHud.setClock(getDstClock(elapsedSeconds), dt),
  inventory.entities,
);
const picking = new PickActionController(view, {
  giveItem: (itemId, count, sourcePosition) => inventory.add(itemId, count, undefined,
    inventoryReceiveEffect(gameUi.inventoryBar, view.camera, view.renderer.domElement, sourcePosition)),
}, () => {
  playerAnimation?.playPickup();
});
registerDisposal(() => picking.dispose());
gameUi.cookPotPanel.addEventListener('game:cook-request', event => {
  const { containerId } = (event as CustomEvent<CookRequestDetail>).detail;
  if (gameUi.cookPotPanel.slotContainer?.id !== containerId) return;
  const model = cookPotModels.get(containerId);
  if (!model) return;
  const slots = Array.from({ length: 4 }, (_, index) => ({ containerId, slotKey: String(index) }));
  const ingredients = slots.map(slot => inventory.get(slot));
  if (!canCookBeefaloFeed(ingredients)) return;
  const recipe = CalculateRecipe('cookpot', ingredients.map(item => item!.itemId));
  if (recipe?.[0] !== 'beefalofeed') return;
  buildingPlacement.performOpenAction(model, context => startCookPotCooking(context, () =>
    inventory.applySlotChanges(slots.map((slot, index) => ({ slot, ...ingredients[index]!, delta: -1 }))),
    BASE_COOK_TIME * recipe[1]));
});
const foodActions = playerAnimation ? new FoodActionController(view, playerAnimation, locomotor, farmPlow,
  input.isActionInterrupting,
  (error) => console.error('Unable to use food', error), () => slotTransferController.clearSelection()) : undefined;
if (foodActions) {
  registerDisposal(registerFrontTask(() => foodActions.update()));
  registerDisposal(() => foodActions.dispose());
}
function inventoryFoodSource(slot: SlotAddress, itemId: string): FoodSource {
  const entity = inventory.getEntity(slot), skinId = entity?.skinId;
  const isValid = () => entity !== null && !entity.isRemoved && entity.prefab === itemId
    && entity.skinId === skinId && inventory.getEntity(slot) === entity;
  const foodDrink = FOOD_EFFECTS[itemId]?.foodDrink;
  return {
    foodDrink,
    prepareEat: () => PreloadSounds(foodDrink ? 'dontstarve/wilson/sip' : 'dontstarve/wilson/eat'),
    isValid,
    take: () => isValid() && inventory.applySlotChanges([{ slot, itemId, skinId, delta: -1 }]),
  };
}

if (playerAnimation) {
  view.registerFrameTask = registerFrontTask;
  const bugNet = new BugNetCaptureController(view, playerAnimation, locomotor,
    handEquipment,
    () => groundItems.netCaptureTargets,
    input.isActionInterrupting);
  registerDisposal(() => bugNet.dispose());
  groundItems.setNetCaptureHandler(target => bugNet.request(target));
}
if (playerAnimation) {
  const spellcast = new SpellCastActionController(view, playerAnimation, locomotor, handEquipment, {
    position: player.position,
    hasTag: tag => player.userData.tags?.includes(tag) ?? false,
    components: { sanity: { doDelta: delta => playerStats.sanity.set(playerStats.sanity.peek() + delta) } },
  }, input.isActionInterrupting, (error) => console.error('Unable to cast spell', error));
  registerDisposal(() => spellcast.dispose());

  const hammer = new HammerActionController(view, playerAnimation, locomotor,
    handEquipment,
    () => [...buildingPlacement.hammerTargets, ...farmPlow.hammerTargets, ...groundItems.hammerTargets],
    input.isActionInterrupting);
  const pickaxe = new PickaxeActionController(view, playerAnimation, locomotor,
    handEquipment, () => rockManager.mineTargets, input.isActionInterrupting);
  const pitchfork = new PitchforkActionController(view, playerAnimation, locomotor,
    handEquipment, turfMap, input.isActionInterrupting);
  const farmHoe = new FarmHoeActionController(view, playerAnimation, locomotor,
    handEquipment, farmPlow, input.isActionInterrupting,
    (error) => console.error('Unable to till farm soil', error));
  const shovel = new ShovelActionController(view, playerAnimation, locomotor,
    handEquipment, () => farmPlow.digTargets, input.isActionInterrupting);
  const reskin = new ReskinActionController(view, playerAnimation, locomotor,
    handEquipment,
    () => [...buildingPlacement.reskinTargets, ...groundItems.reskinTargets, ...wormholes.reskinTargets], reskinEffects,
    input.isActionInterrupting, (error) => console.error('Unable to reskin target', error));
  for (const controller of [hammer, pickaxe, pitchfork, farmHoe, shovel, reskin]) {
    registerDisposal(() => controller.dispose());
  }
}

registerDisposal(setupEmoteWheel(gameUi.emoteWheel, view.renderer.domElement, playerAnimation,
  actionEvents, () => cursorUi.update()));

let lastSavedSnapshotId = initialSave.snapshot.id;
gameUi.debugConsole.addEventListener('game:debug-command', (event) => {
  const { command } = (event as CustomEvent<DebugCommandDetail>).detail;
  void executeDebugCommand(command, inventory, (prefabId) => registry.spawn(prefabId), () => gameUi.savingIndicator.whileSaving(() => {
    handEquipmentBinding.flush();
    const json = serializeSave(initialSave, {
      ...getSaveState(), inventory: inventory.exportState(), playerStats: getPlayerStats(),
    }, SAVE_CATALOG, lastSavedSnapshotId);
    downloadSaveJson(json);
    lastSavedSnapshotId = (JSON.parse(json) as typeof initialSave).snapshot.id;
  }), setPlayerSanityPercent).then((result) => {
    if (result.ok) console.info(result.message);
    else console.warn(result.message);
  }).catch((error: unknown) => {
    console.error(`Unable to execute debug command: ${command}`, error);
  });
});

window.addEventListener('game:slot-transfer-request', (event) => {
  const detail = (event as CustomEvent<SlotTransferRequest>).detail;
  if (!Number.isSafeInteger(detail.amount) || detail.amount <= 0) return;

  if (isHandSlot(detail.from) || isHandSlot(detail.to)) handEquipmentBinding.flush();
  const transferred = detail.swapWith
    ? inventory.swap(detail.from, detail.to, {
      from: { entityId: detail.entityId, itemId: detail.itemId, skinId: detail.skinId, count: detail.amount },
      to: detail.swapWith,
    })
    : inventory.transfer(detail.from, detail.to, detail.amount, {
      itemId: detail.itemId, entityId: detail.entityId, skinId: detail.skinId,
    });
  slotTransferController.completeTransfer(detail.operationId, transferred);
});
window.addEventListener('game:cursor-return-request', event => {
  const { origin } = (event as CustomEvent<{ origin?: SlotAddress }>).detail;
  inventory.returnCursor(origin);
});
view.mouseActions?.register(() => groundItems.phonographTargets.map(target => ({
  action: { action: 'GIVE', modifier: 'PLACE_ITEM', invobject: {
    prefab: 'record', hasTag: () => false, getDisplayName: () => GROUND_ITEM_DEFINITIONS.record.name,
  } },
  button: 'left', model: target.model,
  available: target.canInsert && inventory.get(cursorAddress)?.itemId === 'record',
})));
groundItems.setPhonographRecordSource(() => {
  const entity = inventory.getEntity(cursorAddress);
  const stack = inventory.get(cursorAddress);
  if (!entity || stack?.itemId !== 'record') return undefined;
  return { skinId: stack.skinId, take: () => {
    if (inventory.getEntity(cursorAddress) !== entity) return false;
    const current = inventory.get(cursorAddress);
    if (current?.itemId !== 'record' || current.skinId !== stack.skinId) return false;
    if (!inventory.applySlotChanges([{ slot: cursorAddress, entityId: entity.id, itemId: 'record', skinId: stack.skinId, delta: -1 }])) return false;
    playerAnimation?.playPickup();
    return true;
  } };
});
window.addEventListener('game:slot-select', (event) => {
  const { slot } = (event as CustomEvent<SlotSelectDetail>).detail;
  actionEvents.emit('action:interrupt', { reason: 'slot-select' });
  const stack = inventory.get(slot);
  if (stack?.itemId === 'seeds' && foodActions) {
    event.preventDefault();
    foodActions.begin(inventoryFoodSource(slot, stack.itemId));
    slotTransferController.showSelection(slot);
    return;
  }
  if (stack?.itemId === FARM_PLOW_ITEM_ID) {
    event.preventDefault();
    const entity = inventory.getEntity(slot);
    if (!entity) return;
    void farmPlow.begin(() => inventory.extract(slot, 1, entity) ?? undefined).catch((error: unknown) => console.error('Unable to deploy farm plow', error));
    return;
  }
  if (!stack || !isPlaceableBuildingId(stack.itemId)) return;
  // Placement claims the click so the stack is not picked up for a transfer.
  event.preventDefault();
  void buildingPlacement.begin(stack.itemId, stack.skinId).catch((error: unknown) => {
    console.error(`Unable to start ${stack.itemId} placement`, error);
  });
});
window.addEventListener('game:slot-context-menu', (event) => {
  const { slot, shiftKey } = (event as CustomEvent<SlotContextMenuDetail>).detail;
  actionEvents.emit('action:interrupt', { reason: 'slot-context-menu' });
  if (isHandSlot(slot)) handEquipmentBinding.flush();
  const stack = inventory.get(slot);
  if (!stack) return;
  if (shiftKey) {
    actionEvents.emit('action:interrupt', { reason: 'drop' });
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
  if (stack.itemId === 'butterfly') {
    void flowerPlanting.begin(() => inventory.applySlotChanges([{
      slot, itemId: 'butterfly', delta: -1,
      ...(stack.skinId === undefined ? {} : { skinId: stack.skinId }),
    }])).catch((error: unknown) => {
      console.error('Unable to start butterfly planting', error);
    });
    return;
  }
  const foodEffects = FOOD_EFFECTS[stack.itemId];
  if (foodEffects && foodActions) {
    void foodActions.eat(inventoryFoodSource(slot, stack.itemId), () => {
      applyPlayerFoodEffects(foodEffects);
    }).catch((error: unknown) => console.error(`Unable to eat ${stack.itemId}`, error));
    return;
  }
  if (stack.itemId === 'backpack') {
    const equipped = slot.containerId === bodySlotAddress.containerId && slot.slotKey === bodySlotAddress.slotKey;
    const target = equipped
      ? Array.from({ length: 15 }, (_, index) => inventorySlotAddress(index)).find((address) => !inventory.get(address))
      : inventory.get(bodySlotAddress) === null ? bodySlotAddress : undefined;
    if (target) inventory.transfer(slot, target, 1);
  }
});
gameUi.crafting.addEventListener('game:craft-request', (event) => {
  actionEvents.emit('action:interrupt', { reason: 'craft' });
  const { recipeId, skinId } = (event as CustomEvent<CraftRequestDetail>).detail;
  const recipe = INVENTORY_RECIPES[recipeId];
  if (!recipe) return;

  inventory.craft(recipe, skinId,
    inventoryReceiveEffect(gameUi.inventoryBar, view.camera, view.renderer.domElement, player.position));
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
  if (crafting) actionEvents.emit('action:interrupt', { reason: 'crafting' });
  playerAnimation?.setCrafting(crafting);
});
