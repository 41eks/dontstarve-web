import { BufferedAction } from './bufferedaction';
import type { BrainComponents, BrainEntity } from '../../brains/src/types';
import type { Vector3 } from 'three';

export type MoleAction = 'GOHOME' | 'STEALMOLEBAIT' | 'MAKEMOLEHILL' | 'MOLEPEEK';
export interface MoleActionInst {
  readonly prefab: string;
  isValid(): boolean;
  PushEvent(name: string, data?: unknown): void;
  makeHome(): boolean;
}
/** A mole action's target as the action reads it: its validity and position, not its components. */
type ActionTarget = Omit<BrainEntity, 'components'>;
/** A bait item as molebrain.lua and ACTIONS.STEALMOLEBAIT read it: its components, its mark and its tasks. */
export interface MoleBaitTarget extends BrainEntity {
  /** target.selectedasmoletarget: a mole chose it; SelectedTargetTimeout clears it after five seconds. */
  selectedasmoletarget?: boolean;
  readonly components: BrainComponents & { inventoryitem?: { readonly owner: unknown }; burnable?: { IsBurning(): boolean } };
  DoTaskInTime(delay: number, fn: () => void): unknown;
  PushEvent(name: string, data?: unknown): void;
}
const moleAction = <Target extends ActionTarget>(inst: MoleActionInst, action: MoleAction, fn: () => boolean,
  valid: () => boolean, objects: { target?: Target; pos?: Vector3; distance: number }) =>
  new BufferedAction<MoleAction, Target>(action, fn, () => inst.isValid() && (!objects.target || objects.target.isValid()) && valid(), objects);

/** BufferedAction(inst, nil, ACTIONS.MAKEMOLEHILL, nil, pos). */
export function MakeMoleHillAction(inst: MoleActionInst, pos: Vector3, unit = 1): BufferedAction<MoleAction> {
  return moleAction(inst, 'MAKEMOLEHILL', () => inst.makeHome(), () => true, { pos, distance: 0 * unit });
}
/** BufferedAction(inst, nil, ACTIONS.MOLEPEEK). */
export function MolePeekAction(inst: MoleActionInst, unit = 1): BufferedAction<MoleAction> {
  return moleAction(inst, 'MOLEPEEK', () => { inst.PushEvent('peek'); return true; }, () => true, { distance: unit });
}
/**
 * molebrain.lua TakeBaitAction's BufferedAction(inst, target, ACTIONS.STEALMOLEBAIT): its validfn fails once the bait is
 * held or burning, and the fn clears the mark before bait.lua handles onstolen.
 */
export function StealMoleBaitAction<Bait extends MoleBaitTarget>(inst: MoleActionInst, bait: Bait, unit = 1): BufferedAction<MoleAction, Bait> {
  return moleAction(inst, 'STEALMOLEBAIT', () => {
    // conventions-allow prefab-id-branch: ACTIONS.STEALMOLEBAIT.fn itself tests act.doer.prefab == "mole".
    if (inst.prefab !== 'mole') return false;
    bait.selectedasmoletarget = undefined;
    bait.PushEvent('onstolen', { thief: inst });
    return true;
  }, () => !bait.components.inventoryitem?.owner && !bait.components.burnable?.IsBurning(), { target: bait, distance: .75 * unit });
}

/** molebrain.lua IsMoleBait: an item with a bait component, or a bell, that the brain may mark and steal. */
export function IsMoleBait(item: BrainEntity): item is MoleBaitTarget {
  return (item.components.bait !== undefined || item.hasTag('bell')) && 'DoTaskInTime' in item && 'PushEvent' in item;
}
