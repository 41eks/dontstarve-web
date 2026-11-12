import { BufferedAction } from './bufferedaction';
import type { BrainEntity } from '../../brains/src/types';
import type { Vector3 } from 'three';

export type MoleAction = 'GOHOME' | 'STEALMOLEBAIT' | 'MAKEMOLEHILL' | 'MOLEPEEK';
export interface MoleActionInst {
  isValid(): boolean;
  PushEvent(name: string, data?: unknown): void;
  makeHome(): boolean;
}
/** A mole action's target as the action reads it: its validity and position, not its components. */
type ActionTarget = Omit<BrainEntity, 'components'>;
export interface MoleBaitTarget extends BrainEntity {
  reserve(): boolean;
  releaseReservation(): void;
  isOnValidGround(): boolean;
  canSteal(): boolean;
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
/** BufferedAction(inst, target, ACTIONS.STEALMOLEBAIT): theft is an event handled by bait.lua, not direct item removal. */
export function StealMoleBaitAction<Bait extends MoleBaitTarget>(inst: MoleActionInst, bait: Bait, unit = 1): BufferedAction<MoleAction, Bait> {
  return moleAction(inst, 'STEALMOLEBAIT', () => { bait.releaseReservation(); bait.PushEvent('onstolen', { thief: inst }); return true; },
    () => bait.canSteal(), { target: bait, distance: .75 * unit });
}

/** Whether an entity FindEntity returned is a molebait target the mole can reserve and steal. */
export function isMoleBaitTarget(entity: BrainEntity): entity is MoleBaitTarget {
  return 'reserve' in entity && 'canSteal' in entity && 'isOnValidGround' in entity && 'releaseReservation' in entity;
}
