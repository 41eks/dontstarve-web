import { BufferedAction } from './bufferedaction';
import type { BrainEntity } from '../../brains/src/types';
import type { Vector3 } from 'three';

export type MoleAction = 'GOHOME' | 'STEALMOLEBAIT' | 'MAKEMOLEHILL' | 'MOLEPEEK';
export interface MoleActionInst {
  isValid(): boolean;
  PushEvent(name: string, data?: unknown): void;
  makeHome(): boolean;
  wentHome(target: BrainEntity): boolean;
}
export interface MoleBaitTarget extends BrainEntity {
  reserve(): boolean;
  releaseReservation(): void;
  isOnValidGround(): boolean;
  canSteal(): boolean;
  PushEvent(name: string, data?: unknown): void;
}
/** actions.lua: theft is an event handled by bait.lua, not direct item removal. */
export function createMoleAction(inst: MoleActionInst, action: MoleAction, target?: BrainEntity, pos?: Vector3, unit = 1): BufferedAction {
  return new BufferedAction(action, () => {
    switch (action) {
      case 'GOHOME': return !!target && inst.wentHome(target);
      case 'MAKEMOLEHILL': return inst.makeHome();
      case 'MOLEPEEK': inst.PushEvent('peek'); return true;
      case 'STEALMOLEBAIT': {
        const bait = target as MoleBaitTarget;
        bait.releaseReservation(); bait.PushEvent('onstolen', { thief: inst }); return true;
      }
    }
  }, () => inst.isValid() && (!target || target.isValid()) &&
    (action !== 'STEALMOLEBAIT' || (target as MoleBaitTarget).canSteal()),
  { target, pos, distance: (action === 'MAKEMOLEHILL' ? 0 : action === 'STEALMOLEBAIT' ? .75 : 1) * unit });
}
