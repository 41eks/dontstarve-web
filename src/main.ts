// src/main.ts

import './style.css';
import { prefabInstance } from '@dontstarve-web/prefab/prefabInstance';
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
  type SlotSelectDetail,
  type SlotTransferRequest,
  slotTransferController,
} from '@dontstarve-web/ui';
import { type PickupDoer, PointerRaycaster, type WilsonStateName } from '@dontstarve-web/stategraphs';
import { PlayerActionFilter } from '@dontstarve-web/stategraphs/actions';
import { turfMap } from './building';
import { TILE_SIZE } from '@dontstarve-web/prefab/tile';
import { SetAutopaused } from './autopause';
import { registerFrontTask } from './animate';
import { input } from './InputManager';
import { view, actionEvents, screenProjection } from './view';
import { followCamera } from './camera';
import type { SpellCastMap } from '@dontstarve-web/stategraphs/castspell';
import { WORLD_TILES } from '@dontstarve-web/prefab/turfMap';
import { isGroundTargetBlocked, placementEntities } from '../packages/prefab/src/placementEntities';
import { backpackContainerId } from '@dontstarve-web/inventory';
import { player, playerBody, playerInstance, playerPhysics } from './player';
import { OnItemRanOut } from '@dontstarve-web/prefab/player_common';
import { bindPlayerHandEquipment } from './playerHandEquipment';
import { bindPlayerHeadEquipment } from './playerHeadEquipment';
import { bindPlayerBodyEquipment } from './playerBodyEquipment';
import { cursorUi, renderer, scene } from './universal';
import { SendLightningStrike } from '@dontstarve-web/prefab/lightning';
import { WORLD_SCALE } from '../packages/prefab/src/standardcomponents';
import { DstLightingRenderer } from './dstLighting';
import {
  buildingContainerId, isStorageBuildingId,
} from '@dontstarve-web/prefab/containers';
import { executeDebugCommand } from './debugCommands';
import { isPlaceableBuildingId } from './placeableBuilding';
import {
  createInventoryStore,
} from './inventory';
import { locomotor, startScene, worldState } from './scene';
import { WortoxPlayer, type WortoxDoer } from '../packages/prefab/src/wortoxPlayer';
import { createDisposalResources } from './registerDisposal';
import { initialSave } from './save/initialSave';
import { inventoryStateFromSave } from './save/inventoryState';
import { SAVE_CATALOG } from './save/catalog';
import { serializeSave } from './save/serialize';
import { downloadClusterSave } from './save/download';
import { inventoryReceiveEffect } from './inventoryReceive';
import { createInventorySlotItem } from './inventorySlotItem';
import { playerStats, playerGhostMode, getPlayerStats, setPlayerSanityPercent } from './playerStats';
import { loadAnimationArchive } from '@dontstarve-web/animation/animationAssets';
import { createEffect, watchSignal } from '@dontstarve-web/signals';
import type { Sanity } from '../packages/componets/src/sanity';
import { modelHasTag, setModelTag } from '@dontstarve-web/prefab/prefabInstance';

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
const stopStatsUpdates = [playerStats.health.current, playerStats.hunger.value, playerStats.sanity.value]
  .map(stat => stat.subscribe(syncPlayerStats));
syncPlayerStats();
export const inventory = createInventoryStore();
const inventorySlotItem = createInventorySlotItem(inventory);
export const handEquipment = inventory.handEquipment;
export const headEquipment = inventory.headEquipment;
export const bodyEquipment = inventory.bodyEquipment;
for (const panel of [gameUi.chestPanel, gameUi.cookPotPanel, gameUi.iceBoxPanel]) {
  panel.addEventListener('game:chest-close', (event) => {
    const { containerId } = (event as CustomEvent<ChestCloseDetail>).detail;
    inventory.setStorageAccessible(containerId, false);
  });
}
const playerAnimation = playerInstance.animationController;
/** inst:PushEvent reaches SGwilson's handlers; these are the ones the player's own components and actions push. */
const STATEGRAPH_EVENTS = new Set(['toolbroke', 'fishingnibble', 'fishingloserod', 'fishingstrain', 'fishingcatch', 'fishingcancel']);
const pickupDoer: PickupDoer & WortoxDoer & { sg: NonNullable<PickupDoer['sg']> & { beginPortalJump(pos: import('three').Vector3, fromMap?: boolean): boolean }; ListenForEvent(name: string, listener: (data: unknown) => void): () => void; HasStateTag(tag: string): boolean; GoToState(name: string): void; IsCurrentState(name: string): boolean;
  components: PickupDoer['components'] & { health: typeof playerStats.health; hunger: typeof playerStats.hunger; sanity?: Sanity } } = {
  // The player's own eater.lua component, which ACTIONS.EAT reaches on act.doer.
  components: { inventory, health: playerStats.health, hunger: playerStats.hunger, eater: playerInstance.components.eater },
  ListenForEvent: (name, listener) => playerInstance.ListenForEvent(name, listener),
  hasTag: tag => tag === 'player' || modelHasTag(player, tag),
  addTag: tag => setModelTag(player, tag, true),
  removeTag: tag => setModelTag(player, tag, false),
  GetPosition: () => player.position,
  getPosition: () => player.position,
  position: player.position,
  get SoundEmitter() { return playerInstance.SoundEmitter; },
  sg: {
    HasStateTag: tag => playerAnimation?.stategraph.hasStateTag(tag) ?? false,
    // SGwilson portal_jumpin_pre for ACTIONS.BLINK / BLINK_MAP.
    beginPortalJump: (pos, fromMap) => playerAnimation?.stategraph.beginPortalJump(pos, fromMap) ?? false,
  },
  HasStateTag: tag => playerAnimation?.stategraph.hasStateTag(tag) ?? false,
  GoToState: name => playerAnimation?.stategraph.goToState(name as WilsonStateName),
  IsCurrentState: name => playerAnimation?.stategraph.stateName === name,
  PushEvent: (name, data) => {
    // player_common.lua listens for itemranout; SGwilson.lua handles toolbroke and the fishing rod's events.
    if (STATEGRAPH_EVENTS.has(name)) playerAnimation?.stategraph.pushEvent(name, data);
    else if (name === 'itemranout') OnItemRanOut(inventory, data);
    playerInstance.PushEvent(name, data);
  },
};
inventory.bindActor(pickupDoer);
const playerSanity = playerStats.sanity;
pickupDoer.components.sanity = playerSanity;
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
    spawnPrefab: (prefab, position) => { registry.SpawnPrefab(prefab, position.clone()); },
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
  // pitchfork.lua terraformer / farm_hoe.lua farmtiller work TheWorld.Map.
  terraformMap: turfMap,
  farmTillMap: { canTill: point => sceneResources.farmPlow.canTill(point), till: point => sceneResources.farmPlow.till(point) },
  reskinEffects: { prepare: toolSkinId => sceneResources.reskinEffects.prepare(toolSkinId) },
  // fishingrod.lua / pond.lua: the held rod fishes on game time and lands its fish as a ground item.
  fishingWorld: {
    scheduler: worldState.scheduler,
    componentUpdates: worldState.componentUpdates,
    landFish: (fish, position) => {
      groundItems.flingLoot([{ ...inventory.getItemSpec(fish.prefab), itemId: fish.prefab, count: 1 }], position);
    },
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
      gameUi.backpackPanel.open({ containerId, slotCount: container.numslots, title: '背包' });
      gameUi.backpackPanel.bindContainer(container.slots, inventorySlotItem);
    }
  },
});

// Restore only after subscribing: committed signal writes drive all equipment.
handEquipmentBinding.withoutTransitions(() => inventory.replaceState(inventoryStateFromSave(initialSave), INVENTORY_RECIPES));


function syncCraftingInventory(): void {
  gameUi.crafting.setMaterialSummary(inventory.materialSummary());
  gameUi.crafting.setBufferedRecipes(inventory.buffered());
}

// The inventory bar follows inventory.lua's slots as container panels follow their containers.
gameUi.inventoryBar.bindInventory(inventory, inventorySlotItem);
syncCraftingInventory();
// Material counts and buffered builds change with transactions and stack consumption.
inventory.subscribe(syncCraftingInventory);

const disposalResources = createDisposalResources({
  gameUi, view, screenProjection, inventory, playerAnimation, locomotor, pickupDoer, handEquipmentBinding,
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
const { scheduler, buildingPlacement, groundItems, worldFx, staffProjectiles, registry, getSaveState, disposalEvents } = sceneResources;
gameUi.minimap.bind({ terrain: turfMap, cellSize: TILE_SIZE, getPlayerPosition: () => player.position, cameraHeading: view.cameraHeading });
const sanityVignette = await SanityVignette.create(playerSanity.sane, animRoot);
document.body.append(sanityVignette.canvas);
const stopVignetteUpdate = registerFrontTask(dt => sanityVignette.update(dt));
disposalEvents.on('dispose', () => {
  gameUi.minimap.dispose();
  stopStatsUpdates.forEach(stop => stop());
  headEquipmentBinding.dispose();
  bodyEquipmentBinding.dispose();
  stopVignetteUpdate();
  sanityVignette.dispose();
});
disposalResources.register(disposalEvents, sceneResources);
const wortox = playerAnimation ? await WortoxPlayer.create({
  world: view, body: playerBody, physics: playerPhysics, animation: playerAnimation, doer: pickupDoer, inventory, scheduler, fx: worldFx,
  isPassableAtPoint: position => turfMap.isPassableAtPoint(position),
  saved: initialSave.players.local.wortox,
  resetMinimapOffset: () => gameUi.minimap.setView({ x: player.position.x, z: player.position.z }),
  snapCamera: () => followCamera.snap(),
}) : undefined;
const onMapActionRequest = (event: Event) => {
  const { position } = (event as CustomEvent<MinimapActionRequestDetail>).detail;
  // MapScreen right click: ThePlayer.components.playercontroller:OnMapAction.
  if (playerInstance.components.playercontroller?.OnMapAction(position)) event.preventDefault();
};
gameUi.minimap.addEventListener('game:map-action-request', onMapActionRequest);
disposalEvents.on('dispose', () => {
  gameUi.minimap.removeEventListener('game:map-action-request', onMapActionRequest);
  wortox?.dispose();
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
// player_common.lua OnSetOwner: PlayerActionFilter at the bottom of the stack (ACTION_FILTER_PRIORITIES.default);
// the ghost's filter is pushed above it while dead.
view.mouseActions?.PushActionFilter(PlayerActionFilter, -99);
// The input's picker is the player's playeractionpicker; inst.HUD is the status and map controls.
if (view.mouseActions) playerInstance.components.playeractionpicker = view.mouseActions;
playerInstance.HUD = {
  Show: () => { for (const element of [gameUi.statusHud, gameUi.mapControls]) element.style.visibility = ''; },
  Hide: () => { for (const element of [gameUi.statusHud, gameUi.mapControls]) element.style.visibility = 'hidden'; },
};
playerAnimation?.bindSpawnPrefab((prefab, position) => registry.SpawnPrefab(prefab, position));
// A saved ghost resumes as a ghost (OnLoad is_ghost → OnMakePlayerGhost({ loading = true })).
if (initialSave.players.local.ghost) playerInstance.PushEvent('makeplayerghost', { loading: true });
const stopGhostWatch: (() => void)[] = [];
// A ghost has no inventory: the bar follows the ghost-mode signal, hidden while true and shown again once false.
const watchedGhostMode = watchSignal(playerGhostMode, stop => stopGhostWatch.push(stop));
createEffect(() => { gameUi.inventoryBar.style.display = watchedGhostMode.get() ? 'none' : ''; });
// A saved living player at zero health resumes the death flow after inventory and death handlers are bound.
if (playerStats.health.IsDead() && !playerGhostMode.peek()) playerInstance.PushEvent('death', { cause: playerInstance.deathcause });
disposalEvents.on('dispose', () => {
  stopGhostWatch.splice(0).forEach(stop => stop());
  playerAnimation?.bindDeath(undefined);
  playerAnimation?.bindSpawnPrefab(undefined);
  delete playerInstance.HUD;
  if (playerInstance.components.playeractionpicker === view.mouseActions) delete playerInstance.components.playeractionpicker;
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
window.addEventListener('game:slot-select', (event) => {
  const { slot } = (event as CustomEvent<SlotSelectDetail>).detail;
  if (inventory.GetActiveItem()) return;
  actionEvents.emit('action:interrupt', { reason: 'slot-select' });
  const stack = inventory.get(slot);
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
    inventoryReceiveEffect(gameUi, screenProjection.GetScreenPos(player.position)));
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
