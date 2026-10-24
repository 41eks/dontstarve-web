import { Vector3, type Object3D } from 'three';
import type { EventEmitter } from '@dontstarve-web/signals';
import { cursorSlotAddress, equipmentSlotAddress, inventorySlotAddress, type InventoryStore, type InventoryStack } from '@dontstarve-web/inventory';
import { createChestInventoryPanel, slotTransferController, type mountGameUi, type SlotAddress, type SlotItem } from '@dontstarve-web/ui';
import {
  AttackActionController, SpellCastActionController, BugNetCaptureController, HammerActionController,
  LighterActionController, PickaxeActionController, PitchforkActionController,
  FarmHoeActionController, ShovelActionController, FoodActionController,
  PickActionController, HarvestActionController, OccupiableActionController, PickupActionController, ReadActionController, ItemUseActionController,
  ReskinActionController, type PickupDoer, type FoodSource, type ActionLocomotor, type PlayerActionEvents,
} from '@dontstarve-web/stategraphs';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Reader } from '../packages/componets/src/reader';
import { Combat, type CombatInst } from '../packages/componets/src/combat';
import { equippedActionEntity } from '../packages/stategraphs/src/componentactions';
import { TILE_SIZE } from '@dontstarve-web/prefab/tile';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';
import type { WorldContext } from '@dontstarve-web/prefab/worldContext';
import type { GroundItemDefinition } from '@dontstarve-web/prefab/groundPrefab';
import type { StorageBuildingId } from '@dontstarve-web/prefab/containers';
import { FOOD_EFFECTS, getFoodEffects, type FoodEffects } from '@dontstarve-web/prefab/food';
import { bookActionObject, type BookReader, type BookWorld } from '@dontstarve-web/prefab/books';
import { PreloadSounds } from '@dontstarve-web/prefab/sound';
import { backTasks, registerFrontTask } from './animate';
import type { turfMap } from './building';
import type { startScene } from './scene';
import type { bindPlayerHandEquipment } from './playerHandEquipment';
import { setupEmoteWheel } from './emoteWheel';
import { inventoryReceiveEffect } from './inventoryReceive';
import { playerStats, applyPlayerFoodEffects } from './playerStats';
import { SAVE_CATALOG } from './save/catalog';

export type DisposalEvents = { dispose: void };

interface PlayerReaderInst extends BookReader {
  hasTag(tag: string): boolean;
  addTag(tag: string): void;
  removeTag(tag: string): void;
  readonly components: { sanity: { doDelta(delta: number): void }; reader?: Reader<PlayerReaderInst, BookWorld> };
}

export interface Disposable {
  dispose(): void;
}

export interface FrameController extends Disposable {
  update(): void;
}

interface DisposalResources {
  panels: readonly (Disposable & { update?: () => void })[];
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
      if (panel.update) {
        const index = backTasks.indexOf(panel.update);
        if (index >= 0) backTasks.splice(index, 1);
      }
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
  inventory: InventoryStore;
  playerAnimation?: WilsonAnimationController;
  locomotor: ActionLocomotor;
  pickupDoer: PickupDoer;
  handEquipmentBinding: Pick<Awaited<ReturnType<typeof bindPlayerHandEquipment>>, 'flush'>;
  inventorySlotItem: (stack: Readonly<InventoryStack>, maxStack?: number) => SlotItem;
  actionEvents: EventEmitter<PlayerActionEvents>;
  isActionInterrupting: () => boolean;
  updateCursor: () => void;
  turfMap: typeof turfMap;
}

type SceneResources = Pick<Awaited<ReturnType<typeof startScene>>,
  'moonTreeForest' | 'buildingPlacement' | 'groundItems' | 'farmPlow' | 'rockManager' | 'wormholes' | 'reskinEffects' | 'flowerPlanting' | 'grasses' | 'saplings' | 'scheduler'>;

/** Create panels before scene loading, then own action setup and its explicit disposal. */
export function createDisposalResources({ gameUi, view, inventory, playerAnimation, locomotor, pickupDoer,
  handEquipmentBinding, inventorySlotItem, actionEvents, isActionInterrupting, updateCursor, turfMap }: ApplicationResourcesOptions) {
  const player = view.player;
  const camera = view.camera;
  const renderer = view.renderer;
  const statusHud = gameUi.statusHud;
  const inventoryPanelOptions = { camera, canvas: renderer.domElement, player, toItem: inventorySlotItem };
  const chestInventoryPanel = createChestInventoryPanel(gameUi.chestPanel, inventoryPanelOptions);
  const cookPotInventoryPanel = createChestInventoryPanel(gameUi.cookPotPanel, inventoryPanelOptions, 'cookpot');
  const iceBoxInventoryPanel = createChestInventoryPanel(gameUi.iceBoxPanel, inventoryPanelOptions, 'icebox');
  backTasks.push(chestInventoryPanel.update, cookPotInventoryPanel.update, iceBoxInventoryPanel.update);
  return {
    setContainerOpen(buildId: StorageBuildingId, model: Object3D, isOpen: boolean): void {
      (buildId === 'cookpot' ? cookPotInventoryPanel : buildId === 'icebox' ? iceBoxInventoryPanel : chestInventoryPanel)
        .setOpen(model, isOpen, buildId);
    },
    register(events: EventEmitter<DisposalEvents>, scene: SceneResources) {
      const { moonTreeForest, buildingPlacement, groundItems, farmPlow, rockManager, wormholes, reskinEffects, flowerPlanting, grasses, saplings, scheduler } = scene;
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
      const preparePickDoer = async (itemId: string, count: number, original?: ItemEntity) => {
        const entity = original ?? inventory.entities.create({ itemId, count });
        let committed = false;
        return {
          loot: entity,
          giveItem: (_itemId: string, _count: number, sourcePosition: Vector3) => {
            if (committed || entity.isRemoved) return false;
            committed = inventory.GiveItem(entity, sourcePosition);
            return committed;
          },
          giveEntity: (item: ItemEntity, sourcePosition: Vector3) => {
            if (committed || item !== entity || item.isRemoved) return false;
            committed = inventory.GiveItem(item, sourcePosition);
            return committed;
          },
          dispose: () => { if (!committed && !original) inventory.entities.destroy(entity); },
        };
      };
      const stopInventoryReceived = inventory.subscribeReceived((received, source) => {
        if (source) inventoryReceiveEffect(gameUi.inventoryBar, view.camera, view.renderer.domElement,
          player.position.clone().set(source.x, source.y, source.z))(received);
      });
      if (playerAnimation) {
        const itemUse = new ItemUseActionController(view, playerAnimation, locomotor, () => {
          const address = cursorSlotAddress(), entity = inventory.getEntity(address);
          if (!entity) return undefined;
          const skin = entity.skinId;
          const isValid = () => !entity.isRemoved && inventory.getEntity(address) === entity && entity.skinId === skin;
          return { entity, isValid, take: (deleteItem: boolean) => {
            if (!isValid()) return false;
            const item = inventory.extract(address, 1, entity);
            if (!item) return false;
            if (deleteItem) inventory.entities.destroy(item);
            return true;
          } };
        }, isActionInterrupting);
        const picking = new PickActionController(view, playerAnimation, locomotor, preparePickDoer, isActionInterrupting);
        const pickup = new PickupActionController(view, playerAnimation, locomotor, pickupDoer, isActionInterrupting);
        const harvesting = new HarvestActionController(view, playerAnimation, locomotor, async (itemId, count) => {
          const drop = await groundItems.prepareSpawn({ ...SAVE_CATALOG.items[itemId], itemId, count });
          return {
            giveItem: (_prefab, _count, position) => {
              const sourcePosition = view.player.position.clone().set(position.x, position.y, position.z);
              const received = inventory.addAvailable(itemId, count, undefined,
                inventoryReceiveEffect(gameUi.inventoryBar, view.camera, view.renderer.domElement, sourcePosition));
              return received === count || drop.spawn(view.player.position.clone().setY(0), count - received);
            },
            dispose: () => drop.dispose(),
          };
        }, isActionInterrupting);
        // actions.lua HARVEST (occupiable) / TAKEITEM (shelf): the released inst goes to the player's inventory.
        const occupiables = new OccupiableActionController(view, playerAnimation, locomotor, (item, position) =>
          inventory.GiveItem(item as ItemEntity, position), isActionInterrupting);
        frameControllers.push(itemUse, picking, pickup, harvesting, occupiables);
      }
      const foodActions = playerAnimation ? new FoodActionController(view, playerAnimation, locomotor, farmPlow,
        isActionInterrupting,
        (error) => console.error('Unable to use food', error), () => slotTransferController.clearSelection()) : undefined;
      if (foodActions) {
        frameControllers.push(foodActions);
      }
      function inventoryFoodSource(slot: SlotAddress, itemId: string, onTaken?: (effects: FoodEffects) => void): FoodSource {
        const entity = inventory.getEntity(slot), skinId = entity?.skinId;
        const isValid = () => entity !== null && !entity.isRemoved && entity.prefab === itemId
          && entity.skinId === skinId && inventory.getEntity(slot) === entity;
        const foodDrink = FOOD_EFFECTS[itemId]?.foodDrink;
        return {
          itemId,
          foodDrink,
          prepareEat: () => PreloadSounds(foodDrink ? 'dontstarve/wilson/sip' : 'dontstarve/wilson/eat'),
          isValid,
          take: () => {
            if (!isValid()) return false;
            // eater:Eat reads edible values, including the settled perish stage, before removing one.
            entity!.flush();
            if (!isValid()) return false;
            const effects = getFoodEffects(entity!);
            if (!inventory.applySlotChanges([{ slot, itemId, skinId, delta: -1 }])) return false;
            if (effects) onTaken?.(effects);
            return true;
          },
        };
      }

      // The player inst carries reader.lua's component and tag, plus the sanity it charges.
      const tags: string[] = player.userData.tags ??= [];
      const readerInst: PlayerReaderInst = {
        hasTag: (tag: string) => tags.includes(tag),
        addTag(tag: string) { if (!tags.includes(tag)) tags.push(tag); },
        removeTag(tag: string) { const index = tags.indexOf(tag); if (index >= 0) tags.splice(index, 1); },
        getPosition: () => player.position,
        components: {
          sanity: { doDelta: (delta: number) => playerStats.sanity.set(playerStats.sanity.peek() + delta) },
        },
      };
      const reader = new Reader<PlayerReaderInst, BookWorld>(readerInst);
      readerInst.components.reader = reader;
      const bookWorld: BookWorld = { root: view.scene, scheduler };
      const readActions = playerAnimation
        ? new ReadActionController(view, playerAnimation, locomotor, isActionInterrupting) : undefined;
      if (readActions) frameControllers.push(readActions);
      const readInventoryBook = (slot: SlotAddress, entity: ItemEntity) => {
        const isValid = () => !entity.isRemoved && inventory.getEntity(slot) === entity;
        return readActions!.read({
          book: bookActionObject(entity), isValid,
          read: () => isValid() && (reader.Read(entity, bookWorld)?.[0] ?? false),
        });
      };

      if (playerAnimation) {
        view.registerFrameTask = registerFrontTask;
        const bugNet = new BugNetCaptureController(view, playerAnimation, locomotor,
          handEquipment,
          () => groundItems.netCaptureTargets,
          isActionInterrupting);
        actionControllers.push(bugNet);
        groundItems.setNetCaptureHandler(target => bugNet.request(target));

        // player_common.lua: combat with UNARMED_DAMAGE, WILSON_ATTACK_PERIOD and DEFAULT_ATTACK_RANGE.
        const unit = TILE_SIZE / 4;
        const attackerInst: CombatInst = {
          getPosition: () => new Vector3(player.position.x, 0, player.position.z),
          getPhysicsRadius: () => .5 * unit,
          hasTag: tag => tag === 'player' || tags.includes(tag),
          PushEvent: (name, data) => player.dispatchEvent({ type: name, data } as never),
          components: {},
        };
        const combat = new Combat(attackerInst, () => scheduler.now,
          () => equippedActionEntity(handEquipment.peek())?.components.weapon);
        combat.SetDefaultDamage(10);
        combat.SetAttackPeriod(.4);
        combat.SetRange(2 * unit);
        attackerInst.components.combat = combat;
        playerAnimation.combat = combat;
        actionControllers.push(new AttackActionController(view, playerAnimation, locomotor, handEquipment,
          { inst: attackerInst, combat }, () => buildingPlacement.combatTargets, isActionInterrupting, unit));
      }
      if (playerAnimation) {
        const spellcast = new SpellCastActionController(view, playerAnimation, locomotor, handEquipment, {
          position: player.position,
          hasTag: tag => player.userData.tags?.includes(tag) ?? false,
          components: { sanity: { doDelta: delta => playerStats.sanity.set(playerStats.sanity.peek() + delta) } },
        }, isActionInterrupting, (error) => console.error('Unable to cast spell', error),
        () => [...groundItems.spellTargets, ...buildingPlacement.spellTargets]);

        const hammer = new HammerActionController(view, playerAnimation, locomotor,
          handEquipment,
          () => [...buildingPlacement.hammerTargets, ...farmPlow.hammerTargets, ...groundItems.hammerTargets],
          isActionInterrupting);
        const pickaxe = new PickaxeActionController(view, playerAnimation, locomotor,
          handEquipment, () => rockManager.mineTargets, isActionInterrupting);
        const pitchfork = new PitchforkActionController(view, playerAnimation, locomotor,
          handEquipment, turfMap, isActionInterrupting);
        const farmHoe = new FarmHoeActionController(view, playerAnimation, locomotor,
          handEquipment, farmPlow, isActionInterrupting,
          (error) => console.error('Unable to till farm soil', error));
        const shovel = new ShovelActionController(view, playerAnimation, locomotor,
          handEquipment, () => [...farmPlow.digTargets, ...grasses.digTargets, ...saplings.digTargets], isActionInterrupting);
        const reskin = new ReskinActionController(view, playerAnimation, locomotor,
          handEquipment,
          () => [...buildingPlacement.reskinTargets, ...groundItems.reskinTargets, ...wormholes.reskinTargets], reskinEffects,
          isActionInterrupting, (error) => console.error('Unable to reskin target', error));
        const lighter = new LighterActionController(view, playerAnimation, locomotor, handEquipment, isActionInterrupting);
        const axe = new PickaxeActionController(view, playerAnimation, locomotor,
          handEquipment, () => moonTreeForest.chopTargets, isActionInterrupting, 'CHOP');
        actionControllers.push(spellcast, hammer, pickaxe, axe, pitchfork, farmHoe, shovel, reskin, lighter);
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
        const entity = inventory.getEntity(slot);
        if (readActions && entity && ReadActionController.canRead(readerInst, entity)) {
          void readInventoryBook(slot, entity).catch((error: unknown) => console.error(`Unable to read ${stack.itemId}`, error));
          return;
        }
        if (FOOD_EFFECTS[stack.itemId] && foodActions) {
          let eaten: FoodEffects | undefined;
          void foodActions.eat(inventoryFoodSource(slot, stack.itemId, effects => { eaten = effects; }), () => {
            if (eaten) applyPlayerFoodEffects(eaten);
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
      registerDisposal(events, {
        panels: [chestInventoryPanel, cookPotInventoryPanel, iceBoxInventoryPanel],
        statusHud, frameControllers, actionControllers,
        stopInventoryReceived, stopEmoteWheel,
        stopContextMenu: () => { stopContextMenu(); reader.OnRemoveFromEntity(); },
      });
      return {
        beginFood(slot: SlotAddress, itemId: string): boolean {
          if (!foodActions) return false;
          foodActions.begin(inventoryFoodSource(slot, itemId));
          return true;
        },
      };
    },
  };
}
