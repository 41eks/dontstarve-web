import type { ActionWorldContext } from './actionContext.ts';
import type { WilsonAction } from './SGwilson.ts';

/** An action whose start cancels other work: one the player buffers, or the building placer's BUILD. */
export type PlayerActionKind = WilsonAction | 'BUILD';
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
