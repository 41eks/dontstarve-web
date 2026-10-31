import { BufferedAction, type BufferedActionDoer, type BufferedActionObject } from './bufferedaction.ts';
import { performToolWork, type ComponentActionEntity, type ToolAction } from './componentactions.ts';

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

export const ACTION_FNS: Readonly<Partial<Record<string, ActionFns>>> = {
  CHOP: toolWork('CHOP'),
  MINE: toolWork('MINE'),
  HAMMER: toolWork('HAMMER'),
  DIG: toolWork('DIG'),
  NET: toolWork('NET'),
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
