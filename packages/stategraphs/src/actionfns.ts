import { BufferedAction, type BufferedActionDoer, type BufferedActionObject } from './bufferedaction.ts';
import { Vector3 } from 'three';
import { performToolWork, type ComponentActionEntity, type ToolAction } from './componentactions.ts';
import { preparePickReceiver, type PickableComponent } from './pick.ts';
import { performPickupAction, type PickupDoer, type PickupTarget } from './pickup.ts';
import { performRummageAction, type RummageContainer, type RummageTarget } from './rummage.ts';
import type { Stewer, StewerHarvester } from '../../componets/src/stewer';
import type { SleepingBag } from '../../componets/src/sleepingbag';
import type { WorldMigrator } from '../../componets/src/worldmigrator';
import type { Hauntable } from '../../componets/src/hauntable';

/** actions.lua ACTIONS.<id>.fn and validfn, for the actions the PlayerController buffers. */
interface ActionFns {
  fn(act: BufferedAction): boolean;
  validfn?(act: BufferedAction): boolean;
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

export const ACTION_FNS: Readonly<Partial<Record<string, ActionFns>>> = {
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

export function hasActionFn(action: string): boolean { return ACTION_FNS[action] !== undefined; }

/**
 * bufferedaction.lua BufferedAction(doer, target, action, invobject): Do runs ACTIONS[action].fn, and IsValid
 * requires the invobject and target to be valid, then the caller's validfn and the action's validfn.
 */
export function createBufferedAction<Action extends string>(action: Action, objects: {
  readonly doer: BufferedActionDoer;
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
