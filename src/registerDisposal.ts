import { Vector3, type Object3D } from 'three';
import { type EventEmitter, type GetWatchWorldContent } from '@dontstarve-web/signals';
import {
  cursorSlotAddress,
  equipmentSlotAddress,
  inventorySlotAddress,
  type InventoryStore,
  type ItemEntity,
} from '@dontstarve-web/inventory';
import {
  createChestInventoryPanel,
  createFollowText,
  type mountGameUi,
  type SlotAddress,
  type SlotItem,
} from '@dontstarve-web/ui';
import { PlayerController, type PlayerLocomotor, type PlayerActionEvents } from '@dontstarve-web/stategraphs';
import type { ScreenProjection } from '@dontstarve-web/display';
import { ARMORSNURTLESHELL_ID } from '@dontstarve-web/prefab/armorsnurtleshell';
import { AMULET_ID } from '@dontstarve-web/prefab/amulet';
import { Reader } from '../packages/componets/src/reader';
import { Combat } from '../packages/componets/src/combat';
import { equippedActionEntity } from '../packages/stategraphs/src/componentactions';
import { prefabInstance } from '../packages/prefab/src/prefabInstance';
import { TILE_SIZE } from '@dontstarve-web/prefab/tile';
import {
  hasPlayerInventory,
  PLAYER_COLLIDER_RADIUS,
  playDrop,
  wakeFromBed,
  type PlayerInstance,
} from '@dontstarve-web/prefab/player_common';
import { addComponent, removeComponent } from '@dontstarve-web/prefab/components';
import { Talker } from '../packages/componets/src/talker';
import type { WorldContext } from '@dontstarve-web/prefab/worldContext';
import { buildingContainerId, type StorageBuildingId } from '@dontstarve-web/prefab/containers';
import type { BookWorld } from '@dontstarve-web/prefab/books';
import { isWorldFx } from '@dontstarve-web/prefab/world_fx';
import { registerFrontTask } from './animate';
import { createDeployMap } from '../packages/prefab/src/deployMap';
import { DeployPlacer } from '../packages/prefab/src/deployPlacer';
import type { turfMap } from './building';
import type { startScene } from './scene';
import { setupEmoteWheel } from './emoteWheel';
import { inventoryReceiveEffect } from './inventoryReceive';
import { playerInstance } from './player';

export type DisposalEvents = { dispose: void };

export interface Disposable {
  dispose(): void;
}

export interface FrameController extends Disposable {
  update(): void;
}

interface DisposalResources {
  panels: readonly Disposable[];
  statusHud: Disposable & { advanceAnimation(dt: number): void };
  frameControllers: readonly FrameController[];
  actionControllers: readonly Disposable[];
  stopInventoryReceived: () => void;
  stopEmoteWheel: () => void;
  stopContextMenu: () => void;
}

/** Own application frame tasks and subscribe to explicit scene disposal once. */
export function registerDisposal(events: EventEmitter<DisposalEvents>, resources: DisposalResources): () => void {
  const stopHudAnimation = registerFrontTask(dt => resources.statusHud.advanceAnimation(dt));
  const stopControllerUpdates = resources.frameControllers.map(controller =>
    registerFrontTask(() => controller.update()),
  );
  const unsubscribe = events.on('dispose', () => {
    unsubscribe();
    for (const panel of resources.panels) {
      panel.dispose();
    }
    stopHudAnimation();
    resources.statusHud.dispose();
    resources.stopInventoryReceived();
    resources.frameControllers.forEach((controller, index) => {
      stopControllerUpdates[index]();
      controller.dispose();
    });
    for (const controller of resources.actionControllers) {
      controller.dispose();
    }
    resources.stopEmoteWheel();
    resources.stopContextMenu();
  });
  return unsubscribe;
}

interface ApplicationResourcesOptions {
  gameUi: ReturnType<typeof mountGameUi>;
  view: WorldContext;
  screenProjection: Pick<ScreenProjection, 'GetScreenPos'>;
  inventory: InventoryStore;
  playerEntity?: PlayerInstance;
  locomotor: PlayerLocomotor;
  inventorySlotItem: (entity: ItemEntity) => SlotItem;
  actionEvents: EventEmitter<PlayerActionEvents>;
  isActionInterrupting: () => boolean;
  updateCursor: () => void;
  getWatchWorldContent: GetWatchWorldContent;
  turfMap: typeof turfMap;
}

type SceneResources = Pick<
  Awaited<ReturnType<typeof startScene>>,
  | 'registry'
  | 'prefabs'
  | 'buildingPlacement'
  | 'farmMap'
  | 'mushroomPlants'
  | 'reskinEffects'
  | 'worldFx'
  | 'rockAvocadoBushes'
  | 'grasses'
  | 'saplings'
  | 'scheduler'
  | 'weather'
  | 'moon'
  | 'getWatchWorldContent'
  | 'ponds'
>;

/** Create panels before scene loading, then own action setup and its explicit disposal. */
export function createDisposalResources({
  gameUi,
  view,
  screenProjection,
  inventory,
  playerEntity,
  locomotor,
  inventorySlotItem,
  actionEvents,
  isActionInterrupting,
  updateCursor,
  getWatchWorldContent: watchWorldContent,
  turfMap,
}: ApplicationResourcesOptions) {
  const player = view.player;
  const camera = view.camera;
  const renderer = view.renderer;
  const statusHud = gameUi.statusHud;
  // The same doer RUMMAGE opened it with.
  const closeContainer = (model: Object3D) => prefabInstance(model)?.components.container?.Close(playerInstance);
  const inventoryPanelOptions = {
    camera,
    canvas: renderer.domElement,
    player,
    getWatchWorldContent: watchWorldContent,
    toItem: inventorySlotItem,
    closeContainer,
  };
  const chestInventoryPanel = createChestInventoryPanel(gameUi.chestPanel, inventoryPanelOptions);
  const cookPotInventoryPanel = createChestInventoryPanel(gameUi.cookPotPanel, inventoryPanelOptions);
  const iceBoxInventoryPanel = createChestInventoryPanel(gameUi.iceBoxPanel, inventoryPanelOptions);
  return {
    setContainerOpen(buildId: StorageBuildingId, model: Object3D, isOpen: boolean): void {
      // The containers with a widget button share the cook pot's panel.
      const panel =
        buildId === 'cookpot' || buildId === 'dragonflyfurnace'
          ? cookPotInventoryPanel
          : buildId === 'icebox'
            ? iceBoxInventoryPanel
            : chestInventoryPanel;
      if (!isOpen) {
        panel.close(model);
        return;
      }
      const instance = prefabInstance(model),
        slots = instance?.components.container?.slots;
      if (instance && slots) {
        panel.open(model, buildId, { containerId: buildingContainerId(buildId, String(instance.entityId)), slots });
      }
    },
    register(events: EventEmitter<DisposalEvents>, scene: SceneResources) {
      const { buildingPlacement, worldFx, scheduler, weather, moon, getWatchWorldContent } = scene;
      const handEquipment = inventory.handEquipment;
      const handSlotAddress = equipmentSlotAddress('hand');
      const bodySlotAddress = equipmentSlotAddress('body');
      const isHandSlot = (slot: SlotAddress) =>
        slot.containerId === handSlotAddress.containerId && slot.slotKey === handSlotAddress.slotKey;
      for (const panel of [chestInventoryPanel, cookPotInventoryPanel, iceBoxInventoryPanel]) {
        panel.bindActions(buildingPlacement);
      }
      const frameControllers: FrameController[] = [];
      const actionControllers: Disposable[] = [];
      const stopInventoryReceived = inventory.subscribeReceived((received, source) => {
        if (source) {
          inventoryReceiveEffect(
            gameUi,
            screenProjection.GetScreenPos(new Vector3(source.x, source.y, source.z)),
          )(received);
        }
      });
      if (playerEntity) {
        // Pointer input is blocked while the sleeper's controller is disabled, so waking listens ahead of the canvas.
        const wakeOnPointer = (event: PointerEvent) => {
          if (event.target === renderer.domElement && playerEntity.sg.isSleeping) {
            wakeFromBed(playerEntity);
          }
        };
        window.addEventListener('pointerdown', wakeOnPointer, true);
        actionControllers.push({
          dispose() {
            window.removeEventListener('pointerdown', wakeOnPointer, true);
          },
        });
      }
      // The player inst carries reader.lua's component and tag, with the world services the books' callbacks reach.
      const bookWorld: BookWorld = {
        root: view.scene,
        scheduler,
        weather,
        moon,
        getWatchWorldContent,
        spawnFx(prefab, reader) {
          const { x, z } = reader.getPosition();
          if (isWorldFx(prefab)) {
            worldFx.spawn(prefab, new Vector3(x, 0, z));
          }
        },
      };
      addComponent(playerInstance, 'reader', Reader<PlayerInstance, BookWorld>, bookWorld);
      actionControllers.push({
        dispose() {
          removeComponent(playerInstance, 'reader');
        },
      });

      const talker = addComponent(playerInstance, 'talker', Talker, scheduler);
      const followText = createFollowText({
        camera,
        canvas: renderer.domElement,
        target: player,
        height: PLAYER_COLLIDER_RADIUS * 3.6 + 1,
        line: talker.line,
      });
      frameControllers.push({ update: () => followText.update(), dispose: () => followText.dispose() });
      actionControllers.push({
        dispose() {
          removeComponent(playerInstance, 'talker');
        },
      });

      if (playerEntity) {
        view.registerFrameTask = registerFrontTask;
        // playercontroller.lua: the picker's actions on any entity, buffered for the player.
        if (!hasPlayerInventory(playerEntity)) {
          throw new Error('The player acts with its inventory');
        }
        const controller = new PlayerController(
          view,
          playerEntity.sg,
          locomotor,
          handEquipment,
          playerEntity,
          isActionInterrupting,
        );
        playerInstance.components.playercontroller = controller;
        actionControllers.push(controller, {
          dispose() {
            if (playerInstance.components.playercontroller === controller) {
              delete playerInstance.components.playercontroller;
            }
          },
        });

        // SGwilson.lua fishing states reach inst.components.inventory:GetEquippedItem(HANDS).components.fishingrod.
        const heldRod = () =>
          (
            equippedActionEntity(handEquipment.peek())?.components as
              | { fishingrod?: import('../packages/componets/src/fishingrod').FishingRod }
              | undefined
          )?.fishingrod;
        playerEntity.fishingHost = {
          waitForFish: () => heldRod()?.WaitForFish(),
          collect: () => heldRod()?.Collect(),
          loseRod: () => {
            heldRod()?.Release();
            (handEquipment.peek()?.entity as { remove?(): boolean } | undefined)?.remove?.();
          },
        };
        actionControllers.push({
          dispose: () => {
            playerEntity.fishingHost = undefined;
          },
        });

        // player_common.lua: combat with UNARMED_DAMAGE, WILSON_ATTACK_PERIOD and DEFAULT_ATTACK_RANGE.
        const unit = TILE_SIZE / 4;
        const combat = addComponent(
          playerEntity,
          'combat',
          Combat,
          () => scheduler.now,
          () => equippedActionEntity(handEquipment.peek())?.components.weapon,
        );
        combat.SetDefaultDamage(10);
        combat.SetAttackPeriod(0.4);
        combat.SetRange(2 * unit);
        actionControllers.push({
          dispose() {
            removeComponent(playerEntity, 'combat');
          },
        });
      }
      if (playerEntity) {
        // TheWorld.Map for ACTIONS.DEPLOY and the deployable items' placer.
        const deployMap = createDeployMap({
          turf: turfMap,
          ents: scene.prefabs,
          worldEvents: view.worldEvents,
          farm: scene.farmMap,
          spawnPrefab: (prefab, position, skinId) => scene.registry.SpawnPrefab(prefab, position, skinId),
        });
        playerEntity.Map = deployMap;
        actionControllers.push(new DeployPlacer(view, deployMap, () => inventory.GetActiveItem()), {
          dispose() {
            playerEntity.Map = undefined;
          },
        });
      }

      const stopEmoteWheel = setupEmoteWheel(
        gameUi.emoteWheel,
        view.renderer.domElement,
        playerEntity,
        actionEvents,
        updateCursor,
      );

      const stopContextMenu = gameUi.inventoryBar.contextMenu.subscribe(request => {
        if (!request) {
          return;
        }
        const { slot, action, item } = request;
        actionEvents.emit('action:interrupt', { reason: 'slot-context-menu' });
        if (isHandSlot(slot)) {
          inventory.getEntity(slot)?.flush();
        }
        const stack = inventory.get(slot);
        if (
          !stack ||
          !item ||
          stack.itemId !== item.id ||
          stack.skinId !== item.skinId ||
          (item.entityId !== undefined && inventory.getEntity(slot)?.id !== item.entityId)
        ) {
          return;
        }
        if (action === 'drop') {
          actionEvents.emit('action:interrupt', { reason: 'drop' });
          const entity = inventory.getEntity(slot);
          if (!entity) {
            return;
          }
          // DROP's perform frame: inventory:DropItem of the whole stack, if this inst is still the slot's.
          if (playerEntity) {
            playDrop(playerEntity, () => {
              if (isHandSlot(slot)) {
                inventory.getEntity(slot)?.flush();
              }
              if (inventory.getEntity(slot) !== entity) {
                return false;
              }
              inventory.DropItem(entity, player.position.clone());
              return true;
            });
          }
          return;
        }
        // inventory.lua UseItemFromInvTile: with an active item, use it on the original inventory target.
        const activeItem = inventory.GetActiveItem();
        if (activeItem) {
          const target = inventory.getEntity(slot),
            controller = playerInstance.components.playercontroller;
          const use = target && controller?.GetItemUseAction(activeItem, target);
          if (use) {
            controller?.DoAction(use);
          }
          return;
        }
        if (inventory.getEntity(slot)?.components.deployable?.mode === 'PLANT') {
          if (!inventory.get(cursorSlotAddress())) {
            inventory.transfer(slot, cursorSlotAddress(), stack.count);
          }
          return;
        }
        const entity = inventory.getEntity(slot);
        // inventory.lua UseItemFromInvTile: GetInventoryActions(item)[1], pushed to the locomotor.
        const controller = playerInstance.components.playercontroller;
        const use = entity && controller?.GetInventoryItemAction(entity);
        if (use) {
          controller!.DoAction(use);
          return;
        }
        if (stack.itemId === 'backpack' || stack.itemId === ARMORSNURTLESHELL_ID || stack.itemId === AMULET_ID) {
          const equipped = slot.containerId === bodySlotAddress.containerId && slot.slotKey === bodySlotAddress.slotKey;
          const target = equipped
            ? Array.from({ length: 15 }, (_, index) => inventorySlotAddress(index)).find(
                address => !inventory.get(address),
              )
            : inventory.get(bodySlotAddress) === null
              ? bodySlotAddress
              : undefined;
          // componentactions.lua INVENTORY.useableitem: USEITEM outranks UNEQUIP for a worn item.
          if (equipped && entity?.components.useableitem?.CanInteract()) {
            entity.components.useableitem.StartUsingItem();
            return;
          }
          if (target) {
            inventory.transfer(slot, target, 1);
          }
        }
      });
      registerDisposal(events, {
        panels: [chestInventoryPanel, cookPotInventoryPanel, iceBoxInventoryPanel],
        statusHud,
        frameControllers,
        actionControllers,
        stopInventoryReceived,
        stopEmoteWheel,
        stopContextMenu,
      });
    },
  };
}
