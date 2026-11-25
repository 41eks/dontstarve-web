// src/main.ts
import { FIRE_PROJECTILE_ID, ICE_PROJECTILE_ID, LaunchProjectile } from '@dontstarve-web/prefab/staff_projectile';

import './style.css';
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
import { IsGroundTargetBlocked } from '../packages/prefab/src/mapEntities';
import { backpackContainerId } from '@dontstarve-web/inventory';
import { player, playerBody, playerInstance, playerPhysics } from './player';
import { playBuild } from '@dontstarve-web/prefab/player_common';
import { createEquipmentViews } from '@dontstarve-web/prefab/equipmentVisual';
import { getHandEquipmentDefinition, type HandEquipmentWorld } from '@dontstarve-web/prefab/handEquipment';
import { cursorUi, renderer, scene } from './universal';
import { SendLightningStrike } from '@dontstarve-web/prefab/lightning';
import { isWorldFx } from '@dontstarve-web/prefab/world_fx';
import { WORLD_SCALE } from '../packages/prefab/src/standardcomponents';
import { DstLightingRenderer } from '@dontstarve-web/display';
import { executeDebugCommand } from './debugCommands';
import { createScreenFade } from './screenFade';
import { itemWorld } from './prefabWorld';
import { isManagedBuildingId } from './placeableBuilding';
import { createInventoryStore } from './inventory';
import { locomotor, startScene, worldState } from './scene';
import { WortoxPlayer } from '../packages/prefab/src/wortoxPlayer';
import { createApplicationBindings } from './applicationBindings';
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
const lightingReady = DstLightingRenderer.create(renderer, `${import.meta.env.BASE_URL}dst/data/images/colour_cubes`, {
  sanityPercent: playerStats.sanity.percent,
  lunacyMode: playerStats.sanity.lunacyMode,
  // player_classified pushes isghostmode into playervision:SetGhostVision.
  ghostVision: playerGhostMode,
});
input.setBlocked(true);

const gameUi = mountGameUi({ assetBaseUrl: `${import.meta.env.BASE_URL}dst/data/ui/` });
gameUi.inventoryBar.player = playerInstance.prefab;
gameUi.mapControls.addEventListener('game:map-toggle', event => {
  gameUi.minimap.setOpen(event.detail.isOpen);
});
// MapScreen registers SetAutopaused(true) on open and releases it on destroy; M/Esc close it too.
let mapAutopaused = false;
gameUi.minimap.addEventListener('game:map-state', event => {
  const { isOpen, autopaused } = event.detail;
  gameUi.mapControls.setMapOpen(isOpen);
  cursorUi.setWorldCovered(isOpen);
  input.setBlocked(isOpen);
  if (autopaused !== mapAutopaused) {
    SetAutopaused(autopaused);
    mapAutopaused = autopaused;
  }
});
// StatusDisplays listens to the player's stat delta events; statusHud.dispose() removes the listeners.
gameUi.statusHud.setOwner(playerInstance);
export const inventory = createInventoryStore(itemWorld);
const inventorySlotItem = createInventorySlotItem(inventory);
export const handEquipment = inventory.handEquipment;
export const headEquipment = inventory.headEquipment;
export const bodyEquipment = inventory.bodyEquipment;
// The player inst is the inventory's owner and every action's doer.
playerInstance.components.inventory = inventory;
inventory.bindActor(playerInstance);
const playerSanity = playerStats.sanity;
const handPointer = view.mouseActions?.pointer ?? new PointerRaycaster(view);
const bodySlotAddress = equipmentSlotAddress('body');

window.addEventListener('contextmenu', event => {
  event.preventDefault();
});

const spellCastMap: SpellCastMap = {
  isAboveGroundAtPoint: point => turfMap.getTileAtWorld(point) !== WORLD_TILES.INVALID,
  isOceanAtPoint: point => turfMap.isOceanAtPoint(point),
  isGroundTargetBlocked: point => IsGroundTargetBlocked(prefabs, point, 0.5 * WORLD_SCALE),
};

// TheWorld's services the equipped items' callbacks read: maps, spawns, fx and the fishing world.
inventory.entities.bindEquipmentWorld({
  lightStaffWorld: {
    map: spellCastMap,
    spawnPrefab: (prefab, position) => {
      registry.SpawnPrefab(prefab, position.clone());
    },
  },
  greenStaffWorld: {
    spawnLoot: (items, position) =>
      groundItems.flingLoot(
        items.map(({ itemId, count }) => ({ ...inventory.getItemSpec(itemId), itemId, count })),
        position,
      ),
  },
  fireStaffWorld: {
    launch: (owner, target, attacker) =>
      LaunchProjectile(
        (prefab, position) => registry.SpawnPrefab(prefab, position),
        FIRE_PROJECTILE_ID,
        owner,
        target,
        attacker,
      ),
    createFuel: () => inventory.entities.create({ itemId: 'cutgrass', count: 1 }),
  },
  iceStaffWorld: {
    launch: (owner, target, attacker) =>
      LaunchProjectile(
        (prefab, position) => registry.SpawnPrefab(prefab, position),
        ICE_PROJECTILE_ID,
        owner,
        target,
        attacker,
      ),
  },
  // blinkstaff.lua: TheWorld.Map and SpawnPrefab of its sand puffs.
  blinkStaffWorld: {
    map: {
      // Map:IsAboveGroundAtPoint without allow_water: a land tile.
      isAboveGroundAtPoint: point => turfMap.isLandTileAtPoint(point),
      isPassableAtPoint: point => turfMap.isPassableAtPoint(point),
      isGroundTargetBlocked: point => IsGroundTargetBlocked(prefabs, point, 0.5 * WORLD_SCALE),
    },
    spawnFx: (prefab, position) => {
      if (isWorldFx(prefab)) {
        worldFx.spawn(prefab, position);
      }
    },
  },
  // staff.lua telestaff: TheWorld's cave tag, topology nodes, map, lightning and moisture.
  teleStaffWorld: {
    isCave: initialSave.world.prefab === 'cave',
    topologyNodes: initialSave.world.map.topology?.nodes ?? [],
    isPassableAtPoint: point => turfMap.isPassableAtPoint(point),
    sendLightningStrike: position => {
      SendLightningStrike({ root: scene, fx: worldFx, sim: prefabs }, position);
    },
    deltaMoisture: delta => worldState.weather.DeltaMoisture(delta),
  },
  tridentWorld: {
    map: spellCastMap,
    spawnWaterspout: position => worldFx.spawn('crab_king_waterspout', position),
  },
  // pitchfork.lua terraformer / farm_hoe.lua farmtiller work TheWorld.Map.
  terraformMap: turfMap,
  farmTillMap: {
    canTill: point => sceneResources.farmMap.canTill(point),
    till: point => sceneResources.farmMap.till(point),
  },
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
  cursorUi.setHandAction(
    (equipment && getHandEquipmentDefinition(equipment.itemId)?.definition.handAction) ?? null,
    handPointer,
  );
});
inventory.bodyEquipment.subscribe(equipment => {
  const containerId =
    equipment?.itemId === 'backpack' && equipment.entity ? backpackContainerId(equipment.entity.id) : undefined;
  if (gameUi.backpackPanel.slotContainer?.id !== containerId) {
    gameUi.backpackPanel.close();
  }
  if (containerId && !gameUi.backpackPanel.slotContainer) {
    const container = inventory.getEntity(bodySlotAddress)?.components.container;
    if (!container) {
      return;
    }
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

const applicationBindings = createApplicationBindings({
  gameUi,
  view,
  screenProjection,
  inventory,
  playerEntity: playerInstance,
  locomotor,
  inventorySlotItem,
  actionEvents,
  isActionInterrupting: input.isActionInterrupting,
  updateCursor: () => cursorUi.update(),
  getWatchWorldContent: worldState.getWatchWorldContent,
  turfMap,
});
const sceneResources = await lightingReady
  .then(lighting => {
    window.dispatchEvent(new CustomEvent('game:lighting-ready', { detail: lighting }));
    return startScene(applicationBindings.onContainerInteraction, inventory);
  })
  .catch(error => {
    applicationBindings.dispose();
    throw error;
  });
const { buildingPlacement, groundItems, worldFx, registry, prefabs, getSaveState, disposalEvents } = sceneResources;
let stopVignette: (() => void) | undefined;
disposalEvents.on('dispose', () => {
  gameUi.minimap.dispose();
  stopVignette?.();
});
let wortox: WortoxPlayer;
try {
  // The scene has registered the item prefabs. Equip restored items as their slots commit.
  loadSavedInventory(inventory, initialSave, INVENTORY_RECIPES);
  gameUi.minimap.bind({
    terrain: turfMap,
    cellSize: TILE_SIZE,
    getPlayerPosition: () => player.position,
    cameraHeading: view.cameraHeading,
  });
  const sanityVignette = await SanityVignette.create(playerSanity.insane, animRoot);
  const stopVignetteUpdate = registerFrontTask(dt => sanityVignette.update(dt));
  stopVignette = () => {
    stopVignetteUpdate();
    sanityVignette.dispose();
  };
  document.body.append(sanityVignette.canvas);
  applicationBindings.bindScene(sceneResources);
  wortox = await WortoxPlayer.create({
    world: view,
    body: playerBody,
    physics: playerPhysics,
    fx: worldFx,
    isPassableAtPoint: position => turfMap.isPassableAtPoint(position),
    saved: initialSave.players.local.wortox,
    resetMinimapOffset: () => gameUi.minimap.setView({ x: player.position.x, z: player.position.z }),
    snapCamera: () => followCamera.snap(),
  });
} catch (error) {
  try {
    sceneResources.dispose();
  } finally {
    applicationBindings.dispose();
  }
  throw error;
}
const onMapActionRequest = (event: GameUiEventMap['game:map-action-request']) => {
  const { position } = event.detail;
  // MapScreen right click: ThePlayer.components.playercontroller:OnMapAction.
  if (playerInstance.components.playercontroller?.OnMapAction(position)) {
    event.preventDefault();
  }
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
if (view.mouseActions) {
  playerInstance.components.playeractionpicker = view.mouseActions;
}
playerInstance.HUD = {
  Show: () => {
    for (const element of [gameUi.statusHud, gameUi.mapControls]) {
      element.style.visibility = '';
    }
  },
  Hide: () => {
    for (const element of [gameUi.statusHud, gameUi.mapControls]) {
      element.style.visibility = 'hidden';
    }
  },
  // inventory:Hide() / Show() while asleep.
  controls: {
    HideCraftingAndInventory: () => {
      gameUi.inventoryBar.style.visibility = 'hidden';
    },
    ShowCraftingAndInventory: () => {
      gameUi.inventoryBar.style.visibility = '';
    },
  },
};
playerInstance.SpawnPrefab = (prefab, position) => registry.SpawnPrefab(prefab, position);
// player_classified's fade and the camera follow the player inst.
const screenFade = createScreenFade();
playerInstance.ScreenFade = (isfadein, time) => screenFade.fade(isfadein, time);
playerInstance.SnapCamera = () => followCamera.snap();
// A saved ghost resumes as a ghost (OnLoad is_ghost → OnMakePlayerGhost({ loading = true })).
if (initialSave.players.local.ghost) {
  playerInstance.PushEvent('makeplayerghost', { loading: true });
}
const stopGhostWatch: (() => void)[] = [];
// A ghost has no inventory: the bar follows the ghost-mode signal, hidden while true and shown again once false.
const watchedGhostMode = watchSignal(playerGhostMode, stop => stopGhostWatch.push(stop));
createEffect(() => {
  gameUi.inventoryBar.style.display = watchedGhostMode.get() ? 'none' : '';
});
// A saved living player at zero health resumes the death flow after inventory and death handlers are bound.
if (playerStats.health.IsDead() && !playerGhostMode.peek()) {
  playerInstance.PushEvent('death', { cause: playerInstance.deathcause });
}
disposalEvents.on('dispose', () => {
  stopGhostWatch.splice(0).forEach(stop => stop());
  playerInstance.deathHost = undefined;
  playerInstance.SpawnPrefab = undefined;
  playerInstance.ScreenFade = undefined;
  playerInstance.SnapCamera = undefined;
  screenFade.dispose();
  delete playerInstance.HUD;
  if (playerInstance.components.playeractionpicker === view.mouseActions) {
    delete playerInstance.components.playeractionpicker;
  }
});

let lastSavedSnapshotId = initialSave.snapshot.id;
let pendingSave = Promise.resolve();
function saveGame(): Promise<void> {
  const save = pendingSave.then(() =>
    gameUi.savingIndicator.whileSaving(async () => {
      const json = serializeSave(
        initialSave,
        {
          ...getSaveState(),
          playerWortox: playerInstance.wortox?.OnSave(),
          inventory: inventory.exportSaved(),
          playerStats: getPlayerStats(),
          playerGhost: playerGhostMode.peek(),
        },
        SAVE_CATALOG,
        lastSavedSnapshotId,
      );
      lastSavedSnapshotId = (await downloadClusterSave(json, initialSave.world.prefab)).snapshot.id;
    }),
  );
  pendingSave = save.catch(() => {});
  return save;
}
// Typing a command must not drive the character; closing releases the keyboard again.
gameUi.debugConsole.addEventListener('game:debug-console-toggle', event => {
  input.setBlocked(event.detail.isOpen);
});
/** ThePlayer.Transform:SetPosition: stop walking, move the foot and body together, and snap the camera. */
function teleportPlayerTo(x: number, z: number): void {
  locomotor.stop();
  playerInstance.setPosition(x, 0, z);
  playerPhysics.Teleport();
  playerBody.velocity.set(0, playerBody.velocity.y, 0);
  playerInstance.tileTracker.sync();
  playerInstance.SnapCamera?.();
}

/** c_findnext: the next live instance of the prefab, cycling in insertion order and skipping the player. */
let lastGonext: { prefabId: string; entityId: string } | undefined;
function findNextEntity(prefabId: string): { x: number; z: number } | undefined {
  const matches = [...prefabs.instances(prefabId)].filter(instance => instance !== playerInstance);
  if (!matches.length) {
    return undefined;
  }
  let index = 0;
  if (lastGonext?.prefabId === prefabId) {
    const previous = matches.findIndex(instance => String(instance.entityId) === lastGonext!.entityId);
    if (previous >= 0) {
      index = (previous + 1) % matches.length;
    }
  }
  const instance = matches[index]!;
  lastGonext = { prefabId, entityId: String(instance.entityId) };
  return { x: instance.position.x, z: instance.position.z };
}

gameUi.debugConsole.addEventListener('game:debug-command', event => {
  const { command } = event.detail;
  void executeDebugCommand(
    command,
    inventory,
    prefabId => registry.spawn(prefabId),
    saveGame,
    setPlayerSanityPercent,
    async () => {
      await SendLightningStrike({ root: scene, fx: worldFx, sim: prefabs }, player.position);
    },
    teleportPlayerTo,
    findNextEntity,
  )
    .then(result => {
      if (result.ok) {
        console.info(result.message);
      } else {
        console.warn(result.message);
      }
    })
    .catch((error: unknown) => {
      console.error(`Unable to execute debug command: ${command}`, error);
    });
});

window.addEventListener('game:slot-transfer-request', event => {
  const detail = event.detail;
  if (!Number.isSafeInteger(detail.amount) || detail.amount <= 0) {
    return;
  }

  const transferred = detail.swapWith
    ? inventory.swap(detail.from, detail.to, {
        from: { entityId: detail.entityId, itemId: detail.itemId, skinId: detail.skinId, count: detail.amount },
        to: detail.swapWith,
      })
    : inventory.transfer(detail.from, detail.to, detail.amount, {
        itemId: detail.itemId,
        entityId: detail.entityId,
        skinId: detail.skinId,
      });
  slotTransferController.completeTransfer(detail.operationId, transferred);
});
window.addEventListener('game:cursor-return-request', event => {
  const { origin } = event.detail;
  inventory.returnCursor(origin);
});
window.addEventListener('game:slot-select', () => {
  if (!inventory.GetActiveItem()) {
    actionEvents.emit('action:interrupt', { reason: 'slot-select' });
  }
});
gameUi.crafting.addEventListener('game:craft-request', event => {
  actionEvents.emit('action:interrupt', { reason: 'craft' });
  const { recipeId, skinId } = event.detail;
  const recipe = INVENTORY_RECIPES[recipeId];
  if (!recipe) {
    return;
  }

  const make = () =>
    inventory.craft(recipe, skinId, inventoryReceiveEffect(gameUi, screenProjection.GetScreenPos(player.position)));
  if (!recipe.buffered) {
    // builder:MakeRecipe: dolongaction makes the product. Deployable items go into inventory.
    playBuild(playerInstance, make);
    return;
  }
  // builder:BufferBuild buffers a placer's build at once; the placer's BUILD makes it.
  if ((inventory.isBuffered(recipeId) || make()) && isManagedBuildingId(recipeId)) {
    void buildingPlacement.begin(recipeId, inventory.bufferedSkin(recipeId)).catch((error: unknown) => {
      console.error(`Unable to start ${recipeId} placement`, error);
    });
  }
});

/** All startup resources and bindings are ready, and the complete scene has rendered. */
export const gameReady = gameUi.minimap
  .prepareTerrain()
  .then(() => sceneResources.start())
  .then(() => {
    renderer.domElement.dataset.loaded = 'true';
    input.setBlocked(false);
  })
  .catch(error => {
    sceneResources.dispose();
    throw error;
  });
await gameReady;
