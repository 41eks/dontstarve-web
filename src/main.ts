// src/main.ts
import { FIRE_PROJECTILE_ID, LaunchProjectile } from '@dontstarve-web/prefab/staff_projectile';

import './style.css';
import { prefabInstance } from '@dontstarve-web/prefab/prefabInstance';
import {
  INVENTORY_RECIPES,
  equipmentSlotAddress,
  mountGameUi,
  SanityVignette,
  type GameUiEventMap,
  slotTransferController,
} from '@dontstarve-web/ui';
import { PointerRaycaster } from '@dontstarve-web/stategraphs';
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
import { setCrafting } from '@dontstarve-web/prefab/player_common';
import { createEquipmentViews } from '@dontstarve-web/prefab/equipmentVisual';
import { getHandEquipmentDefinition, type HandEquipmentWorld } from '@dontstarve-web/prefab/handEquipment';
import { cursorUi, renderer, scene } from './universal';
import { SendLightningStrike } from '@dontstarve-web/prefab/lightning';
import { isWorldFx } from '@dontstarve-web/prefab/world_fx';
import { WORLD_SCALE } from '../packages/prefab/src/standardcomponents';
import { DstLightingRenderer } from './dstLighting';
import {
  buildingContainerId, isStorageBuildingId,
} from '@dontstarve-web/prefab/containers';
import { executeDebugCommand } from './debugCommands';
import { createScreenFade } from './screenFade';
import { itemWorld } from './prefabWorld';
import { isPlaceableBuildingId } from './placeableBuilding';
import {
  createInventoryStore,
} from './inventory';
import { locomotor, startScene, worldState } from './scene';
import { WortoxPlayer } from '../packages/prefab/src/wortoxPlayer';
import { createDisposalResources } from './registerDisposal';
import { initialSave } from './save/initialSave';
import { SAVE_CATALOG } from './save/catalog';
import { serializeSave } from './save/serialize';
import { downloadClusterSave } from './save/download';
import { inventoryReceiveEffect } from './inventoryReceive';
import { createInventorySlotItem } from './inventorySlotItem';
import { playerStats, playerGhostMode, getPlayerStats, setPlayerSanityPercent } from './playerStats';
import { loadAnimationArchive } from '@dontstarve-web/animation/animationAssets';
import { createEffect, createRenderEffect, watchSignal } from '@dontstarve-web/signals';
import { loadSavedInventory } from './save/inventoryState';

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
  gameUi.minimap.setOpen(event.detail.isOpen);
});
// MapScreen registers SetAutopaused(true) on open and releases it on destroy; M/Esc close it too.
let mapAutopaused = false;
gameUi.minimap.addEventListener('game:map-state', (event) => {
  const { isOpen, autopaused } = event.detail;
  gameUi.mapControls.setMapOpen(isOpen);
  cursorUi.setWorldCovered(isOpen);
  input.setBlocked(isOpen);
  if (autopaused !== mapAutopaused) {
    SetAutopaused(autopaused);
    mapAutopaused = autopaused;
  }
});
const stopStatsUpdates: (() => void)[] = [];
const watchedStats = [playerStats.health.current, playerStats.hunger.value, playerStats.sanity.value]
  .map(stat => watchSignal<unknown>(stat, stop => stopStatsUpdates.push(stop)));
createRenderEffect(() => {
  watchedStats.forEach(stat => stat.get());
  gameUi.statusHud.setStats(getPlayerStats());
});
export const inventory = createInventoryStore(itemWorld);
const inventorySlotItem = createInventorySlotItem(inventory);
export const handEquipment = inventory.handEquipment;
export const headEquipment = inventory.headEquipment;
export const bodyEquipment = inventory.bodyEquipment;
for (const panel of [gameUi.chestPanel, gameUi.cookPotPanel, gameUi.iceBoxPanel]) {
  panel.addEventListener('game:chest-close', (event) => {
    const { containerId } = event.detail;
    inventory.setStorageAccessible(containerId, false);
  });
}
// The player inst is the inventory's owner and every action's doer.
playerInstance.components.inventory = inventory;
inventory.bindActor(playerInstance);
const playerSanity = playerStats.sanity;
const handPointer = view.mouseActions?.pointer ?? new PointerRaycaster(view);
const bodySlotAddress = equipmentSlotAddress('body');


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

// TheWorld's services the equipped items' callbacks read: maps, spawns, fx and the fishing world.
inventory.entities.bindEquipmentWorld({
  lightStaffWorld: {
    map: spellCastMap,
    spawnPrefab: (prefab, position) => { registry.SpawnPrefab(prefab, position.clone()); },
  },
  greenStaffWorld: {
    spawnLoot: (items, position) => groundItems.flingLoot(items.map(({ itemId, count }) => ({ ...inventory.getItemSpec(itemId), itemId, count })), position),
  },
  fireStaffWorld: {
    launch: (owner, target, attacker) => LaunchProjectile((prefab, position) => registry.SpawnPrefab(prefab, position), FIRE_PROJECTILE_ID, owner, target, attacker),
    createFuel: () => inventory.entities.create({ itemId: 'cutgrass', count: 1 }),
  },
  // blinkstaff.lua: TheWorld.Map and SpawnPrefab of its sand puffs.
  blinkStaffWorld: {
    map: {
      // Map:IsAboveGroundAtPoint without allow_water: a land tile.
      isAboveGroundAtPoint: point => turfMap.isPassableAtPoint(point),
      isPassableAtPoint: point => turfMap.isPassableAtPoint(point),
      isGroundTargetBlocked: point => isGroundTargetBlocked(groundTargetBlockers, point, .5 * WORLD_SCALE),
    },
    spawnFx: (prefab, position) => { if (isWorldFx(prefab)) worldFx.spawn(prefab, position); },
  },
  // staff.lua telestaff: TheWorld's cave tag, topology nodes, map, lightning and moisture.
  teleStaffWorld: {
    isCave: initialSave.world.prefab === 'cave',
    topologyNodes: initialSave.world.map.topology?.nodes ?? [],
    isPassableAtPoint: point => turfMap.isPassableAtPoint(point),
    sendLightningStrike: position => { SendLightningStrike({ root: scene, fx: worldFx, sim: prefabs }, position); },
    deltaMoisture: delta => worldState.weather.DeltaMoisture(delta),
  },
  tridentWorld: {
    map: spellCastMap,
    spawnWaterspout: position => worldFx.spawn('crab_king_waterspout', position),
  },
  // pitchfork.lua terraformer / farm_hoe.lua farmtiller work TheWorld.Map.
  terraformMap: turfMap,
  farmTillMap: { canTill: point => sceneResources.farmMap.canTill(point), till: point => sceneResources.farmMap.till(point) },
  reskinEffects: { prepare: toolSkinId => sceneResources.reskinEffects.prepare(toolSkinId) },
  // fishingrod.lua / pond.lua: the held rod fishes on game time and lands its fish as a ground item.
  fishingWorld: {
    scheduler: worldState.scheduler,
    componentUpdates: worldState.componentUpdates,
    landFish: (fish, position) => {
      groundItems.flingLoot([{ ...inventory.getItemSpec(fish.prefab), itemId: fish.prefab, count: 1 }], position);
    },
  },
} satisfies HandEquipmentWorld);
// equippable:Equip(owner): each equipped inst draws on its own slot of the player's sprite.
playerInstance.OpenEquipmentView = createEquipmentViews(playerInstance, playerInstance.equipmentPresentation);
// The cursor shows the held item's action; the backpack panel follows the worn backpack.
inventory.handEquipment.subscribe(equipment => {
  cursorUi.setHandAction((equipment && getHandEquipmentDefinition(equipment.itemId)?.definition.handAction) ?? null, handPointer);
});
inventory.bodyEquipment.subscribe(equipment => {
  const containerId = equipment?.itemId === 'backpack' && equipment.entity ? backpackContainerId(equipment.entity.id) : undefined;
  if (gameUi.backpackPanel.slotContainer?.id !== containerId) gameUi.backpackPanel.close();
  if (containerId && !gameUi.backpackPanel.slotContainer) {
    const container = inventory.getEntity(bodySlotAddress)?.components.container;
    if (!container) return;
    gameUi.backpackPanel.open({ containerId, slotCount: container.numslots, title: '背包' });
    gameUi.backpackPanel.bindContainer(container.slots, inventorySlotItem);
  }
});


// The inventory bar follows inventory.lua's slots as container panels follow their containers.
gameUi.inventoryBar.bindInventory(inventory, inventorySlotItem);
// Material counts and buffered builds change with transactions and stack consumption.
createRenderEffect(() => {
  inventory.revision.get();
  gameUi.crafting.setMaterialSummary(inventory.materialSummary());
  gameUi.crafting.setBufferedRecipes(inventory.buffered());
});

const disposalResources = createDisposalResources({
  gameUi, view, screenProjection, inventory, playerEntity: playerInstance, locomotor,
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
  inventory,
);
const { buildingPlacement, groundItems, worldFx, registry, prefabs, getSaveState, disposalEvents } = sceneResources;
// The player's saved items are SpawnPrefab'd into the world the scene has just registered the item prefabs in; the
// subscriptions above equip the restored items as their slots commit.
loadSavedInventory(inventory, initialSave, INVENTORY_RECIPES);
gameUi.minimap.bind({ terrain: turfMap, cellSize: TILE_SIZE, getPlayerPosition: () => player.position, cameraHeading: view.cameraHeading });
const sanityVignette = await SanityVignette.create(playerSanity.sane, animRoot);
document.body.append(sanityVignette.canvas);
const stopVignetteUpdate = registerFrontTask(dt => sanityVignette.update(dt));
disposalEvents.on('dispose', () => {
  gameUi.minimap.dispose();
  stopStatsUpdates.forEach(stop => stop());
  stopVignetteUpdate();
  sanityVignette.dispose();
});
disposalResources.register(disposalEvents, sceneResources);
const wortox = await WortoxPlayer.create({
  world: view, body: playerBody, physics: playerPhysics, fx: worldFx,
  isPassableAtPoint: position => turfMap.isPassableAtPoint(position),
  saved: initialSave.players.local.wortox,
  resetMinimapOffset: () => gameUi.minimap.setView({ x: player.position.x, z: player.position.z }),
  snapCamera: () => followCamera.snap(),
});
const onMapActionRequest = (event: GameUiEventMap['game:map-action-request']) => {
  const { position } = event.detail;
  // MapScreen right click: ThePlayer.components.playercontroller:OnMapAction.
  if (playerInstance.components.playercontroller?.OnMapAction(position)) event.preventDefault();
};
gameUi.minimap.addEventListener('game:map-action-request', onMapActionRequest);
disposalEvents.on('dispose', () => {
  gameUi.minimap.removeEventListener('game:map-action-request', onMapActionRequest);
  wortox.dispose();
});


// health.lua pushes "death" when health reaches 0; SGwilson.lua's death state drops everything and plays the clip.
playerInstance.deathHost = {
  dropEverything: () => {
    inventory.DropEverything();
  },
  // TheWorld.Map:IsPassableAtPoint: neither open ocean nor the void.
  isPassableAtPoint: () => turfMap.isPassableAtPoint(player.position),
};
// player_common.lua OnSetOwner: PlayerActionFilter at the bottom of the stack (ACTION_FILTER_PRIORITIES.default);
// the ghost's filter is pushed above it while dead.
view.mouseActions?.PushActionFilter(PlayerActionFilter, -99);
// The input's picker is the player's playeractionpicker; inst.HUD is the status and map controls.
if (view.mouseActions) playerInstance.components.playeractionpicker = view.mouseActions;
playerInstance.HUD = {
  Show: () => { for (const element of [gameUi.statusHud, gameUi.mapControls]) element.style.visibility = ''; },
  Hide: () => { for (const element of [gameUi.statusHud, gameUi.mapControls]) element.style.visibility = 'hidden'; },
  // inventory:Hide() / Show() while asleep.
  controls: {
    HideCraftingAndInventory: () => { gameUi.inventoryBar.style.visibility = 'hidden'; },
    ShowCraftingAndInventory: () => { gameUi.inventoryBar.style.visibility = ''; },
  },
};
playerInstance.SpawnPrefab = (prefab, position) => registry.SpawnPrefab(prefab, position);
// player_classified's fade and the camera follow the player inst.
const screenFade = createScreenFade();
playerInstance.ScreenFade = (isfadein, time) => screenFade.fade(isfadein, time);
playerInstance.SnapCamera = () => followCamera.snap();
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
  playerInstance.deathHost = undefined;
  playerInstance.SpawnPrefab = undefined;
  playerInstance.ScreenFade = undefined;
  playerInstance.SnapCamera = undefined;
  screenFade.dispose();
  delete playerInstance.HUD;
  if (playerInstance.components.playeractionpicker === view.mouseActions) delete playerInstance.components.playeractionpicker;
});

let lastSavedSnapshotId = initialSave.snapshot.id;
let pendingSave = Promise.resolve();
function saveGame(): Promise<void> {
  const save = pendingSave.then(() => gameUi.savingIndicator.whileSaving(async () => {
    const json = serializeSave(initialSave, {
      ...getSaveState(), playerWortox: playerInstance.wortox?.OnSave(), inventory: inventory.exportSaved(), playerStats: getPlayerStats(), playerGhost: playerGhostMode.peek(),
    }, SAVE_CATALOG, lastSavedSnapshotId);
    lastSavedSnapshotId = (await downloadClusterSave(json, initialSave.world.prefab)).snapshot.id;
  }));
  pendingSave = save.catch(() => {});
  return save;
}
// Typing a command must not drive the character; closing releases the keyboard again.
gameUi.debugConsole.addEventListener('game:debug-console-toggle', (event) => {
  input.setBlocked(event.detail.isOpen);
});
gameUi.debugConsole.addEventListener('game:debug-command', (event) => {
  const { command } = event.detail;
  void executeDebugCommand(command, inventory, (prefabId) => registry.spawn(prefabId), saveGame, setPlayerSanityPercent, async () => { await SendLightningStrike({ root: scene, fx: worldFx, sim: prefabs }, player.position); }).then((result) => {
    if (result.ok) console.info(result.message);
    else console.warn(result.message);
  }).catch((error: unknown) => {
    console.error(`Unable to execute debug command: ${command}`, error);
  });
});

window.addEventListener('game:slot-transfer-request', (event) => {
  const detail = event.detail;
  if (!Number.isSafeInteger(detail.amount) || detail.amount <= 0) return;

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
  const { origin } = event.detail;
  inventory.returnCursor(origin);
});
window.addEventListener('game:slot-select', (event) => {
  const { slot } = event.detail;
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
  const { recipeId, skinId } = event.detail;
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
  const { crafting } = event.detail;
  if (crafting) actionEvents.emit('action:interrupt', { reason: 'crafting' });
  setCrafting(playerInstance, crafting);
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
