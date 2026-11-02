import type { ActionWorldContext } from './actionContext.ts';

export type PlayerActionKind = 'BLINK' | 'BLINK_MAP' | 'ATTACK' | 'HAMMER' | 'MINE' | 'CHOP' | 'TERRAFORM' | 'TILL' | 'DIG' | 'PLANTSOIL'
  | 'NET' | 'PICK' | 'PICKUP' | 'HARVEST' | 'EAT' | 'READ' | 'BUILD' | 'DEPLOY' | 'FERTILIZE' | 'BATHBOMB' | 'CASTSPELL' | 'LIGHT' | 'GIVE' | 'FEED' | 'REPAIR' | 'SHAVE' | 'STORE' | 'TAKEITEM' | 'ADDFUEL' | 'ADDWETFUEL' | 'SLEEPIN' | 'PLAY' | 'FISH' | 'HAUNT' | 'MIGRATE' | 'TURNON' | 'TURNOFF' | 'RUMMAGE';
export type ActionInterruptReason = 'slot-select' | 'slot-context-menu' | 'drop' | 'craft' | 'crafting' | 'emote';
export interface PlayerActionEvents {
  'action:begin': { owner: object; action: PlayerActionKind };
  'action:interrupt': { reason: ActionInterruptReason };
}

/** Every new owner cancels the previous work synchronously, before starting its own. */
export function bindActionCancellation(world: Pick<ActionWorldContext, 'actionEvents'>, owner: object,
  cancel: () => void, shouldInterrupt: (reason: ActionInterruptReason) => boolean = reason => reason !== 'drop'): () => void {
  const stopBegin = world.actionEvents?.on('action:begin', event => {
    if (event.owner !== owner) cancel();
  });
  const stopInterrupt = world.actionEvents?.on('action:interrupt', event => {
    if (shouldInterrupt(event.reason)) cancel();
  });
  return () => { stopBegin?.(); stopInterrupt?.(); };
}
