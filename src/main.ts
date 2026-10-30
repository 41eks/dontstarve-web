// src/main.ts

import './style.css';
import { prefabInstance } from '@dontstarve-web/prefab/prefabInstance';
import { tilePerfMark } from '../packages/componets/src/tilePerf';
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
  type MinimapStateDetail,
  type MinimapActionRequestDetail,
  type SlotAddress,
  type SlotItem,
  type SlotSelectDetail,
  type SlotTransferRequest,
  slotTransferController,
} from '@dontstarve-web/ui';
import { type PickupDoer, PointerRaycaster, type WilsonStateName } from '@dontstarve-web/stategraphs';
import { DOCK_KIT_ID } from '@dontstarve-web/prefab/dock_kit';
import { FARM_PLOW_ITEM_ID, SEED_ITEM_IDS } from '@dontstarve-web/prefab/farm_plow';
import { turfMap } from './building';
import { TILE_SIZE } from '@dontstarve-web/prefab/tile';
import { SetAutopaused } from './autopause';
import { registerFrontTask } from './animate';
import { input } from './InputManager';
import { view, actionEvents } from './view';
import { followCamera } from './camera';
import type { SpellCastMap } from '@dontstarve-web/stategraphs/spellcaster';
import { WORLD_TILES } from '@dontstarve-web/prefab/turfMap';
import { isGroundTargetBlocked, placementEntities } from '../packages/prefab/src/placementEntities';
import { backpackContainerId, inventorySlotAddress, cursorSlotAddress, type InventoryStack } from '@dontstarve-web/inventory';
import { player, playerBody, playerInstance, playerPhysics } from './player';
import { OnItemRanOut } from '@dontstarve-web/prefab/player_common';
import { bindPlayerHandEquipment } from './playerHandEquipment';
import { bindPlayerHeadEquipment } from './playerHeadEquipment';
import { bindPlayerBodyEquipment } from './playerBodyEquipment';
import { cursorUi, renderer, scene } from './universal';
import { FindEntities } from '../packages/prefab/src/actionEntity';
import { SendLightningStrike } from '@dontstarve-web/prefab/lightning';
import { AMULET_ID, type AmuletRezSource } from '@dontstarve-web/prefab/amulet';
import { WORLD_SCALE } from '../packages/prefab/src/standardcomponents';
import { DstLightingRenderer } from './dstLighting';
import {
  STORAGE_BUILDING_IDS, buildingContainerId, createBuildingContainer, isStorageBuildingId,
} from '@dontstarve-web/prefab/containers';
import { executeDebugCommand } from './debugCommands';
import { isPlaceableBuildingId } from './placeableBuilding';
import {
  createInventoryStore,
} from './inventory';
import { locomotor, startScene, worldState } from './scene';
import { WortoxPlayer } from '../packages/prefab/src/wortoxPlayer';
import { createDisposalResources } from './registerDisposal';
import { initialSave } from './save/initialSave';
import { inventoryStateFromSave } from './save/inventoryState';
import { SAVE_CATALOG } from './save/catalog';
import { serializeSave } from './save/serialize';
import { downloadClusterSave } from './save/download';
import { inventoryReceiveEffect } from './inventoryReceive';
import { playerStats, playerGhostMode, getPlayerStats, setPlayerSanityPercent } from './playerStats';
import { loadAnimationArchive } from '@dontstarve-web/animation/animationAssets';
import { createEffect, watchSignal } from '@dontstarve-web/signals';
import { Sanity } from '../packages/componets/src/sanity';
import { OnMakePlayerGhost, OnRespawnFromGhost, setGhostLight, type PlayerGhostOwner, type RezSource } from '@dontstarve-web/prefab/player_common';
import { SKELETON_PLAYER_ID } from '@dontstarve-web/prefab/skeleton';
import { modelHasTag } from '@dontstarve-web/prefab/prefabInstance';

// Independent startup loads begin together; each is awaited where it is first needed.
const animRoot = `${import.meta.env.BASE_URL}dst/data/anim`;
void loadAnimationArchive('vig.zip', animRoot).catch(() => undefined);
const lightingReady = DstLightingRenderer.create(
  renderer,
  `${import.meta.env.BASE_URL}dst/data/images/colour_cubes`,
  {
    sanityPercent: playerStats.sanity.percent,
    // player_classified pushes isghostmode into playervision:SetGhostVision.
    ghostVision: playerGhostMode,
  },
);
input.setBlocked(true);

const gameUi = mountGameUi({ assetBaseUrl: `${import.meta.env.BASE_URL}dst/data/ui/` });
gameUi.inventoryBar.player = playerInstance.prefab;
gameUi.mapControls.addEventListener('game:map-toggle', (event) => {
  gameUi.minimap.setOpen((event as CustomEvent<{ isOpen: boolean }>).detail.isOpen);
});
// MapScreen registers SetAutopaused(true) on open and releases it on destroy; M/Esc close it too.
let mapAutopaused = false;
gameUi.minimap.addEventListener('game:map-state', (event) => {
  const { isOpen, autopaused } = (event as CustomEvent<MinimapStateDetail>).detail;
  gameUi.mapControls.setMapOpen(isOpen);
  cursorUi.setWorldCovered(isOpen);
  input.setBlocked(isOpen);
  if (autopaused !== mapAutopaused) {
    SetAutopaused(autopaused);
    mapAutopaused = autopaused;
  }
});
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
const playerAnimation = playerInstance.animationController;
const pickupDoer: PickupDoer & { ListenForEvent(name: string, listener: (data: unknown) => void): () => void; HasStateTag(tag: string): boolean; GoToState(name: string): void; IsCurrentState(name: string): boolean;
  components: PickupDoer['components'] & { health: typeof playerStats.health; hunger: typeof playerStats.hunger; sanity?: Sanity } } = {
  components: { inventory, health: playerStats.health, hunger: playerStats.hunger },
  ListenForEvent(name, listener) {
    const handler = (event: { data?: unknown }) => listener(event.data);
    player.addEventListener(name as never, handler);
    return () => player.removeEventListener(name as never, handler);
  },
  hasTag: tag => tag === 'player' || modelHasTag(player, tag),
  GetPosition: () => player.position,
  HasStateTag: tag => playerAnimation?.stategraph.hasStateTag(tag) ?? false,
  GoToState: name => playerAnimation?.stategraph.goToState(name as WilsonStateName),
  IsCurrentState: name => playerAnimation?.stategraph.stateName === name,
  PushEvent: (name, data) => {
    // player_common.lua listens for itemranout; SGwilson.lua handles toolbroke.
    if (name === 'toolbroke') playerAnimation?.stategraph.pushEvent(name, data);
    else if (name === 'itemranout') OnItemRanOut(inventory, data);
    player.dispatchEvent({ type: name, data } as never);
  },
};
inventory.bindActor(pickupDoer);
// owner.components.sanity, for equipment and the dapperfn's owner; created before any equip runs.
const sanityComponents: { inventory: typeof inventory; sanity?: Sanity } = { inventory };
const playerSanity = new Sanity({ ...pickupDoer, components: sanityComponents, sg: playerAnimation?.stategraph }, playerStats.sanity);
sanityComponents.sanity = pickupDoer.components.sanity = playerSanity;
playerAnimation?.bindInventory(inventory);
playerInstance.components.inventory = inventory;
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

const groundTargetBlockers = placementEntities(scene);
/** Map:IsOceanAtPoint: the dug OCEAN_COASTAL tiles are the only water, and none of them is a visual ground. */
const spellCastMap: SpellCastMap = {
  isAboveGroundAtPoint: point => turfMap.getTileAtWorld(point) !== WORLD_TILES.INVALID,
  isOceanAtPoint: point => turfMap.isOceanAtWorld(point),
  isGroundTargetBlocked: point => isGroundTargetBlocked(groundTargetBlockers, point, .5 * WORLD_SCALE),
};

const handEquipmentBinding = await bindPlayerHandEquipment({
  handEquipmentExistenceState: inventory.handEquipmentExistenceState,
  owner: pickupDoer,
  animation: playerAnimation,
  soundPosition: player.position,
  lightParent: playerInstance,
  followSymbol: playerAnimation && ((symbol, x, y, fx) => playerAnimation.followSymbol(symbol, x, y, fx)),
  setHandAction: action => cursorUi.setHandAction(action, handPointer),
  lightStaffWorld: {
    map: spellCastMap,
    spawnPrefab: (prefab, position) => (prefab === 'staffcoldlight' ? polarLights : dwarfStars).spawn(position),
  },
  greenStaffWorld: {
    spawnLoot: (items, position) => groundItems.flingLoot(items.map(({ itemId, count }) => ({ ...inventory.getItemSpec(itemId), itemId, count })), position),
  },
  fireStaffWorld: {
    launch: (owner, target, attacker) => staffProjectiles.launch(owner, target, attacker),
    createFuel: () => inventory.entities.create({ itemId: 'cutgrass', count: 1 }),
  },
  tridentWorld: {
    map: spellCastMap,
    spawnWaterspout: position => worldFx.spawn('crab_king_waterspout', position),
  },
});

const headEquipmentBinding = bindPlayerHeadEquipment({
  owner: pickupDoer,
  headEquipmentExistenceState: inventory.headEquipmentExistenceState,
  animation: playerAnimation,
});
const bodyEquipmentBinding = bindPlayerBodyEquipment({
  owner: pickupDoer,
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

const disposalResources = createDisposalResources({
  gameUi, view, inventory, playerAnimation, locomotor, pickupDoer, handEquipmentBinding,
  inventorySlotItem, actionEvents, isActionInterrupting: input.isActionInterrupting,
  updateCursor: () => cursorUi.update(), getWatchWorldContent: worldState.getWatchWorldContent, turfMap,
});
window.dispatchEvent(new CustomEvent('game:lighting-ready', { detail: await lightingReady }));
const sceneResources = await startScene(
  (buildingId, skinId) => inventory.takeBuffered(buildingId) || inventory.takeItem(buildingId, skinId),
  ({ buildId, isOpen, model }) => {
    if (!isStorageBuildingId(buildId)) return;
    const entityId = String(prefabInstance(model)?.entityId);
    disposalResources.setContainerOpen(buildId, model, isOpen);
    const id = buildingContainerId(buildId, entityId);
    inventory.setStorageAccessible(id, isOpen);
  },
  inventory.entities,
  inventory,
);
const { scheduler, buildingPlacement, groundItems, worldFx, staffProjectiles, skeletons, dwarfStars, polarLights, farmPlow, dockKit, registry, getSaveState, disposalEvents } = sceneResources;
gameUi.minimap.bind({ terrain: turfMap, cellSize: TILE_SIZE, getPlayerPosition: () => player.position, cameraHeading: view.cameraHeading });
const sanityVignette = await SanityVignette.create(playerSanity.sane, animRoot);
document.body.append(sanityVignette.canvas);
const stopVignetteUpdate = registerFrontTask(dt => sanityVignette.update(dt));
const stopSanityUpdate = registerFrontTask(dt => playerSanity.OnUpdate(dt));
playerInstance.components.sanity = playerSanity;
disposalEvents.on('dispose', () => {
  gameUi.minimap.dispose();
  headEquipmentBinding.dispose();
  bodyEquipmentBinding.dispose();
  stopVignetteUpdate();
  sanityVignette.dispose();
  stopSanityUpdate();
  playerSanity.dispose();
  if (playerInstance.components.sanity === playerSanity) delete playerInstance.components.sanity;
});
const disposalActions = disposalResources.register(disposalEvents, sceneResources);
const wortox = playerAnimation ? await WortoxPlayer.create({
  world: view, body: playerBody, physics: playerPhysics, animation: playerAnimation, locomotor, inventory, scheduler, fx: worldFx,
  isPassableAtPoint: position => turfMap.isPassableAtPoint(position),
  isManualMovement: () => input.isManualMovement(), saved: initialSave.players.local.wortox,
  resetMinimapOffset: () => gameUi.minimap.setView({ x: player.position.x, z: player.position.z }),
  snapCamera: () => followCamera.snap(),
}) : undefined;
const onMapActionRequest = (event: Event) => {
  const { position } = (event as CustomEvent<MinimapActionRequestDetail>).detail;
  if (wortox?.requestMapHop(position)) event.preventDefault();
};
gameUi.minimap.addEventListener('game:map-action-request', onMapActionRequest);
const stopWortoxUpdate = registerFrontTask(() => wortox?.update());
disposalEvents.on('dispose', () => {
  gameUi.minimap.removeEventListener('game:map-action-request', onMapActionRequest);
  stopWortoxUpdate(); wortox?.dispose();
});


// health.lua pushes "death" when health reaches 0; SGwilson.lua's death state drops everything and plays the clip.
playerAnimation?.bindDeath({
  dropEverything: () => {
    handEquipmentBinding.flush();
    inventory.DropEverything();
  },
  // TheWorld.Map:IsPassableAtPoint: neither open ocean nor the void.
  isPassableAtPoint: () => turfMap.isPassableAtPoint(player.position),
});
// player_common.lua ListenForEvent("makeplayerghost", ex_fns.OnMakePlayerGhost), with the ghost art prepared beforehand.
let deathCause = 'unknown';
const ghostOwner: PlayerGhostOwner | undefined = playerAnimation && {
  model: player, animation: playerAnimation, physics: playerPhysics, stats: playerStats, sanity: playerSanity, ghostMode: playerGhostMode,
  actionPicker: view.mouseActions!,
  // SpawnDeathProduct: skeleton_player at the death point, described with the character, name and cause.
  spawnDeathProduct: position => {
    const skeleton = skeletons.spawn(SKELETON_PLAYER_ID, position);
    skeletons.setSkeletonDescription(skeleton, playerInstance.prefab, player.name, deathCause);
  },
  spawnDieFx: position => {
    worldFx.spawn('die_fx', position);
  },
  schedule: (seconds, fn) => scheduler.schedule(seconds, fn),
  addSlipperyFeet: sceneResources.addSlipperyFeet,
  removeSlipperyFeet: sceneResources.removeSlipperyFeet,
  setHidden: hidden => playerAnimation.stategraph.host.rez?.setHidden(hidden),
  setGhostLight: enabled => setGhostLight(player, enabled),
  // inventory:Equip(source): whatever the body slot holds goes back into the inventory first, as Equip swaps it out.
  equipRezSource: async source => {
    const worn = inventory.Unequip('body');
    if (worn && !inventory.GiveItem(worn)) inventory.DropItem(worn);
    return inventory.Equip((source as AmuletRezSource).entity);
  },
  // Physics:Teleport
  teleport: position => {
    tilePerfMark(`soulhop teleport to ${position.x.toFixed(1)},${position.z.toFixed(1)}`);
    player.position.set(position.x, player.position.y, position.z);
    playerPhysics.Teleport();
    playerBody.velocity.set(0, playerBody.velocity.y, 0);
  },
  setControllerEnabled: enabled => { playerInstance.controllerEnabled = enabled; },
  // inst:ShowHUD
  showHUD: show => {
    for (const element of [gameUi.statusHud, gameUi.mapControls]) element.style.visibility = show ? '' : 'hidden';
  },
};
// SGwilson.lua amulet_rebirth: consume the worn amulet, hide the HUD and put the sleepers nearby to sleep.
playerAnimation?.bindRebirth({
  consumeEquippedAmulet: () => {
    const item = inventory.GetEquippedItem('body');
    return item?.prefab === AMULET_ID && item.remove();
  },
  hasBodyItem: () => inventory.GetEquippedItem('body') !== null,
  showHUD: show => ghostOwner?.showHUD(show),
  sleepNearby: (radius, seconds) => {
    for (const inst of FindEntities(player.position, radius * WORLD_SCALE)) {
      (inst.components as { sleeper?: { GoToSleep(seconds: number): void } }).sleeper?.GoToSleep(seconds);
    }
  },
});
const makePlayerGhost = (event: { data?: unknown }) => {
  if (!ghostOwner) return;
  const data = event.data as { skeleton?: boolean; loading?: boolean } | undefined;
  OnMakePlayerGhost(ghostOwner, data);
};
player.addEventListener('makeplayerghost' as never, makePlayerGhost);
// player_common.lua ListenForEvent("respawnfromghost", ex_fns.OnRespawnFromGhost); health:SetInvincible from portal_rez's exit.
const respawnFromGhost = (event: { data?: unknown }) => { if (ghostOwner) OnRespawnFromGhost(ghostOwner, event.data as { source?: RezSource } | undefined); };
const setInvincible = (event: { data?: unknown }) => { playerStats.health.invincible = event.data === true; };
player.addEventListener('respawnfromghost' as never, respawnFromGhost);
player.addEventListener('setinvincible' as never, setInvincible);
// A saved ghost resumes as a ghost (OnLoad is_ghost → OnMakePlayerGhost({ loading = true })).
if (initialSave.players.local.ghost) makePlayerGhost({ data: { loading: true } });
const stopHealthWatch: (() => void)[] = [];
const watchedHealth = watchSignal(playerStats.health, stop => stopHealthWatch.push(stop));
// A ghost has no inventory: the bar follows the ghost-mode signal, hidden while true and shown again once false.
const watchedGhostMode = watchSignal(playerGhostMode, stop => stopHealthWatch.push(stop));
createEffect(() => { gameUi.inventoryBar.style.display = watchedGhostMode.get() ? 'none' : ''; });
createEffect(() => {
  if (watchedHealth.get() > 0) return;
  playerAnimation?.stategraph.pushEvent('death', { cause: deathCause });
});
disposalEvents.on('dispose', () => {
  stopHealthWatch.splice(0).forEach(stop => stop());
  player.removeEventListener('makeplayerghost' as never, makePlayerGhost);
  player.removeEventListener('respawnfromghost' as never, respawnFromGhost);
  player.removeEventListener('setinvincible' as never, setInvincible);
  playerAnimation?.bindDeath(undefined);
  playerAnimation?.bindRebirth(undefined);
});

let lastSavedSnapshotId = initialSave.snapshot.id;
let pendingSave = Promise.resolve();
function saveGame(): Promise<void> {
  const save = pendingSave.then(() => gameUi.savingIndicator.whileSaving(async () => {
    handEquipmentBinding.flush();
    const json = serializeSave(initialSave, {
      ...getSaveState(), playerWortox: wortox?.state.OnSave(), inventory: inventory.exportState(), playerStats: getPlayerStats(), playerGhost: playerGhostMode.peek(),
    }, SAVE_CATALOG, lastSavedSnapshotId);
    await downloadClusterSave(json, initialSave.world.prefab);
    lastSavedSnapshotId = (JSON.parse(json) as typeof initialSave).snapshot.id;
  }));
  pendingSave = save.catch(() => {});
  return save;
}
// Typing a command must not drive the character; closing releases the keyboard again.
gameUi.debugConsole.addEventListener('game:debug-console-toggle', (event) => {
  input.setBlocked((event as CustomEvent<{ isOpen: boolean }>).detail.isOpen);
});
gameUi.debugConsole.addEventListener('game:debug-command', (event) => {
  const { command } = (event as CustomEvent<DebugCommandDetail>).detail;
  void executeDebugCommand(command, inventory, (prefabId) => registry.spawn(prefabId), saveGame, setPlayerSanityPercent, async () => { await SendLightningStrike({ root: scene, fx: worldFx }, player.position); }).then((result) => {
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
    farmPlow.begin(() => inventory.extract(slot, 1, entity) ?? undefined);
    return;
  }
  if (stack?.itemId === DOCK_KIT_ID) {
    event.preventDefault();
    const entity = inventory.getEntity(slot);
    if (!entity) return;
    dockKit.begin(() => inventory.extract(slot, 1, entity) ?? undefined);
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
    inventoryReceiveEffect(gameUi, view.camera, view.renderer.domElement, player.position));
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
export const gameReady = gameUi.minimap.prepareTerrain().then(() => sceneResources.start()).then(() => {
  renderer.domElement.dataset.loaded = 'true';
  input.setBlocked(false);
}).catch(error => {
  sceneResources.dispose();
  throw error;
});
await gameReady;
