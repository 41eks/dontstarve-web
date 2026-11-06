import { Vector3, type Object3D } from 'three';
import { clockstate, createMemo, readonlySignal, type EventEmitter, type GetWatchWorldContent } from '@dontstarve-web/signals';
import { cursorSlotAddress, equipmentSlotAddress, inventorySlotAddress, type InventoryStore, type InventoryStack } from '@dontstarve-web/inventory';
import { createChestInventoryPanel, type mountGameUi, type SlotAddress, type SlotItem } from '@dontstarve-web/ui';
import {
  PlayerController, FoodActionController,
  ReadActionController, PlayActionController, ItemUseActionController,
  type PickupDoer, type PlayerLocomotor, type PlayerActionEvents,
} from '@dontstarve-web/stategraphs';
import { ItemEntity } from '@dontstarve-web/inventory';
import type { ScreenProjection } from '@dontstarve-web/display';
import { ARMORSNURTLESHELL_ID } from '@dontstarve-web/prefab/armorsnurtleshell';
import { AMULET_ID } from '@dontstarve-web/prefab/amulet';
import { Reader } from '../packages/componets/src/reader';
import { SleepingBagUser } from '../packages/componets/src/sleepingbaguser';
import { Combat, type CombatActor } from '../packages/componets/src/combat';
import { equippedActionEntity } from '../packages/stategraphs/src/componentactions';
import { FindEntities } from '../packages/prefab/src/actionEntity';
import { modelHasTag, prefabInstance, setModelTag } from '../packages/prefab/src/prefabInstance';
import { TILE_SIZE } from '@dontstarve-web/prefab/tile';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';
import { GROUND_ITEM_DEFINITIONS } from '@dontstarve-web/prefab/groundItems';
import type { WorldContext } from '@dontstarve-web/prefab/worldContext';
import type { GroundItemDefinition } from '@dontstarve-web/prefab/groundPrefab';
import type { StorageBuildingId } from '@dontstarve-web/prefab/containers';
import { bookActionObject, type BookReader, type BookWorld } from '@dontstarve-web/prefab/books';
import { isWorldFx } from '@dontstarve-web/prefab/world_fx';
import { registerFrontTask } from './animate';
import { createDeployMap } from '../packages/prefab/src/deployMap';
import { DeployPlacer } from '../packages/prefab/src/deployPlacer';
import type { DeploySpawned } from '../packages/componets/src/deployable';
import { placementEntities } from '../packages/prefab/src/placementEntities';
import type { turfMap } from './building';
import type { startScene } from './scene';
import type { bindPlayerHandEquipment } from './playerHandEquipment';
import { setupEmoteWheel } from './emoteWheel';
import { inventoryReceiveEffect } from './inventoryReceive';
import { playerStats } from './playerStats';
import { playerInstance } from './player';

export type DisposalEvents = { dispose: void };

interface PlayerReaderInst extends BookReader {
  hasTag(tag: string): boolean;
  addTag(tag: string): void;
  removeTag(tag: string): void;
  readonly components: { sanity: { DoDelta(delta: number): void }; reader?: Reader<PlayerReaderInst, BookWorld> };
}

export interface Disposable {
  dispose(): void;
}

export interface FrameController extends Disposable {
  update(): void;
}

interface DisposalResources {
  panels: readonly Disposable[];
  statusHud: Disposable & { advanceClockAnimation(dt: number): void };
  frameControllers: readonly FrameController[];
  actionControllers: readonly Disposable[];
  stopInventoryReceived: () => void;
  stopEmoteWheel: () => void;
  stopContextMenu: () => void;
}

/** Own application frame tasks and subscribe to explicit scene disposal once. */
export function registerDisposal(events: EventEmitter<DisposalEvents>, resources: DisposalResources): () => void {
  const stopClockAnimation = registerFrontTask(dt => resources.statusHud.advanceClockAnimation(dt));
  const stopControllerUpdates = resources.frameControllers.map(controller => registerFrontTask(() => controller.update()));
  const unsubscribe = events.on('dispose', () => {
    unsubscribe();
    for (const panel of resources.panels) {
      panel.dispose();
    }
    stopClockAnimation();
    resources.statusHud.dispose();
    resources.stopInventoryReceived();
    resources.frameControllers.forEach((controller, index) => {
      stopControllerUpdates[index]();
      controller.dispose();
    });
    for (const controller of resources.actionControllers) controller.dispose();
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
  playerAnimation?: WilsonAnimationController;
  locomotor: PlayerLocomotor;
  pickupDoer: PickupDoer;
  handEquipmentBinding: Pick<Awaited<ReturnType<typeof bindPlayerHandEquipment>>, 'flush'>;
  inventorySlotItem: (stack: Readonly<InventoryStack>, maxStack?: number) => SlotItem;
  actionEvents: EventEmitter<PlayerActionEvents>;
  isActionInterrupting: () => boolean;
  updateCursor: () => void;
  getWatchWorldContent: GetWatchWorldContent;
  turfMap: typeof turfMap;
}

type SceneResources = Pick<Awaited<ReturnType<typeof startScene>>,
  'registry' | 'buildingPlacement' | 'groundItems' | 'farmPlow' | 'rockManager' | 'caveEntrances' | 'mushtrees' | 'mushroomPlants' | 'wormholes' | 'reskinEffects' | 'worldFx' | 'flowerPlanting' | 'marbleShrubs' | 'marbleBeanSaplings' | 'rockAvocadoBushes' | 'monkeytails' | 'grasses' | 'saplings' | 'scheduler' | 'weather' | 'moon' | 'getWatchWorldContent' | 'beefalos' | 'molehills' | 'ponds'>;

/** Create panels before scene loading, then own action setup and its explicit disposal. */
export function createDisposalResources({ gameUi, view, screenProjection, inventory, playerAnimation, locomotor, pickupDoer,
  handEquipmentBinding, inventorySlotItem, actionEvents, isActionInterrupting, updateCursor, getWatchWorldContent: watchWorldContent, turfMap }: ApplicationResourcesOptions) {
  const player = view.player;
  const camera = view.camera;
  const renderer = view.renderer;
  const statusHud = gameUi.statusHud;
  const inventoryPanelOptions = { camera, canvas: renderer.domElement, player, getWatchWorldContent: watchWorldContent, toItem: inventorySlotItem };
  const chestInventoryPanel = createChestInventoryPanel(gameUi.chestPanel, inventoryPanelOptions);
  const cookPotInventoryPanel = createChestInventoryPanel(gameUi.cookPotPanel, inventoryPanelOptions, 'cookpot');
  const iceBoxInventoryPanel = createChestInventoryPanel(gameUi.iceBoxPanel, inventoryPanelOptions, 'icebox');
  return {
    setContainerOpen(buildId: StorageBuildingId, model: Object3D, isOpen: boolean): void {
      (buildId === 'cookpot' ? cookPotInventoryPanel : buildId === 'icebox' ? iceBoxInventoryPanel : chestInventoryPanel)
        .setOpen(model, isOpen, buildId);
    },
    register(events: EventEmitter<DisposalEvents>, scene: SceneResources) {
      const { buildingPlacement, groundItems, worldFx, scheduler, weather, moon, getWatchWorldContent } = scene;
      const handEquipment = inventory.handEquipment;
      const handSlotAddress = equipmentSlotAddress('hand');
      const bodySlotAddress = equipmentSlotAddress('body');
      const isHandSlot = (slot: SlotAddress) => slot.containerId === handSlotAddress.containerId
        && slot.slotKey === handSlotAddress.slotKey;
      for (const panel of [chestInventoryPanel, cookPotInventoryPanel, iceBoxInventoryPanel]) {
        panel.bindActions(buildingPlacement);
      }
      const frameControllers: FrameController[] = [];
      const actionControllers: Disposable[] = [];
      const stopInventoryReceived = inventory.subscribeReceived((received, source) => {
        if (source) inventoryReceiveEffect(gameUi,
          screenProjection.GetScreenPos(new Vector3(source.x, source.y, source.z)))(received);
      });
      if (playerAnimation) {
        const itemUse = new ItemUseActionController(view, playerAnimation.stategraph, locomotor, () => {
          const address = cursorSlotAddress(), entity = inventory.getEntity(address);
          if (!entity) return undefined;
          const skin = entity.skinId;
          const isValid = () => !entity.isRemoved && inventory.getEntity(address) === entity && entity.skinId === skin;
          return { entity, isValid,
            take: (deleteItem: boolean) => {
            if (!isValid()) return false;
            const item = inventory.extract(address, 1, entity);
            if (!item) return false;
            if (deleteItem) inventory.entities.destroy(item);
            return true;
          } };
        }, isActionInterrupting);
        frameControllers.push(itemUse);
        // sleepingbaguser.lua on the player: per-tick hunger, sanity and health while in a bed.
        const phase = createMemo(() => clockstate.get().phase);
        const sleeper = new SleepingBagUser({
          scheduler, phase: readonlySignal(phase),
          hunger: playerStats.hunger,
          sanity: playerStats.sanity,
          health: playerStats.health,
          goToWakeup: () => playerAnimation.goToWakeup(),
        });
        // Pointer input is blocked while the controller is disabled, so waking listens ahead of the canvas.
        const wakeOnPointer = (event: PointerEvent) => { if (event.target === renderer.domElement) playerAnimation.wakeFromBed(); };
        const setSleeperState = (sleeping: boolean) => {
          // playercontroller:Enable(false) and inventory:Hide() while asleep.
          playerInstance.controllerEnabled = !sleeping;
          gameUi.inventoryBar.style.visibility = sleeping ? 'hidden' : '';
          if (sleeping) window.addEventListener('pointerdown', wakeOnPointer, true);
          else window.removeEventListener('pointerdown', wakeOnPointer, true);
        };
        // SGwilson.lua tent onenter; tents are not siesta huts, so only the day refuses them.
        const bedRefusal = (bed: { hasTag(tag: string): boolean }) =>
          clockstate.peek().phase === 'day' ? '光线太亮了。'
            : bed.hasTag('burnt') ? '我没有在那里面睡觉的强烈欲望。'
              // TUNING.CALORIES_MED
              : playerStats.hunger.current < 25 ? '我太饿了，睡不着，我肚子的咕咕叫声会让我一直醒着的！' : undefined;
        playerAnimation.bindSleep({
          setSleeperState,
          failReason: bedRefusal,
          announce: reason => console.info(reason),
          canCommit: bed => clockstate.peek().phase !== 'day' && !bed.hasTag('hassleeper') && !bed.hasTag('burnt'),
          get hasBed() { return sleeper.bed !== undefined; },
          wakeBed: nostatechange => sleeper.bed?.DoWakeUp(nostatechange),
        });
        // SLEEPIN's sleepingbag:DoSleep(act.doer) reaches the player's sleepingbaguser.
        pickupDoer.components.sleepingbaguser = sleeper;
        actionControllers.push({ dispose() {
          sleeper.bed?.DoWakeUp(true);
          setSleeperState(false);
          playerAnimation.bindSleep(undefined);
          delete pickupDoer.components.sleepingbaguser;
          sleeper.dispose(); phase.dispose();
        } });
      }
      const foodActions = playerAnimation ? new FoodActionController(view, playerAnimation.stategraph, locomotor,
        playerInstance, isActionInterrupting) : undefined;
      if (foodActions) {
        frameControllers.push(foodActions);
      }

      // The player inst carries reader.lua's component and tag, plus the sanity it charges.
      const readerInst: PlayerReaderInst = {
        hasTag: (tag: string) => modelHasTag(player, tag),
        addTag: (tag: string) => setModelTag(player, tag, true),
        removeTag: (tag: string) => setModelTag(player, tag, false),
        getPosition: () => player.position,
        components: {
          sanity: playerStats.sanity,
        },
      };
      const reader = new Reader<PlayerReaderInst, BookWorld>(readerInst);
      readerInst.components.reader = reader;
      const bookWorld: BookWorld = {
        root: view.scene, scheduler, weather, moon, getWatchWorldContent,
        spawnFx(prefab, { getPosition }) {
          const { x, z } = getPosition();
          if (isWorldFx(prefab)) worldFx.spawn(prefab, new Vector3(x, 0, z));
        },
      };
      const readActions = playerAnimation
        ? new ReadActionController(view, playerAnimation.stategraph, locomotor, isActionInterrupting) : undefined;
      if (readActions) frameControllers.push(readActions);
      const playActions = playerAnimation
        ? new PlayActionController(view, playerAnimation.stategraph, locomotor, isActionInterrupting) : undefined;
      if (playActions) frameControllers.push(playActions);
      const playInventoryInstrument = (slot: SlotAddress, entity: ItemEntity) => {
        const isValid = () => !entity.isRemoved && inventory.getEntity(slot) === entity;
        const skinArchive = entity.skinId === undefined ? undefined : GROUND_ITEM_DEFINITIONS[entity.prefab]?.skinArchives[entity.skinId];
        return playActions!.play({
          instrument: {
            prefab: entity.prefab, hasTag: tag => entity.hasTag(tag),
            ...(skinArchive ? { skinBuild: skinArchive.replace(/^dynamic\/|\.zip$/g, '') } : {}),
          },
          isValid,
          // ACTIONS.PLAY.fn, then BufferedAction:Do's finiteuses:OnUsedAsItem.
          play: () => {
            if (!isValid()) return false;
            const played = entity.components.instrument!.Play(readerInst,
              range => FindEntities(player.position, range * TILE_SIZE / 4, undefined, ['FX', 'DECOR', 'INLIMBO']) as never[]);
            if (played) entity.components.finiteuses.useForAction('PLAY');
            return played;
          },
        });
      };
      const readInventoryBook = (slot: SlotAddress, entity: ItemEntity) => {
        const isValid = () => !entity.isRemoved && inventory.getEntity(slot) === entity;
        const book = bookActionObject(entity);
        return readActions!.read({
          book, isValid,
          read: () => isValid() && (reader.Read(entity, bookWorld)?.[0] ?? false),
        });
      };

      if (playerAnimation) {
        view.registerFrameTask = registerFrontTask;
        // playercontroller.lua: the picker's actions on any entity, buffered for the player.
        const controller = new PlayerController(view, playerAnimation.stategraph, locomotor, handEquipment, pickupDoer, isActionInterrupting);
        playerInstance.components.playercontroller = controller;
        actionControllers.push(controller, { dispose() {
          if (playerInstance.components.playercontroller === controller) delete playerInstance.components.playercontroller;
        } });

        // SGwilson.lua fishing states reach inst.components.inventory:GetEquippedItem(HANDS).components.fishingrod.
        const heldRod = () => (equippedActionEntity(handEquipment.peek())?.components as { fishingrod?: import('../packages/componets/src/fishingrod').FishingRod } | undefined)?.fishingrod;
        playerAnimation.bindFishing({
          waitForFish: () => heldRod()?.WaitForFish(),
          collect: () => heldRod()?.Collect(),
          loseRod: () => {
            heldRod()?.Release();
            (handEquipment.peek()?.entity as { remove?(): boolean } | undefined)?.remove?.();
          },
        });
        actionControllers.push({ dispose: () => playerAnimation.bindFishing(undefined) });

        // player_common.lua: combat with UNARMED_DAMAGE, WILSON_ATTACK_PERIOD and DEFAULT_ATTACK_RANGE.
        const unit = TILE_SIZE / 4;
        const attackerInst: CombatActor = {
          getPosition: () => player.position,
          getPhysicsRadius: () => .5 * unit,
          hasTag: tag => tag === 'player' || modelHasTag(player, tag),
          PushEvent: (name, data) => prefabInstance(player)!.PushEvent(name, data),
          components: { health: playerStats.health, sanity: playerStats.sanity, inventory },
        };
        // inst:PushEvent reaches the stategraph's EventHandlers.
        for (const name of ['attacked', 'blocked'] as const) {
          const stop = prefabInstance(player)!.ListenForEvent(name, data => playerAnimation.stategraph.pushEvent(name, data));
          actionControllers.push({ dispose: stop });
        }
        const combat = new Combat(attackerInst, () => scheduler.now,
          () => equippedActionEntity(handEquipment.peek())?.components.weapon);
        combat.SetDefaultDamage(10);
        combat.SetAttackPeriod(.4);
        combat.SetRange(2 * unit);
        attackerInst.components.combat = combat;
        // pickable onpickedfn callbacks hurt the picker through its combat.
        pickupDoer.components.combat = combat;
        playerAnimation.combat = combat;
      }
      if (playerAnimation) {

        // TheWorld.Map for ACTIONS.DEPLOY and the deployable items' placer.
        const deployMap = createDeployMap({ turf: turfMap, blockers: placementEntities(view.scene), worldEvents: view.worldEvents, farm: scene.farmPlow,
          spawnPrefab: (prefab, position, skinId) => scene.registry.SpawnPrefab(prefab, position, skinId) as DeploySpawned | undefined });
        pickupDoer.Map = deployMap;
        actionControllers.push(new DeployPlacer(view, deployMap, () => inventory.GetActiveItem()),
          { dispose() { pickupDoer.Map = undefined; } });
      }

      const stopEmoteWheel = setupEmoteWheel(gameUi.emoteWheel, view.renderer.domElement, playerAnimation,
        actionEvents, updateCursor);

      const stopContextMenu = gameUi.inventoryBar.contextMenu.subscribe((request) => {
        if (!request) return;
        const { slot, action, item } = request;
        actionEvents.emit('action:interrupt', { reason: 'slot-context-menu' });
        if (isHandSlot(slot)) handEquipmentBinding.flush();
        const stack = inventory.get(slot);
        if (!stack || !item || stack.itemId !== item.id || stack.skinId !== item.skinId
          || (item.entityId !== undefined && inventory.getEntity(slot)?.id !== item.entityId)) return;
        if (action === 'drop') {
          actionEvents.emit('action:interrupt', { reason: 'drop' });
          const spec = inventory.getStackSpec(stack);
          const entity = inventory.getEntity(slot);
          if (!entity) return;
          // The DROP hands over this inst; its ground visual draws the item's own sprite.
          const definition: GroundItemDefinition = {
            entity,
            itemId: stack.itemId,
            ...(stack.skinId === undefined ? {} : { skinId: stack.skinId }),
            name: spec.name,
            icon: spec.icon,
            ...(spec.atlas ? { atlas: spec.atlas } : {}),
            // inventory:DropItemFromInvTile drops the whole stack unless a single drop is forced.
            count: stack.count,
            ...(stack.remainingUses === undefined ? {} : { remainingUses: stack.remainingUses }),
            ...(stack.remainingFuel === undefined ? {} : { remainingFuel: stack.remainingFuel }),
            ...(stack.phonographRecord === undefined ? {} : { phonographRecord: stack.phonographRecord }),
          };
          const take = () => {
            if (isHandSlot(slot)) handEquipmentBinding.flush();
            const current = inventory.get(slot);
            if (current?.itemId !== stack.itemId || current.skinId !== stack.skinId
              || current.count !== stack.count || current.remainingUses !== stack.remainingUses || current.phonographRecord !== stack.phonographRecord) return false;
            return inventory.extract(slot, stack.count, entity) ?? false;
          };
          // DROP's perform frame transfers the item immediately; its display loads the art.
          playerAnimation?.playDrop(() => groundItems.drop(definition, player.position.clone(), take));
          return;
        }
        // inventory.lua UseItemFromInvTile: with an active item, use it on the original inventory target.
        const activeItem = inventory.GetActiveItem();
        if (activeItem) {
          const target = inventory.getEntity(slot), controller = playerInstance.components.playercontroller;
          const use = target && controller?.GetItemUseAction(activeItem, target);
          if (use) controller?.DoAction(use);
          return;
        }
        if (inventory.getEntity(slot)?.components.deployable?.mode === 'PLANT') {
          if (!inventory.get(cursorSlotAddress())) inventory.transfer(slot, cursorSlotAddress(), stack.count);
          return;
        }
        const entity = inventory.getEntity(slot);
        if (playActions && entity && PlayActionController.canPlay(entity)) {
          playInventoryInstrument(slot, entity);
          return;
        }
        if (readActions && entity && ReadActionController.canRead(readerInst, entity)) {
          readInventoryBook(slot, entity);
          return;
        }
        if (foodActions && entity && playerInstance.components.eater?.CanEat(entity)) {
          foodActions.eat(entity);
          return;
        }
        if (stack.itemId === 'backpack' || stack.itemId === ARMORSNURTLESHELL_ID || stack.itemId === AMULET_ID) {
          const equipped = slot.containerId === bodySlotAddress.containerId && slot.slotKey === bodySlotAddress.slotKey;
          const target = equipped
            ? Array.from({ length: 15 }, (_, index) => inventorySlotAddress(index)).find((address) => !inventory.get(address))
            : inventory.get(bodySlotAddress) === null ? bodySlotAddress : undefined;
          // componentactions.lua INVENTORY.useableitem: USEITEM outranks UNEQUIP for a worn item.
          if (equipped && entity?.components.useableitem?.CanInteract()) {
            entity.components.useableitem.StartUsingItem();
            return;
          }
          if (target) inventory.transfer(slot, target, 1);
        }
      });
      registerDisposal(events, {
        panels: [chestInventoryPanel, cookPotInventoryPanel, iceBoxInventoryPanel],
        statusHud, frameControllers, actionControllers,
        stopInventoryReceived, stopEmoteWheel,
        stopContextMenu: () => { stopContextMenu(); reader.OnRemoveFromEntity(); },
      });
    },
  };
}
