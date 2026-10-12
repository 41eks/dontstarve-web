// src/main.ts

import './style.css';
import { INVENTORY_ITEM_SPECS } from './inventoryItems';
import { isPhonographRecord } from '@dontstarve-web/prefab/records';
import {
  INVENTORY_RECIPES,
  equipmentSlotAddress,
  mountGameUi,
  SanityVignette,
  type CraftingStateDetail,
  type CraftRequestDetail,
  type ChestCloseDetail,
  type DebugCommandDetail,
  type SlotAddress,
  type SlotItem,
  type SlotSelectDetail,
  type SlotTransferRequest,
  slotTransferController,
} from '@dontstarve-web/ui';
import { type PickupDoer, PointerRaycaster } from '@dontstarve-web/stategraphs';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';
import { FARM_PLOW_ITEM_ID, SEED_ITEM_IDS } from '@dontstarve-web/prefab/farm_plow';
import { UpdateSoundListener } from '@dontstarve-web/prefab/sound';
import { turfMap } from './building';
import { backTasks, frontTasks, registerFrontTask } from './animate';
import { input } from './InputManager';
import { view, actionEvents } from './view';
import { spellCastMap } from './spellCastMap';
import { backpackContainerId, inventorySlotAddress, cursorSlotAddress, type InventoryStack } from '@dontstarve-web/inventory';
import { player } from './player';
import { OnItemRanOut } from '@dontstarve-web/prefab/player_common';
import { bindPlayerHandEquipment } from './playerHandEquipment';
import { bindPlayerHeadEquipment } from './playerHeadEquipment';
import { bindPlayerBodyEquipment } from './playerBodyEquipment';
import { cursorUi, renderer } from './universal';
import { DstLightingRenderer } from './dstLighting';
import {
  STORAGE_BUILDING_IDS, buildingContainerId, createBuildingContainer, isStorageBuildingId,
} from '@dontstarve-web/prefab/containers';
import { executeDebugCommand } from './debugCommands';
import { isPlaceableBuildingId } from './placeableBuilding';
import {
  createInventoryStore,
} from './inventory';
import { locomotor, startScene } from './scene';
import { createDisposalResources } from './registerDisposal';
import { initialSave } from './save/initialSave';
import { inventoryStateFromSave } from './save/inventoryState';
import { SAVE_CATALOG } from './save/catalog';
import { serializeSave } from './save/serialize';
import { downloadSaveJson } from './save/download';
import { inventoryReceiveEffect } from './inventoryReceive';
import { playerStats, getPlayerStats, setPlayerSanityPercent } from './playerStats';
import { Sanity } from '../packages/componets/src/sanity';

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
function syncPlayerStats(): void {
  gameUi.statusHud.setStats(getPlayerStats());
}
Object.values(playerStats).forEach(stat => stat.subscribe(syncPlayerStats));
syncPlayerStats();
export const inventory = createInventoryStore();
const cursorAddress = cursorSlotAddress();
export const handEquipment = inventory.handEquipment;
export const headEquipment = inventory.headEquipment;
export const bodyEquipment = inventory.bodyEquipment;
for (const prefab of STORAGE_BUILDING_IDS) {
  for (const record of initialSave.world.entities[prefab] ?? []) {
    if (record.components.building?.burnt && !record.components.container) continue;
    inventory.registerContainer(buildingContainerId(prefab, record.id), createBuildingContainer(prefab, {}));
  }
}
for (const panel of [gameUi.chestPanel, gameUi.cookPotPanel, gameUi.iceBoxPanel]) {
  panel.addEventListener('game:chest-close', (event) => {
    const { containerId } = (event as CustomEvent<ChestCloseDetail>).detail;
    inventory.setStorageAccessible(containerId, false);
  });
}
const playerAnimation = player.userData.animationController as WilsonAnimationController | undefined;
const pickupDoer: PickupDoer = {
  components: { inventory },
  hasTag: tag => tag === 'player' || (player.userData.tags?.includes(tag) ?? false),
  GetPosition: () => player.position,
  PushEvent: (name, data) => {
    // player_common.lua listens for itemranout; SGwilson.lua handles toolbroke.
    if (name === 'toolbroke') playerAnimation?.stategraph.pushEvent(name, data);
    else if (name === 'itemranout') OnItemRanOut(inventory, data);
    player.dispatchEvent({ type: name, data } as never);
  },
};
inventory.bindActor(pickupDoer);
playerAnimation?.bindInventory(inventory);
player.userData.components = { ...player.userData.components, inventory };
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
  owner: pickupDoer,
  animation: playerAnimation,
  soundPosition: player.position,
  lightParent: player,
  followSymbol: playerAnimation && ((symbol, x, y) => playerAnimation.followSymbol(symbol, x, y)),
  dataBaseUrl: `${import.meta.env.BASE_URL}dst/data`,
  setLanternLight: (ison, fuelPercent) => playerAnimation?.setLanternLight(ison, fuelPercent),
  setHandAction: action => cursorUi.setHandAction(action, handPointer),
  lightStaffWorld: {
    map: spellCastMap,
    preparePrefab: prefab => (prefab === 'staffcoldlight' ? polarLights : dwarfStars).prepare(),
    spawnPrefab: (prefab, position) => (prefab === 'staffcoldlight' ? polarLights : dwarfStars).spawnPrepared(position),
  },
  greenStaffWorld: { prepareLoot: items => groundItems.prepareLoot(items) },
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
  // World containers and backpacks bind their component DTO signals directly.
  if (address.containerId !== inventorySlotAddress(0).containerId
    && address.containerId !== handSlotAddress.containerId
    && address.containerId !== cursorAddress.containerId) return;
  const inventoryBar = gameUi.inventoryBar;
  const stack = inventory.getEntity(address)?.snapshot();
  if (!stack) {
    inventoryBar.setSlot(address, null);
    return;
  }

  inventoryBar.setSlot(address, inventorySlotItem(stack));
}

function inventorySlotItem(stack: Readonly<InventoryStack>, maxStack?: number): SlotItem {
  const spec = inventory.getStackSpec(stack);
  return {
    ...(stack.entityId === undefined ? {} : { entityId: stack.entityId }),
    id: stack.itemId,
    ...(stack.skinId === undefined ? {} : { skinId: stack.skinId }),
    name: spec.name,
    count: stack.count,
    ...(stack.entityId === undefined ? {} : { signals: inventory.entities.get(stack.entityId)?.signals }),
    maxStack: maxStack ?? spec.maxStack,
    icon: spec.icon,
    ...(spec.atlas ? { atlas: spec.atlas } : {}),
    ...(spec.equippable ? { equippable: spec.equippable } : {}),
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

const disposalResources = createDisposalResources({
  gameUi, view, inventory, playerAnimation, locomotor, pickupDoer, handEquipmentBinding,
  inventorySlotItem, actionEvents, isActionInterrupting: input.isActionInterrupting,
  updateCursor: () => cursorUi.update(), turfMap,
});
const sceneResources = await startScene(
  (buildingId, skinId) => inventory.takeBuffered(buildingId) || inventory.takeItem(buildingId, skinId),
  ({ buildId, isOpen, model }) => {
    if (!isStorageBuildingId(buildId)) return;
    const entityId = String(model.userData.entityId);
    disposalResources.setContainerOpen(buildId, model, isOpen);
    const id = buildingContainerId(buildId, entityId);
    inventory.setStorageAccessible(id, isOpen);
  },
  () => playerAnimation?.playPickup(),
  inventory.entities,
  inventory,
);
const { buildingPlacement, groundItems, dwarfStars, polarLights, farmPlow, registry, getSaveState, disposalEvents } = sceneResources;
const playerSanity = new Sanity({ ...pickupDoer, sg: playerAnimation?.stategraph }, playerStats.sanity);
const sanityVignette = await SanityVignette.create(playerSanity.sane, `${import.meta.env.BASE_URL}dst/data/anim`);
document.body.append(sanityVignette.canvas);
const stopVignetteUpdate = registerFrontTask(dt => sanityVignette.update(dt));
const stopSanityUpdate = registerFrontTask(dt => playerSanity.OnUpdate(dt));
player.userData.components ??= {};
player.userData.components.sanity = playerSanity;
disposalEvents.on('dispose', () => {
  headEquipmentBinding.dispose();
  stopVignetteUpdate();
  sanityVignette.dispose();
  stopSanityUpdate();
  playerSanity.dispose();
  if (player.userData.components.sanity === playerSanity) delete player.userData.components.sanity;
});
const disposalActions = disposalResources.register(disposalEvents, sceneResources);

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
view.mouseActions?.register(() => {
  const entity = inventory.getEntity(cursorAddress);
  if (!entity || !isPhonographRecord(entity)) return [];
  return groundItems.phonographTargets.map(target => ({
    action: { action: 'GIVE' as const, modifier: 'PLACE_ITEM', invobject: {
      prefab: entity.prefab, hasTag: (tag: string) => entity.hasTag(tag),
      getDisplayName: () => INVENTORY_ITEM_SPECS[entity.prefab].name,
    } },
    button: 'left' as const, model: target.model, available: target.canInsert,
  }));
});
groundItems.setPhonographRecordSource(() => {
  const entity = inventory.getEntity(cursorAddress);
  const stack = inventory.get(cursorAddress);
  if (!entity || !stack || !isPhonographRecord(entity)) return undefined;
  return { entity, take: () => {
    if (inventory.getEntity(cursorAddress) !== entity) return false;
    const current = inventory.get(cursorAddress);
    if (!isPhonographRecord(entity) || current?.itemId !== stack.itemId || current.skinId !== stack.skinId) return false;
    if (!inventory.applySlotChanges([{ slot: cursorAddress, entityId: entity.id, itemId: stack.itemId, skinId: stack.skinId, delta: -1 }])) return false;
    playerAnimation?.playPickup();
    return true;
  } };
});
window.addEventListener('game:slot-select', (event) => {
  const { slot } = (event as CustomEvent<SlotSelectDetail>).detail;
  if (inventory.getEntity(cursorAddress)) {
    if (disposalActions.useFuel(slot)) event.preventDefault();
    return;
  }
  actionEvents.emit('action:interrupt', { reason: 'slot-select' });
  const stack = inventory.get(slot);
  if (stack && SEED_ITEM_IDS.includes(stack.itemId) && disposalActions.beginFood(slot, stack.itemId)) {
    event.preventDefault();
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

/** All startup resources and bindings are ready, and the complete scene has rendered. */
export const gameReady = new Promise<void>((resolve, reject) => {
  requestAnimationFrame(() => {
    try {
      lighting.render(view.scene, view.camera);
      renderer.domElement.dataset.loaded = 'true';
      resolve();
    } catch (error) {
      reject(error);
    }
  });
});
