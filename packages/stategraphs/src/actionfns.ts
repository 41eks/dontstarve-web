import { isBlinkCaster } from '../../componets/src/blinkstaff';
import { BufferedAction } from './bufferedaction.ts';
import { Vector3 } from 'three';
import { snapToTileCenter, TILE_SIZE, WORLD_SCALE } from '../../prefab/src/tile';
import { performLightAction, performToolWork, type ComponentActionEntity, type ComponentActionTarget, type ToolAction } from './componentactions.ts';
import { preparePickReceiver } from './pick.ts';
import { canPickUp, performPickupAction, type PickupDoer } from './pickup.ts';
import { performRummageAction } from './rummage.ts';
import type { StewerHarvester } from '../../componets/src/stewer';
import { ItemEntity } from '../../inventory/src/entity';
import { PrefabInstance } from '../../prefab/src/prefabInstance';

/** act.target of the player's actions: a scene entity or an item, with the components actions.lua reaches on it. */
export type PlayerActionTarget = ComponentActionTarget & {
  /** EntityScript:GetDisplayName, for the action strings that name the item. */
  getDisplayName?(): string;
};

/** act.doer of the player's actions: the player, and the wortox.lua soul-hop functions it may have. */
export interface PlayerActionDoer extends PickupDoer {
  CanSoulhop?(): boolean;
  CanBlinkTo?(pos: Vector3): boolean;
  CanBlinkFromWithMap?(pos: Vector3): boolean;
  /** SGwilson's portal_jumpin, reached through the doer's sg. */
  readonly sg?: PickupDoer['sg'] & { beginPortalJump?(pos: Vector3, fromMap?: boolean): boolean };
}

/** BufferedAction(player, target, action, invobject): the target, the inventory item it is done with, and the player. */
export type PlayerAction<Action extends string = string> = BufferedAction<Action, PlayerActionTarget, ItemEntity, PlayerActionDoer>;

/** actions.lua ACTIONS.<id>.fn and validfn, for the actions the PlayerController buffers. */
interface ActionFns {
  fn(act: PlayerAction): boolean;
  validfn?(act: PlayerAction): boolean;
  /** actions.lua Action({ extra_arrive_dist }), added to the arrive distance when the walk starts. */
  extra_arrive_dist?(act: PlayerAction): number;
  /** actions.lua Action({ customarrivecheck }), replacing the locomotor's arrive distance. */
  customarrivecheck?(act: PlayerAction): boolean;
}

/** act.doer: every player action is made with its doer. */
function playerDoer(act: PlayerAction): PlayerActionDoer {
  if (!act.doer) throw new Error(`${act.action} has no doer`);
  return act.doer;
}
/** The components actions.lua reaches on act.target. */
const components = (act: PlayerAction): ComponentActionEntity['components'] => act.target?.components ?? {};

/** actions.lua ValidToolWork. */
function validToolWork(act: PlayerAction, action: ToolAction): boolean {
  const workable = act.target?.components.workable;
  return !!workable?.CanBeWorked() && workable.GetWorkAction() === action
    && !act.invobject?.components.equippable?.IsRestricted();
}

/** actions.lua DoToolWork: the workable is worked by the doer with the tool's effectiveness. */
function toolWork(action: ToolAction): ActionFns {
  return {
    fn: act => validToolWork(act, action) && !!act.target && performToolWork(action, act.target, playerDoer(act), act.invobject),
    validfn: act => validToolWork(act, action),
  };
}

/** stewer.lua / pickable.lua: a spawned product goes to the doer's inventory, dropped at the doer when full. */
function productReceiver(act: PlayerAction): StewerHarvester {
  const inventory = playerDoer(act).components.inventory;
  return { giveItem: (itemId, count, position) => !!inventory
    && inventory.GiveItem(inventory.entities.create({ itemId, count }), new Vector3(position.x, position.y, position.z)) };
}

/** actions.lua PICK.validfn: the pickable can be picked; SCENE.pickable already required the pickable tag. */
function canPick(act: PlayerAction): boolean {
  const target = act.target;
  return !!target && !!components(act).pickable?.canBePicked && target.hasTag('pickable') && !target.hasTag('fire') && !target.hasTag('intense');
}

/** BufferedAction:GetActionPoint: the action's pos, else its target's position. */
function actionPoint(act: PlayerAction): Vector3 {
  const pos = act.pos;
  if (pos) return new Vector3(pos.x, pos.y, pos.z);
  if (!act.target) throw new Error(`${act.action} has neither a point nor a target`);
  return act.target.getPosition();
}

/** BufferedAction:Do after a successful fn: invobject:OnUsedAsItem → finiteuses:OnUsedAsItem(action). */
function onUsedAsItem(act: PlayerAction): void {
  act.invobject?.components.finiteuses.useForAction?.(act.action);
}

/** actions.lua ACTIONS.DEPLOY.fn, which DEPLOY_TILEARRIVE shares. */
function deploy(act: PlayerAction): boolean {
    const item = act.invobject, doer = playerDoer(act), map = doer.Map;
    const point = actionPoint(act);
    if (!item || !map || !item.components.deployable?.CanDeploy(point, map)) return false;
    const inventory = doer.components.inventory, obj = inventory.RemoveItem(item);
    if (!obj) return false;
    if (obj.components.deployable?.Deploy(point, doer, map)) return true;
    inventory.GiveItem(obj);
    return false;
}

export const ACTION_FNS = {
  GIVE: {
    fn: act => {
      const item = act.invobject, trader = act.target?.components.trader;
      if (!item || !trader) return false;
      const inventory = playerDoer(act).components.inventory;
      return trader.AcceptGift(item, deleteItem => {
        const taken = inventory.RemoveItem(item);
        if (!taken) return false;
        if (deleteItem) taken.remove();
        return taken;
      }, act.doer);
    },
  },
  // The crop, grower, quagmire and doer's fertilizable branches are not ported, nor CHEVO_fertilized.
  FERTILIZE: {
    fn: act => {
      const item = act.invobject, fertilizer = item?.components.fertilizer, pickable = act.target?.components.pickable;
      if (!item || !fertilizer || !pickable?.CanBeFertilized() || !pickable.Fertilize(item, act.doer)) return false;
      fertilizer.OnApplied(act.doer, act.target);
      return true;
    },
  },
  BATHBOMB: {
    fn: act => {
      const item = act.invobject, bathbombable = act.target?.components.bathbombable, bathbomb = item?.components.bathbomb;
      if (!item || !bathbomb || !bathbombable?.can_be_bathbombed) return false;
      bathbombable.OnBathBombed(item, act.doer);
      playerDoer(act).components.inventory.RemoveItem(item)?.remove();
      return true;
    },
  },
  // The heavy-lifting body material and the forgerepairable branch are not ported.
  REPAIR: {
    fn: act => {
      const repairable = act.target?.components.repairable, material = act.invobject;
      return !!repairable && !!material?.components.repairer && repairable.Repair(act.doer, material);
    },
  },
  // The shaveable branch is not ported.
  SHAVE: {
    fn: act => {
      // act.target or else act.doer: the player has no beard component, so shaving oneself is not ported.
      const beard = act.target?.components.beard;
      if (!act.invobject?.components.shaver || !beard) return false;
      return beard.Shave(act.doer).ok;
    },
  },
  // Only the occupier branch is ported; container stores go through the container panels.
  STORE: {
    fn: act => {
      const item = act.invobject, occupiable = act.target?.components.occupiable;
      if (!item?.components.occupier || !occupiable?.CanOccupy(item)) return false;
      // inventoryitem:RemoveFromOwner(): the same inst leaves the doer's inventory.
      return occupiable.Occupy(playerDoer(act).components.inventory.RemoveItem(item) ?? undefined);
    },
  },
  FEED: {
    fn: act => {
      const item = act.invobject, eater = act.target?.components.eater;
      return !!item && !!eater && eater.CanEat(item) && eater.Eat(item, act.doer);
    },
  },
  ADDFUEL: { fn: addFuel },
  ADDWETFUEL: { fn: addFuel },
  DEPLOY: {
    // actions.lua ExtraDeployDist: a doer on land reaches a target it cannot walk onto. The projectile and
    // void branches and inst.extra_deploy_distance have no ported user.
    extra_arrive_dist: act => {
      const map = playerDoer(act).Map, item = act.invobject, target = actionPoint(act);
      if (!map || !item || !map.isPassableAtPoint(playerDoer(act).position)) return 0;
      if (!map.isOceanTileAtPoint(target) || map.isPassableAtPoint(target)) return 0;
      return (item.hasTag('usedeployspacingasoffset') ? item.components.deployable?.spacing ?? 0 : 0) + WORLD_SCALE;
    },
    fn: deploy,
  },
  DEPLOY_TILEARRIVE: {
    fn: deploy,
    // actions.lua CheckTileWithinRange: anywhere on the target's tile.
    customarrivecheck: act => {
      const center = snapToTileCenter(actionPoint(act)), doer = playerDoer(act).position;
      return Math.abs(center.x - doer.x) <= TILE_SIZE / 2 && Math.abs(center.z - doer.z) <= TILE_SIZE / 2;
    },
  },
  PLANTSOIL: {
    fn: act => {
      const inventory = playerDoer(act).components.inventory;
      const soil = act.target;
      if (!act.invobject || !(soil instanceof PrefabInstance) || !soil.hasTag('soil')) return false;
      const seed = inventory.RemoveItem(act.invobject);
      if (!seed) return false;
      if (seed.components.farmplantable?.Plant(soil, act.doer)) return true;
      inventory.GiveItem(seed);
      return false;
    },
  },
  CHOP: toolWork('CHOP'),
  MINE: toolWork('MINE'),
  HAMMER: toolWork('HAMMER'),
  DIG: toolWork('DIG'),
  NET: toolWork('NET'),
  PICK: {
    // pickable:Pick(act.doer) spawns the product for the picker.
    fn: act => {
      const pickable = components(act).pickable;
      if (!pickable) return false;
      const receiver = pickable.product ? preparePickReceiver(playerDoer(act), pickable.product, pickable.numToHarvest ?? 1,
        pickable.productEntity) : { picker: playerDoer(act), giveItem: () => false, dispose: () => {} };
      try { return pickable.pick(receiver); } finally { receiver.dispose(); }
    },
    validfn: canPick,
  },
  PICKUP: {
    fn: act => {
      const inst = act.target;
      return inst instanceof ItemEntity && performPickupAction(inst, playerDoer(act));
    },
    validfn: act => { const inst = act.target; return inst instanceof ItemEntity && canPickUp(inst); },
  },
  HARVEST: {
    // The crop, harvestable and dryer branches are not ported.
    fn: act => {
      const { stewer, occupiable } = components(act);
      if (stewer) return stewer.Harvest(productReceiver(act));
      const item = occupiable?.Harvest();
      if (item === undefined) return false;
      playerDoer(act).components.inventory.GiveItem(item, actionPoint(act));
      return true;
    },
    validfn: act => {
      const { stewer, occupiable } = components(act);
      return stewer ? stewer.IsDone() && !act.target?.hasTag('burnt') : occupiable?.IsOccupied() === true;
    },
  },
  TAKEITEM: {
    fn: act => {
      const shelf = components(act).shelf, source = actionPoint(act);
      if (!shelf?.cantakeitem) return false;
      shelf.TakeItem({ GiveItem: (item: ItemEntity) => playerDoer(act).components.inventory.GiveItem(item, source) });
      return true;
    },
  },
  TURNON: {
    fn: act => {
      const machine = components(act).machine;
      if (!machine || machine.IsOn()) return false;
      machine.TurnOn();
      return true;
    },
  },
  TURNOFF: {
    fn: act => {
      const machine = components(act).machine;
      if (!machine?.IsOn()) return false;
      machine.TurnOff();
      return true;
    },
  },
  RUMMAGE: { fn: act => !!act.target && performRummageAction(act.target, playerDoer(act)) },
  // ACTIONS.INCINERATE.fn: the target's incinerator burns what its container holds.
  INCINERATE: { fn: act => act.target?.components.incinerator?.Incinerate(playerDoer(act)) ?? false },
  LOOKAT: {
    // ACTIONS.LOOKAT.fn without closeinspector, which has no port.
    fn: act => {
      const doer = playerDoer(act), inspectable = (act.target ?? act.invobject)?.components.inspectable;
      const desc = inspectable?.GetDescription(doer);
      if (desc === undefined) return false;
      doer.components.talker?.Say(desc, undefined, inspectable?.noanim);
      return true;
    },
  },
  SLEEPIN: {
    // sleepingbag:DoSleep(act.doer) hands the bed to the doer's sleepingbaguser.
    fn: act => {
      const bag = components(act).sleepingbag, sleeper = playerDoer(act).components.sleepingbaguser;
      if (!bag || !sleeper) return false;
      bag.DoSleep(sleeper);
      return true;
    },
    validfn: act => {
      const { sleepingbag, finiteuses } = components(act);
      return !!sleepingbag && !sleepingbag.InUse() && !act.target?.hasTag('burnt') && (finiteuses?.GetUses?.() ?? 1) > 0;
    },
  },
  MIGRATE: {
    fn: act => components(act).worldmigrator?.Activate(playerDoer(act)) ?? false,
    validfn: act => !!act.target?.hasTag('migrator'),
  },
  ATTACK: {
    // The propattack, thrusting and helmsplitting branches are not ported; combat:DoAttack uses the equipped weapon.
    fn: act => { if (act.target) playerDoer(act).components.combat?.DoAttack(act.target); return true; },
    validfn: act => {
      const combat = playerDoer(act).components.combat, target = act.target;
      return !!combat && !!target && !target.hasTag('stealth') && (combat.CanTarget(target)
        || combat.CanExtinguishTarget(target, act.invobject?.components.weapon)
        || combat.CanLightTarget(target, act.invobject?.components.weapon));
    },
  },
  CASTSPELL: {
    // spellcaster:CanCast, then CastSpell at the action point; the item mimic and crushitemcast checks are not ported.
    fn: act => {
      // A cast from the inventory has neither a point nor a target: GetActionPoint() is nil.
      const spellcaster = act.invobject?.components.spellcaster, point = act.pos || act.target ? actionPoint(act) : undefined;
      if (!spellcaster?.canCast(playerDoer(act), act.target, point)) return false;
      return spellcaster.castSpell(act.target, point, playerDoer(act));
    },
    validfn: act => !act.target?.hasTag('nomagic'),
  },
  LIGHT: {
    fn: act => !!act.invobject && !!act.target
      && performLightAction(act.invobject, act.target, playerDoer(act)),
  },
  FISH: {
    fn: act => { if (act.target) act.invobject?.components.fishingrod?.StartFishing(act.target, playerDoer(act)); return true; },
  },
  REEL: {
    fn: act => {
      const rod = act.invobject?.components.fishingrod;
      if (rod?.IsFishing()) {
        if (rod.HasHookedFish()) rod.Reel();
        else if (rod.FishIsBiting()) rod.Hook();
        else rod.StopFishing();
      }
      return true;
    },
  },
  TERRAFORM: {
    fn: act => act.invobject?.components.terraformer?.Terraform(actionPoint(act), playerDoer(act)) ?? false,
  },
  TILL: {
    fn: act => act.invobject?.components.farmtiller?.Till(actionPoint(act), playerDoer(act)) ?? false,
  },
  // The invobject's blinkstaff:Blink; otherwise TryToSoulhop: in portal_jumpin_pre the doer's TryToPortalHop spends
  // its souls and the stategraph enters portal_jumpin. The item mimic check is not ported.
  BLINK: {
    fn: act => {
      const blinkstaff = act.invobject?.components.blinkstaff;
      const doer = playerDoer(act);
      if (act.invobject) return !!blinkstaff && isBlinkCaster(doer) && blinkstaff.Blink(actionPoint(act), doer);
      return act.doer?.sg?.beginPortalJump?.(actionPoint(act)) ?? false;
    },
    validfn: act => !!act.invobject || (!!act.doer?.CanSoulhop?.() && !!act.doer.CanBlinkTo?.(actionPoint(act))),
  },
  BLINK_MAP: {
    fn: act => act.doer?.sg?.beginPortalJump?.(actionPoint(act), true) ?? false,
    validfn: act => !!act.doer?.CanSoulhop?.() && !!act.doer.CanBlinkFromWithMap?.(actionPoint(act)),
  },
  // The souleater and oceanfishable branches are not ported.
  EAT: {
    fn: act => {
      const obj = act.target ?? act.invobject, eater = act.doer?.components.eater;
      return !!obj?.components.edible && !!eater && eater.Eat(obj, act.doer);
    },
  },
  PLAY: {
    fn: act => {
      const instrument = act.invobject?.components.instrument;
      if (!instrument?.Play(act.doer)) return false;
      onUsedAsItem(act);
      return true;
    },
  },
  // The simplebook branch is not ported.
  READ: {
    fn: act => {
      const targ = act.target ?? act.invobject, reader = act.doer?.components.reader;
      return !!targ?.components.book && !!reader && (reader.Read(targ)?.[0] ?? false);
    },
  },
  HAUNT: {
    fn: act => {
      const target = act.target, hauntable = components(act).hauntable;
      if (!target || !hauntable || target.components.inventoryitem?.owner || target.hasTag('haunted') || target.hasTag('catchable') || target.hasTag('INLIMBO')) return false;
      playerDoer(act).PushEvent('haunt', { target });
      hauntable.DoHaunt(playerDoer(act));
      return true;
    },
    validfn: act => !components(act).hauntable?.IsHaunted(),
  },
} satisfies Readonly<Record<string, ActionFns>>;

/** The actions.lua actions whose fn is ported, which the player's controller can buffer. */
export type PlayerActionId = keyof typeof ACTION_FNS;

/** actions.lua ADDFUEL: detach one live item; return rejected fuel to the active stack or inventory. */
function addFuel(act: PlayerAction): boolean {
  const source = act.invobject;
  if (!source) return false;
  const inventory = playerDoer(act).components.inventory;
  const fuel = inventory.RemoveItem(source);
  if (!fuel) return false;
  if (act.target?.components.fueled?.TakeFuelItem(fuel, act.doer)) return true;
  const held = source.components.inventoryitem.slot;
  if (fuel === source || inventory.GetActiveItem() !== source || !held || !inventory.receiveAt(held.address, fuel)) {
    inventory.GiveItem(fuel);
  }
  return false;
}

export function hasActionFn(action: string): action is PlayerActionId { return Object.hasOwn(ACTION_FNS, action); }

function actionFns(action: string): ActionFns | undefined { return hasActionFn(action) ? ACTION_FNS[action] : undefined; }

/** locomotor.lua: action.extra_arrive_dist(doer, dest, bufferedaction). */
/** locomotor.lua OnUpdate: action.customarrivecheck(doer, dest, bufferedaction), when the action has one. */
export function customArriveCheck(act: PlayerAction): (() => boolean) | undefined {
  const check = actionFns(act.action)?.customarrivecheck;
  return check && (() => check(act));
}

export function extraArriveDist(act: PlayerAction): number { return actionFns(act.action)?.extra_arrive_dist?.(act) ?? 0; }

/**
 * bufferedaction.lua BufferedAction(doer, target, action, invobject): Do runs ACTIONS[action].fn, and IsValid
 * requires the invobject and target to be valid, then the caller's validfn and the action's validfn.
 */
export function createBufferedAction<Action extends string>(action: Action, objects: {
  readonly doer: PlayerActionDoer;
  readonly pos?: { readonly x: number; readonly y: number; readonly z: number };
  readonly target?: PlayerActionTarget;
  readonly invobject?: ItemEntity;
}, validfn: () => boolean = () => true): PlayerAction<Action> {
  const fns = actionFns(action);
  if (!fns) throw new Error(`No actions.lua fn ported for ${action}`);
  const buffered: PlayerAction<Action> = new BufferedAction(action, () => fns.fn(buffered),
    () => !objects.invobject?.isRemoved && !objects.target?.isRemoved && validfn() && (fns.validfn?.(buffered) ?? true),
    objects);
  return buffered;
}
