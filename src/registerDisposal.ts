import { Vector3, type Object3D } from 'three';
import { clockstate, createMemo, readonlySignal, type EventEmitter, type GetWatchWorldContent } from '@dontstarve-web/signals';
import { cursorSlotAddress, equipmentSlotAddress, inventorySlotAddress, type InventoryStore, type InventoryStack } from '@dontstarve-web/inventory';
import { createChestInventoryPanel, slotTransferController, type mountGameUi, type SlotAddress, type SlotItem } from '@dontstarve-web/ui';
import {
  AttackActionController, SpellCastActionController, BugNetCaptureController, FishingActionController, HammerActionController,
  LighterActionController, PickaxeActionController, PitchforkActionController,
  FarmHoeActionController, ShovelActionController, FoodActionController,
  PickActionController, HarvestActionController, OccupiableActionController, PickupActionController, ReadActionController, PlayActionController, ItemUseActionController,
  ReskinActionController, SleepActionController, HauntActionController, type PickupDoer, type FoodSource, type ActionLocomotor, type PlayerActionEvents,
} from '@dontstarve-web/stategraphs';
import { ItemEntity } from '@dontstarve-web/inventory';
import { ARMORSNURTLESHELL_ID } from '@dontstarve-web/prefab/armorsnurtleshell';
import { AMULET_ID } from '@dontstarve-web/prefab/amulet';
import { FISHINGROD_ID, getFishingRod } from '@dontstarve-web/prefab/fishingrod';
import { Reader } from '../packages/componets/src/reader';
import { SleepingBagUser } from '../packages/componets/src/sleepingbaguser';
import { Combat, type CombatActor } from '../packages/componets/src/combat';
import { equippedActionEntity } from '../packages/stategraphs/src/componentactions';
import { actionEntity, FindEntities } from '../packages/prefab/src/actionEntity';
import type { PickActor } from '../packages/stategraphs/src/pick';
import { TILE_SIZE } from '@dontstarve-web/prefab/tile';
import type { WilsonAnimationController } from '@dontstarve-web/prefab/player';
import { GROUND_ITEM_DEFINITIONS } from '@dontstarve-web/prefab/groundItems';
import type { WorldContext } from '@dontstarve-web/prefab/worldContext';
import type { GroundItemDefinition } from '@dontstarve-web/prefab/groundPrefab';
import type { StorageBuildingId } from '@dontstarve-web/prefab/containers';
import { FOOD_EFFECTS, getFoodEffects, type FoodEffects } from '@dontstarve-web/prefab/food';
import { bookActionObject, type BookReader, type BookWorld } from '@dontstarve-web/prefab/books';
import { isWorldFx } from '@dontstarve-web/prefab/world_fx';
import { PreloadSounds } from '@dontstarve-web/prefab/sound';
import { registerFrontTask } from './animate';
import { PlantDeployment } from '../packages/prefab/src/plantDeployment';
import { PLANTABLES } from '@dontstarve-web/prefab/plantables';
import { TurfDeployment } from '@dontstarve-web/prefab/turfDeployment';
import { turfTileName } from '@dontstarve-web/prefab/turfs';
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
  inventory: InventoryStore;
  playerAnimation?: WilsonAnimationController;
  locomotor: ActionLocomotor;
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
  'registry' | 'moonTreeForest' | 'evergreenForest' | 'deciduousForest' | 'buildingPlacement' | 'groundItems' | 'farmPlow' | 'rockManager' | 'caveEntrances' | 'grottoPools' | 'mushtrees' | 'mushroomPlants' | 'wormholes' | 'reskinEffects' | 'worldFx' | 'flowerPlanting' | 'marbleShrubs' | 'archiveProps' | 'skeletons' | 'houndbones' | 'marbleBeanSaplings' | 'rockAvocadoSaplings' | 'rockAvocadoBushes' | 'berrybushes' | 'monkeytails' | 'grasses' | 'saplings' | 'scheduler' | 'weather' | 'moon' | 'getWatchWorldContent' | 'beefalos' | 'molehills' | 'ponds'>;

/** Create panels before scene loading, then own action setup and its explicit disposal. */
export function createDisposalResources({ gameUi, view, inventory, playerAnimation, locomotor, pickupDoer,
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
      const { moonTreeForest, evergreenForest, deciduousForest, buildingPlacement, groundItems, molehills, farmPlow, rockManager, caveEntrances, grottoPools, mushtrees, mushroomPlants, wormholes, reskinEffects, worldFx, flowerPlanting, marbleShrubs, archiveProps, skeletons, houndbones, marbleBeanSaplings, rockAvocadoSaplings, rockAvocadoBushes, berrybushes, monkeytails, grasses, saplings, scheduler, weather, moon, getWatchWorldContent, ponds } = scene;
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
      let playerCombat: Combat | undefined;
      const pickActor: PickActor = {
        hasTag: tag => tag === 'player' || (player.userData.tags?.includes(tag) ?? false),
        PushEvent: (name, data) => player.dispatchEvent({ type: name, data } as never),
        components: {
          sanity: { DoDelta: delta => playerStats.sanity.set(playerStats.sanity.peek() + delta) },
          inventory,
          get combat() { return playerCombat; },
        },
      };
      const preparePickDoer = async (itemId: string, count: number, original?: ItemEntity) => {
        const entity = original ?? inventory.entities.create({ itemId, count });
        let committed = false;
        return {
          loot: entity,
          picker: pickActor,
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
      let itemUse: ItemUseActionController | undefined;
      if (playerAnimation) {
        itemUse = new ItemUseActionController(view, playerAnimation, locomotor, () => {
          const address = cursorSlotAddress(), entity = inventory.getEntity(address);
          if (!entity) return undefined;
          const skin = entity.skinId;
          const isValid = () => !entity.isRemoved && inventory.getEntity(address) === entity && entity.skinId === skin;
          return { entity, isValid,
            extractFuel: () => {
              if (!isValid()) return null;
              const item = inventory.extract(address, 1, entity);
              if (item) inventory.configureItem(item);
              return item;
            },
            returnFuel: (item: import('../packages/componets/src/fuel').FuelItem) => {
              const returned = item as ItemEntity;
              if (!inventory.receiveAt(address, returned)) inventory.GiveItem(returned);
            },
            take: (deleteItem: boolean) => {
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
        // sleepingbaguser.lua on the player: per-tick hunger, sanity and health while in a bed.
        const phase = createMemo(() => clockstate.get().phase);
        const sleeper = new SleepingBagUser({
          scheduler, phase: readonlySignal(phase),
          hunger: { doDelta: delta => playerStats.hunger.set(playerStats.hunger.peek() + delta), isStarving: () => playerStats.hunger.peek() <= 0 },
          sanity: { doDelta: delta => playerStats.sanity.set(playerStats.sanity.peek() + delta), getPercentWithPenalty: () => playerStats.sanity.percent.peek() },
          health: { doDelta: delta => playerStats.health.set(playerStats.health.peek() + delta) },
          goToWakeup: () => playerAnimation.goToWakeup(),
        });
        // Pointer input is blocked while the controller is disabled, so waking listens ahead of the canvas.
        const wakeOnPointer = (event: PointerEvent) => { if (event.target === renderer.domElement) playerAnimation.wakeFromBed(); };
        const setSleeperState = (sleeping: boolean) => {
          // playercontroller:Enable(false) and inventory:Hide() while asleep.
          view.player.userData.controllerEnabled = !sleeping;
          gameUi.inventoryBar.style.visibility = sleeping ? 'hidden' : '';
          if (sleeping) window.addEventListener('pointerdown', wakeOnPointer, true);
          else window.removeEventListener('pointerdown', wakeOnPointer, true);
        };
        // SGwilson.lua tent onenter; tents are not siesta huts, so only the day refuses them.
        const bedRefusal = (bed: { hasTag(tag: string): boolean }) =>
          clockstate.peek().phase === 'day' ? '光线太亮了。'
            : bed.hasTag('burnt') ? '我没有在那里面睡觉的强烈欲望。'
              // TUNING.CALORIES_MED
              : playerStats.hunger.peek() < 25 ? '我太饿了，睡不着，我肚子的咕咕叫声会让我一直醒着的！' : undefined;
        playerAnimation.bindSleep({
          setSleeperState,
          setHidden: hidden => { view.player.visible = !hidden; },
          failReason: bedRefusal,
          announce: reason => console.info(reason),
          canCommit: bed => clockstate.peek().phase !== 'day' && !bed.hasTag('hassleeper') && !bed.hasTag('burnt'),
          get hasBed() { return sleeper.bed !== undefined; },
          wakeBed: nostatechange => sleeper.bed?.DoWakeUp(nostatechange),
        });
        const sleeping = new SleepActionController(view, playerAnimation, locomotor, sleeper, isActionInterrupting);
        frameControllers.push(sleeping);
        // SGwilsonghost's HAUNT: the ghost doer is the player inst, so `playerghost` and `respawnfromghost` reach it.
        const ghostInst = actionEntity(view.player as never, view.player.userData.artCharacter as string);
        frameControllers.push(new HauntActionController(view, playerAnimation, locomotor,
          { hasTag: tag => ghostInst.hasTag(tag), PushEvent: (name, data) => ghostInst.PushEvent?.(name, data) }, isActionInterrupting));
        actionControllers.push({ dispose() {
          sleeper.bed?.DoWakeUp(true);
          setSleeperState(false);
          view.player.visible = true;
          playerAnimation.bindSleep(undefined);
          sleeper.dispose(); phase.dispose();
        } });
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
      const bookWorld: BookWorld = {
        root: view.scene, scheduler, weather, moon, getWatchWorldContent,
        spawnFx(prefab, { getPosition }) {
          const { x, z } = getPosition();
          if (isWorldFx(prefab)) worldFx.spawn(prefab, new Vector3(x, 0, z));
        },
      };
      const readActions = playerAnimation
        ? new ReadActionController(view, playerAnimation, locomotor, isActionInterrupting) : undefined;
      if (readActions) frameControllers.push(readActions);
      const playActions = playerAnimation
        ? new PlayActionController(view, playerAnimation, locomotor, isActionInterrupting) : undefined;
      if (playActions) frameControllers.push(playActions);
      const playInventoryInstrument = (slot: SlotAddress, entity: ItemEntity) => {
        const isValid = () => !entity.isRemoved && inventory.getEntity(slot) === entity;
        const skinArchive = entity.skinId === undefined ? undefined : GROUND_ITEM_DEFINITIONS[entity.prefab]?.skinArchives[entity.skinId];
        return playActions!.play({
          instrument: {
            prefab: entity.prefab, hasTag: tag => entity.hasTag(tag),
            ...(skinArchive ? { skinBuild: skinArchive.replace(/^dynamic\/|\.zip$/g, '') } : {}),
          },
          ...(skinArchive ? { skinArchive } : {}),
          isValid,
          // ACTIONS.PLAY.fn, then BufferedAction:Do's finiteuses:OnUsedAsItem.
          play: () => {
            if (!isValid()) return false;
            const played = entity.components.instrument!.Play(readerInst,
              range => FindEntities(view.scene!, player.position, range * TILE_SIZE / 4, undefined, ['FX', 'DECOR', 'INLIMBO']) as never[]);
            if (played) entity.components.finiteuses.useForAction('PLAY');
            return played;
          },
        });
      };
      const readInventoryBook = async (slot: SlotAddress, entity: ItemEntity) => {
        const isValid = () => !entity.isRemoved && inventory.getEntity(slot) === entity;
        const book = bookActionObject(entity);
        if (book.def?.fx && isWorldFx(book.def.fx)) await worldFx.prepare(book.def.fx);
        return readActions!.read({
          book, isValid,
          read: () => isValid() && (reader.Read(entity, bookWorld)?.[0] ?? false),
        });
      };

      if (playerAnimation) {
        view.registerFrameTask = registerFrontTask;
        const bugNet = new BugNetCaptureController(view, playerAnimation, locomotor,
          handEquipment,
          (model) => groundItems.getNetCaptureTargets(model),
          isActionInterrupting, TILE_SIZE / 4);
        actionControllers.push(bugNet);
        groundItems.setNetCaptureHandler(target => bugNet.request(target));

        // fishingrod.lua / pond.lua: the equipped rod fishes the pond's fishable component; a landed fish is a ground item.
        const fishingWorld = {
          landFish: (fish: { prefab: string }, position: Vector3) => {
            void groundItems.flingLoot([{ ...inventory.getItemSpec(fish.prefab), itemId: fish.prefab, count: 1 }], position)
              .catch((error: unknown) => console.error('Unable to land caught fish', error));
          },
        };
        const fishing = new FishingActionController(view, playerAnimation, locomotor, handEquipment,
          (model) => ponds.getFishTargets(model),
          () => {
            const entity = handEquipment.peek()?.entity;
            return entity instanceof ItemEntity && entity.prefab === FISHINGROD_ID && !entity.isRemoved
              ? getFishingRod(entity, scheduler, fishingWorld) : undefined;
          },
          isActionInterrupting);
        actionControllers.push(fishing);

        // player_common.lua: combat with UNARMED_DAMAGE, WILSON_ATTACK_PERIOD and DEFAULT_ATTACK_RANGE.
        const unit = TILE_SIZE / 4;
        const attackerInst: CombatActor = {
          getPosition: () => player.position,
          getPhysicsRadius: () => .5 * unit,
          hasTag: tag => tag === 'player' || tags.includes(tag),
          PushEvent: (name, data) => player.dispatchEvent({ type: name, data } as never),
          components: { health: {
            IsDead: () => playerStats.health.peek() <= 0,
            DoDelta: delta => {
              playerStats.health.set(playerStats.health.peek() + delta);
              return delta;
            },
          }, sanity: { doDelta: delta => playerStats.sanity.set(playerStats.sanity.peek() + delta) } },
        };
        const combat = new Combat(attackerInst, () => scheduler.now,
          () => equippedActionEntity(handEquipment.peek())?.components.weapon);
        combat.SetDefaultDamage(10);
        combat.SetAttackPeriod(.4);
        combat.SetRange(2 * unit);
        attackerInst.components.combat = combat;
        playerCombat = combat;
        playerAnimation.combat = combat;
        actionControllers.push(new AttackActionController(view, playerAnimation, locomotor, handEquipment,
          { inst: attackerInst, combat }, () => [...buildingPlacement.combatTargets, ...groundItems.combatTargets], isActionInterrupting, unit));
      }
      if (playerAnimation) {
        const spellcast = new SpellCastActionController(view, playerAnimation, locomotor, handEquipment, {
          position: player.position,
          hasTag: tag => player.userData.tags?.includes(tag) ?? false,
          components: { sanity: { doDelta: delta => playerStats.sanity.set(playerStats.sanity.peek() + delta) } },
        }, isActionInterrupting, (error) => console.error('Unable to cast spell', error),
        (model) => [...groundItems.getSpellTargets(model), ...buildingPlacement.getSpellTargets(model)]);

        const hammer = new HammerActionController(view, playerAnimation, locomotor,
          handEquipment,
          (model) => [...buildingPlacement.getHammerTargets(model), ...farmPlow.getHammerTargets(model), ...skeletons.getHammerTargets(model), ...houndbones.getHammerTargets(model), ...groundItems.getHammerTargets(model)],
          isActionInterrupting);
        const pickaxe = new PickaxeActionController(view, playerAnimation, locomotor,
          handEquipment, (model) => [...rockManager.getMineTargets(model), ...caveEntrances.getMineTargets(model), ...grottoPools.getMineTargets(model), ...marbleShrubs.getMineTargets(model), ...archiveProps.getMineTargets(model), ...groundItems.getMineTargets(model)], isActionInterrupting);
        const turfDeployment = new TurfDeployment(view, turfMap, playerAnimation, locomotor, () => {
          const address = cursorSlotAddress(), entity = inventory.getEntity(address);
          if (!entity || !turfTileName(entity.prefab)) return undefined;
          const isValid = () => !entity.isRemoved && inventory.getEntity(address) === entity;
          return { entity, isValid, take: () => isValid() ? inventory.extract(address, 1, entity) ?? undefined : undefined,
            putBack: item => { if (!inventory.receiveAt(address, item)) inventory.GiveItem(item); } };
        }, isActionInterrupting);
        const plantDeployment = new PlantDeployment(view, playerAnimation, locomotor, () => {
          const address = cursorSlotAddress(), entity = inventory.getEntity(address);
          if (!entity || !PLANTABLES[entity.prefab]) return undefined;
          const skinId = entity.skinId;
          const isValid = () => !entity.isRemoved && inventory.getEntity(address) === entity && entity.skinId === skinId;
          return { entity, isValid, take: () => isValid() ? inventory.extract(address, 1, entity) ?? undefined : undefined,
            putBack: item => { if (!inventory.receiveAt(address, item)) inventory.GiveItem(item); } };
        }, {
          plants: {
            marblebean_sapling: marbleBeanSaplings, rock_avocado_fruit_sprout_sapling: rockAvocadoSaplings,
            rock_avocado_bush: rockAvocadoBushes, monkeytail: monkeytails, berrybush: berrybushes,
            sapling: { prepareTransplant: () => saplings.prepareTransplant('sapling') },
            sapling_moon: { prepareTransplant: () => saplings.prepareTransplant('sapling_moon') },
            planted_flower: flowerPlanting, moonbutterfly_sapling: moonTreeForest,
          },
          canPlant: point => turfMap.canDeployPlantAtPoint(point),
        }, isActionInterrupting);
        const pitchfork = new PitchforkActionController(view, playerAnimation, locomotor,
          handEquipment, turfMap, isActionInterrupting);
        const farmHoe = new FarmHoeActionController(view, playerAnimation, locomotor,
          handEquipment, farmPlow, isActionInterrupting,
          (error) => console.error('Unable to till farm soil', error));
        const shovel = new ShovelActionController(view, playerAnimation, locomotor,
          handEquipment, (model) => [...farmPlow.getDigTargets(model), ...molehills.getDigTargets(model), ...marbleBeanSaplings.getDigTargets(model), ...rockAvocadoSaplings.getDigTargets(model), ...rockAvocadoBushes.getDigTargets(model), ...berrybushes.getDigTargets(model), ...monkeytails.getDigTargets(model), ...grasses.getDigTargets(model), ...saplings.getDigTargets(model), ...mushroomPlants.getDigTargets(model), ...moonTreeForest.getDigTargets(model), ...mushtrees.getDigTargets(model), ...evergreenForest.getDigTargets(model), ...deciduousForest.getDigTargets(model)], isActionInterrupting);
        const reskin = new ReskinActionController(view, playerAnimation, locomotor,
          handEquipment,
          (model) => [...buildingPlacement.getReskinTargets(model), ...groundItems.getReskinTargets(model), ...wormholes.getReskinTargets(model), ...berrybushes.getReskinTargets(model)], reskinEffects,
          isActionInterrupting, (error) => console.error('Unable to reskin target', error));
        const lighter = new LighterActionController(view, playerAnimation, locomotor, handEquipment, isActionInterrupting);
        const axe = new PickaxeActionController(view, playerAnimation, locomotor,
          handEquipment, (model) => [...moonTreeForest.getChopTargets(model), ...mushtrees.getChopTargets(model), ...evergreenForest.getChopTargets(model), ...deciduousForest.getChopTargets(model)], isActionInterrupting, 'CHOP');
        actionControllers.push(spellcast, hammer, pickaxe, axe, pitchfork, turfDeployment, plantDeployment, farmHoe, shovel, reskin, lighter);
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
          const definition: GroundItemDefinition = {
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
          // Load the art first, then let the animation's perform frame take the item and place it.
          void groundItems.prepareDrop(definition).then((prepared) => {
            const started = playerAnimation?.playDrop(
              () => prepared.commit(player.position.clone(), take), () => prepared.dispose());
            if (!started) prepared.dispose();
          }).catch((error: unknown) => {
            console.error(`Unable to drop ${stack.itemId}`, error);
          });
          return;
        }
        if (PLANTABLES[stack.itemId]) {
          if (!inventory.get(cursorSlotAddress())) inventory.transfer(slot, cursorSlotAddress(), stack.count);
          return;
        }
        const entity = inventory.getEntity(slot);
        if (playActions && entity && PlayActionController.canPlay(entity)) {
          void playInventoryInstrument(slot, entity).catch((error: unknown) => console.error(`Unable to play ${stack.itemId}`, error));
          return;
        }
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
      return {
        useFuel(slot: SlotAddress): boolean {
          const livestock = inventory.getEntity(slot), food = inventory.getEntity(cursorSlotAddress());
          if (itemUse && livestock?.hasTag('small_livestock') && food && livestock.components.eater?.CanEat(food)) {
            return itemUse.request('FEED', {
              prefab: livestock.prefab, model: player, components: livestock.components,
              hasTag: tag => livestock.hasTag(tag), addTag: tag => livestock.addTag(tag), removeTag: tag => livestock.removeTag(tag),
              getPosition: () => player.position,
              get isRemoved() { return livestock.isRemoved || inventory.getEntity(slot) !== livestock; },
            });
          }
          const entity = inventory.getEntity(slot), fuel = inventory.getEntity(cursorSlotAddress());
          if (!itemUse || !entity || !fuel?.components.fuel || !entity.components.fueled.CanAcceptFuelItem(fuel)) return false;
          return itemUse.request(fuel.GetIsWet() ? 'ADDWETFUEL' : 'ADDFUEL', {
            prefab: entity.prefab, model: player, components: entity.components,
            hasTag: tag => entity.hasTag(tag),
            addTag: tag => entity.addTag(tag),
            removeTag: tag => entity.removeTag(tag),
            getPosition: () => player.position,
            get isRemoved() { return entity.isRemoved || inventory.getEntity(slot) !== entity; },
          });
        },
        beginFood(slot: SlotAddress, itemId: string): boolean {
          if (!foodActions) return false;
          foodActions.begin(inventoryFoodSource(slot, itemId));
          return true;
        },
      };
    },
  };
}
