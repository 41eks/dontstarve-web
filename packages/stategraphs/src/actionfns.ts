import { BufferedAction, type BufferedActionDoer, type BufferedActionObject } from './bufferedaction.ts';
import { Vector3 } from 'three';
import { snapToTileCenter, TILE_SIZE, WORLD_SCALE } from '../../prefab/src/tile';
import { performLightAction, performToolWork, type ComponentActionEntity, type ToolAction } from './componentactions.ts';
import type { Combat } from '../../componets/src/combat';
import type { Weapon } from '../../componets/src/weapon';
import type { SpellCasterComponent } from '../../componets/src/spellcaster';
import type { FishingRod } from '../../componets/src/fishingrod';
import type { Terraformer } from '../../componets/src/terraformer';
import type { FarmTiller } from '../../componets/src/farmtiller';
import { preparePickReceiver, type PickableComponent } from './pick.ts';
import { performPickupAction, type PickupDoer, type PickupTarget } from './pickup.ts';
import { performRummageAction, type RummageContainer, type RummageTarget } from './rummage.ts';
import type { Stewer, StewerHarvester } from '../../componets/src/stewer';
import type { SleepingBag } from '../../componets/src/sleepingbag';
import type { WorldMigrator } from '../../componets/src/worldmigrator';
import type { Hauntable } from '../../componets/src/hauntable';
import type { ItemEntity } from '../../inventory/src/entity';
import type { FarmSoil } from '../../componets/src/farmplantable';

/** actions.lua ACTIONS.<id>.fn and validfn, for the actions the PlayerController buffers. */
interface ActionFns {
  fn(act: BufferedAction): boolean;
  validfn?(act: BufferedAction): boolean;
  /** actions.lua Action({ extra_arrive_dist }), added to the arrive distance when the walk starts. */
  extra_arrive_dist?(act: BufferedAction): number;
  /** actions.lua Action({ customarrivecheck }), replacing the locomotor's arrive distance. */
  customarrivecheck?(act: BufferedAction): boolean;
}

/** The picker hands components' entities to the action; actions.lua reaches their components. */
const entity = (object: BufferedActionObject | undefined) => object as ComponentActionEntity | undefined;

/** actions.lua ValidToolWork. */
function validToolWork(act: BufferedAction, action: ToolAction): boolean {
  const workable = entity(act.target)?.components.workable;
  return !!workable?.CanBeWorked() && workable.GetWorkAction() === action
    && !entity(act.invobject)?.components.equippable?.IsRestricted();
}

/** actions.lua DoToolWork: the workable is worked by the doer with the tool's effectiveness. */
function toolWork(action: ToolAction): ActionFns {
  return {
    fn: act => validToolWork(act, action) && performToolWork(action, entity(act.target)!, act.doer ?? {}, entity(act.invobject)),
    validfn: act => validToolWork(act, action),
  };
}

/** The scene components the ported fns call, read off the target entity. */
interface SceneComponents {
  pickable?: PickableComponent;
  stewer?: Stewer;
  occupiable?: { IsOccupied(): boolean; Harvest(): unknown };
  shelf?: { readonly cantakeitem: boolean; TakeItem(taker: { GiveItem(item: unknown): boolean }): boolean };
  machine?: { IsOn(): boolean; TurnOn(): void; TurnOff(): void };
  container?: RummageContainer;
  sleepingbag?: SleepingBag;
  worldmigrator?: WorldMigrator;
  hauntable?: Hauntable;
  finiteuses?: { GetUses(): number };
}
const components = (act: BufferedAction) => (act.target as { components?: SceneComponents } | undefined)?.components ?? {};
const playerDoer = (act: BufferedAction) => act.doer as PickupDoer;
const targetPosition = (act: BufferedAction) => (act.target as unknown as { getPosition(): Vector3 }).getPosition();

/** stewer.lua / pickable.lua: a spawned product goes to the doer's inventory, dropped at the doer when full. */
function productReceiver(act: BufferedAction): StewerHarvester {
  const inventory = playerDoer(act).components.inventory;
  return { giveItem: (itemId, count, position) => !!inventory
    && inventory.GiveItem(inventory.entities.create({ itemId, count }), new Vector3(position.x, position.y, position.z)) };
}

/** actions.lua PICK.validfn: the pickable can be picked; SCENE.pickable already required the pickable tag. */
function canPick(act: BufferedAction): boolean {
  const target = act.target!;
  return !!components(act).pickable?.canBePicked && target.hasTag('pickable') && !target.hasTag('fire') && !target.hasTag('intense');
}

/** BufferedAction:GetActionPoint: the action's pos, else its target's position. */
function actionPoint(act: BufferedAction): Vector3 {
  const pos = act.pos;
  return pos ? new Vector3(pos.x, pos.y, pos.z) : targetPosition(act);
}

/** The doer's combat, as ATTACK and the weapon's RANGEDLIGHT reach it. */
type DoerCombat = Pick<Combat, 'DoAttack' | 'CanTarget' | 'CanLightTarget'>;
const doerCombat = (act: BufferedAction) => (act.doer as { components?: { combat?: DoerCombat } } | undefined)?.components?.combat;
const invobjectComponents = (act: BufferedAction) =>
  (act.invobject as { components?: { spellcaster?: SpellCasterComponent; weapon?: Weapon; fishingrod?: FishingRod } } | undefined)?.components ?? {};

/** wortox.lua puts CanSoulhop / CanBlinkTo on the inst; SGwilson's portal_jumpin is reached through its sg. */
type SoulHopper = {
  CanSoulhop?(): boolean;
  CanBlinkTo?(pos: Vector3): boolean;
  CanBlinkFromWithMap?(pos: Vector3): boolean;
  readonly sg?: { beginPortalJump?(pos: Vector3, fromMap?: boolean): boolean };
};
const soulHopper = (act: BufferedAction) => act.doer as SoulHopper | undefined;

/** The doer's reader.lua component, which reads a book with the world it was given. */
type DoerReader = { Read(book: BufferedActionObject): readonly [boolean, string?] | undefined };
const doerReader = (act: BufferedAction) => (act.doer as { components?: { reader?: DoerReader } } | undefined)?.components?.reader;
/** The doer's eater.lua component. */
type DoerEater = { Eat(food: BufferedActionObject, feeder?: unknown): boolean };
const doerEater = (act: BufferedAction) => (act.doer as { components?: { eater?: DoerEater } } | undefined)?.components?.eater;
type InventoryUseComponents = {
  edible?: object;
  instrument?: { Play(musician: unknown): boolean };
  book?: object;
  finiteuses?: { useForAction?(action: string): boolean };
};
const inventoryComponents = (object: BufferedActionObject | undefined) =>
  (object as { components?: InventoryUseComponents } | undefined)?.components ?? {};

/** BufferedAction:Do after a successful fn: invobject:OnUsedAsItem → finiteuses:OnUsedAsItem(action). */
function onUsedAsItem(act: BufferedAction): void {
  inventoryComponents(act.invobject).finiteuses?.useForAction?.(act.action);
}

/** actions.lua ACTIONS.DEPLOY.fn, which DEPLOY_TILEARRIVE shares. */
function deploy(act: BufferedAction): boolean {
    const item = act.invobject as ItemEntity | undefined, doer = playerDoer(act), map = doer.Map;
    const point = actionPoint(act);
    if (!item || !map || !item.components.deployable?.CanDeploy(point, map)) return false;
    const inventory = doer.components.inventory, obj = inventory.RemoveItem(item);
    if (!obj) return false;
    if (obj.components.deployable!.Deploy(point, doer, map)) return true;
    inventory.GiveItem(obj);
    return false;
}

export const ACTION_FNS: Readonly<Partial<Record<string, ActionFns>>> = {
  GIVE: {
    fn: act => {
      const item = act.invobject as ItemEntity | undefined, trader = entity(act.target)?.components.trader;
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
      const fertilizer = entity(act.invobject)?.components.fertilizer, pickable = entity(act.target)?.components.pickable;
      if (!fertilizer || !pickable?.CanBeFertilized() || !pickable.Fertilize(act.invobject as ItemEntity, act.doer)) return false;
      fertilizer.OnApplied(act.doer, act.target);
      return true;
    },
  },
  BATHBOMB: {
    fn: act => {
      const bathbombable = entity(act.target)?.components.bathbombable, bathbomb = entity(act.invobject)?.components.bathbomb;
      if (!bathbomb || !bathbombable?.can_be_bathbombed) return false;
      bathbombable.OnBathBombed(act.invobject, act.doer);
      playerDoer(act).components.inventory.RemoveItem(act.invobject as ItemEntity)?.remove();
      return true;
    },
  },
  // The heavy-lifting body material and the forgerepairable branch are not ported.
  REPAIR: {
    fn: act => {
      const repairable = entity(act.target)?.components.repairable, material = act.invobject as ItemEntity | undefined;
      return !!repairable && !!material?.components.repairer && repairable.Repair(act.doer, material);
    },
  },
  // The shaveable branch is not ported.
  SHAVE: {
    fn: act => {
      const shavee = (act.target ?? act.doer) as ComponentActionEntity | undefined;
      if (!act.invobject || !entity(act.invobject)?.components.shaver || !shavee?.components.beard) return false;
      return shavee.components.beard.Shave(act.doer).ok;
    },
  },
  // Only the occupier branch is ported; container stores go through the container panels.
  STORE: {
    fn: act => {
      const item = act.invobject as ItemEntity | undefined, occupiable = entity(act.target)?.components.occupiable;
      if (!item?.components.occupier || !occupiable?.CanOccupy(item)) return false;
      // inventoryitem:RemoveFromOwner(): the same inst leaves the doer's inventory.
      return occupiable.Occupy(playerDoer(act).components.inventory.RemoveItem(item));
    },
  },
  FEED: {
    fn: act => {
      const item = act.invobject as ItemEntity | undefined, eater = entity(act.target)?.components.eater;
      return !!item && !!eater && eater.CanEat(item) && eater.Eat(item, act.doer);
    },
  },
  ADDFUEL: { fn: addFuel },
  ADDWETFUEL: { fn: addFuel },
  DEPLOY: {
    // actions.lua ExtraDeployDist: a doer on land reaches a target it cannot walk onto. The projectile and
    // void branches and inst.extra_deploy_distance have no ported user.
    extra_arrive_dist: act => {
      const map = playerDoer(act).Map, item = act.invobject as ItemEntity | undefined, target = actionPoint(act);
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
      if (!act.invobject || !act.target?.hasTag('soil')) return false;
      const seed = inventory.RemoveItem(act.invobject as ItemEntity);
      if (!seed) return false;
      if (seed.components.farmplantable?.Plant(act.target as unknown as FarmSoil, act.doer)) return true;
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
      const target = (act.target as { pickupTarget?: PickupTarget } | undefined)?.pickupTarget;
      return !!target && performPickupAction(target, playerDoer(act));
    },
    // The item's owner registers its pickup view while it lies in the world.
    validfn: act => (act.target as { pickupTarget?: PickupTarget } | undefined)?.pickupTarget?.isValid() === true,
  },
  HARVEST: {
    // The crop, harvestable and dryer branches are not ported.
    fn: act => {
      const { stewer, occupiable } = components(act);
      if (stewer) return stewer.Harvest(productReceiver(act));
      const item = occupiable?.Harvest();
      if (item === undefined) return false;
      playerDoer(act).components.inventory.GiveItem(item as never, targetPosition(act));
      return true;
    },
    validfn: act => {
      const { stewer, occupiable } = components(act);
      return stewer ? stewer.IsDone() && !act.target!.hasTag('burnt') : occupiable?.IsOccupied() === true;
    },
  },
  TAKEITEM: {
    fn: act => {
      const shelf = components(act).shelf, source = targetPosition(act);
      if (!shelf?.cantakeitem) return false;
      shelf.TakeItem({ GiveItem: item => playerDoer(act).components.inventory.GiveItem(item as never, source) });
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
  RUMMAGE: { fn: act => performRummageAction(act.target as RummageTarget, playerDoer(act)) },
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
      return !!sleepingbag && !sleepingbag.InUse() && !act.target!.hasTag('burnt') && (finiteuses?.GetUses() ?? 1) > 0;
    },
  },
  MIGRATE: {
    fn: act => components(act).worldmigrator?.Activate(playerDoer(act)) ?? false,
    validfn: act => act.target!.hasTag('migrator'),
  },
  ATTACK: {
    // The propattack, thrusting and helmsplitting branches are not ported; combat:DoAttack uses the equipped weapon.
    fn: act => { doerCombat(act)?.DoAttack(act.target as never); return true; },
    validfn: act => {
      const combat = doerCombat(act), target = act.target as never;
      return !!combat && !act.target!.hasTag('stealth') && (combat.CanTarget(target)
        || combat.CanLightTarget(target, invobjectComponents(act).weapon as never));
    },
  },
  CASTSPELL: {
    // spellcaster:CanCast, then CastSpell at the action point; the item mimic and crushitemcast checks are not ported.
    fn: act => {
      const spellcaster = invobjectComponents(act).spellcaster, point = actionPoint(act);
      if (!spellcaster?.canCast(playerDoer(act), act.target, point)) return false;
      return spellcaster.castSpell(act.target, point, playerDoer(act));
    },
    validfn: act => !act.target?.hasTag('nomagic'),
  },
  LIGHT: {
    fn: act => !!act.invobject && !!act.target
      && performLightAction(act.invobject as ComponentActionEntity, act.target as ComponentActionEntity, playerDoer(act) as never),
  },
  FISH: {
    fn: act => { invobjectComponents(act).fishingrod?.StartFishing(act.target as never, playerDoer(act)); return true; },
  },
  REEL: {
    fn: act => {
      const rod = invobjectComponents(act).fishingrod;
      if (rod?.IsFishing()) {
        if (rod.HasHookedFish()) rod.Reel();
        else if (rod.FishIsBiting()) rod.Hook();
        else rod.StopFishing();
      }
      return true;
    },
  },
  TERRAFORM: {
    fn: act => (act.invobject as { components?: { terraformer?: Terraformer } } | undefined)?.components?.terraformer
      ?.Terraform(actionPoint(act), playerDoer(act)) ?? false,
  },
  TILL: {
    fn: act => (act.invobject as { components?: { farmtiller?: FarmTiller } } | undefined)?.components?.farmtiller
      ?.Till(actionPoint(act), playerDoer(act)) ?? false,
  },
  // TryToSoulhop: in portal_jumpin_pre the doer's TryToPortalHop spends its souls and the stategraph enters
  // portal_jumpin; the blinkstaff (invobject) branch is not ported.
  BLINK: {
    fn: act => soulHopper(act)?.sg?.beginPortalJump?.(actionPoint(act)) ?? false,
    validfn: act => !!soulHopper(act)?.CanSoulhop?.() && !!soulHopper(act)?.CanBlinkTo?.(actionPoint(act)),
  },
  BLINK_MAP: {
    fn: act => soulHopper(act)?.sg?.beginPortalJump?.(actionPoint(act), true) ?? false,
    validfn: act => !!soulHopper(act)?.CanSoulhop?.() && !!soulHopper(act)?.CanBlinkFromWithMap?.(actionPoint(act)),
  },
  // The souleater and oceanfishable branches are not ported.
  EAT: {
    fn: act => {
      const obj = act.target ?? act.invobject, eater = doerEater(act);
      return !!obj && !!inventoryComponents(obj).edible && !!eater && eater.Eat(obj, act.doer);
    },
  },
  PLAY: {
    fn: act => {
      const instrument = inventoryComponents(act.invobject).instrument;
      if (!instrument?.Play(act.doer)) return false;
      onUsedAsItem(act);
      return true;
    },
  },
  // The simplebook branch is not ported.
  READ: {
    fn: act => {
      const targ = act.target ?? act.invobject, reader = doerReader(act);
      return !!targ && !!act.doer && !!inventoryComponents(targ).book && !!reader && (reader.Read(targ)?.[0] ?? false);
    },
  },
  HAUNT: {
    fn: act => {
      const target = act.target!, hauntable = components(act).hauntable;
      const held = (target as { components?: { inventoryitem?: { owner?: unknown } } }).components?.inventoryitem?.owner;
      if (!hauntable || held || target.hasTag('haunted') || target.hasTag('catchable') || target.hasTag('INLIMBO')) return false;
      playerDoer(act).PushEvent('haunt', { target });
      hauntable.DoHaunt(playerDoer(act));
      return true;
    },
    validfn: act => !components(act).hauntable?.IsHaunted(),
  },
};

/** actions.lua ADDFUEL: detach one live item; return rejected fuel to the active stack or inventory. */
function addFuel(act: BufferedAction): boolean {
  if (!act.invobject) return false;
  const inventory = playerDoer(act).components.inventory;
  const source = act.invobject as ItemEntity;
  const fuel = inventory.RemoveItem(source);
  if (!fuel) return false;
  if (entity(act.target)?.components.fueled?.TakeFuelItem(fuel, act.doer)) return true;
  const owner = source.components.inventoryitem.owner;
  if (fuel === source || inventory.GetActiveItem() !== source || !owner || !inventory.receiveAt(owner.address, fuel)) {
    inventory.GiveItem(fuel);
  }
  return false;
}

export function hasActionFn(action: string): boolean { return ACTION_FNS[action] !== undefined; }

/** locomotor.lua: action.extra_arrive_dist(doer, dest, bufferedaction). */
/** locomotor.lua OnUpdate: action.customarrivecheck(doer, dest, bufferedaction), when the action has one. */
export function customArriveCheck(act: BufferedAction): (() => boolean) | undefined {
  const check = ACTION_FNS[act.action]?.customarrivecheck;
  return check && (() => check(act));
}

export function extraArriveDist(act: BufferedAction): number { return ACTION_FNS[act.action]?.extra_arrive_dist?.(act) ?? 0; }

/**
 * bufferedaction.lua BufferedAction(doer, target, action, invobject): Do runs ACTIONS[action].fn, and IsValid
 * requires the invobject and target to be valid, then the caller's validfn and the action's validfn.
 */
export function createBufferedAction<Action extends string>(action: Action, objects: {
  readonly doer: BufferedActionDoer;
  readonly pos?: { readonly x: number; readonly y: number; readonly z: number };
  readonly target?: BufferedActionObject & { readonly isRemoved?: boolean };
  readonly invobject?: BufferedActionObject & { readonly isRemoved?: boolean };
}, validfn: () => boolean = () => true): BufferedAction<Action> {
  const fns = ACTION_FNS[action];
  if (!fns) throw new Error(`No actions.lua fn ported for ${action}`);
  const buffered: BufferedAction<Action> = new BufferedAction(action, () => fns.fn(buffered),
    () => !objects.invobject?.isRemoved && !objects.target?.isRemoved && validfn() && (fns.validfn?.(buffered) ?? true),
    objects);
  return buffered;
}
