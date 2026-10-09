import type { ActionWorldContext } from './actionContext.ts';

export type PlayerActionKind = 'HAMMER' | 'MINE' | 'TERRAFORM' | 'TILL' | 'DIG' | 'RESKIN'
  | 'NET' | 'PICK' | 'EAT' | 'SEED_SELECT' | 'FLOWER_PLANT' | 'BUILD' | 'DEPLOY' | 'CASTSPELL';
export type ActionInterruptReason = 'slot-select' | 'slot-context-menu' | 'drop' | 'craft' | 'crafting' | 'emote';
export interface PlayerActionEvents {
  'action:begin': { owner: object; action: PlayerActionKind };
  'action:interrupt': { reason: ActionInterruptReason };
}

type ActionGroup = 'hand' | 'spell' | 'net' | 'food' | 'flower' | 'building' | 'deploy' | 'movement';
interface CancellationRule {
  begins: readonly PlayerActionKind[];
  interrupts: readonly ActionInterruptReason[];
}
const inventoryInterrupts = ['slot-select', 'slot-context-menu', 'craft', 'crafting', 'emote'] as const;
const inventoryActions = ['EAT', 'SEED_SELECT', 'FLOWER_PLANT', 'BUILD', 'DEPLOY'] as const;
const workActions = ['HAMMER', 'MINE', 'TERRAFORM', 'TILL', 'DIG', 'RESKIN'] as const;

/** Existing interruption scopes, expressed as action categories rather than controller instances. */
const rules: Record<ActionGroup, CancellationRule> = {
  hand: { begins: ['RESKIN', ...inventoryActions], interrupts: inventoryInterrupts },
  spell: { begins: [...workActions, ...inventoryActions, 'NET', 'PICK', 'CASTSPELL'], interrupts: inventoryInterrupts },
  net: { begins: [...workActions, 'PICK', 'EAT', 'SEED_SELECT'], interrupts: ['emote'] },
  food: { begins: ['TILL', 'DIG', ...inventoryActions], interrupts: inventoryInterrupts },
  flower: { begins: [...workActions, 'NET', 'PICK', ...inventoryActions], interrupts: ['slot-select', 'drop', 'emote'] },
  building: { begins: [...workActions, 'NET', 'PICK', ...inventoryActions], interrupts: ['emote'] },
  deploy: { begins: ['TILL', 'DIG', ...inventoryActions], interrupts: inventoryInterrupts },
  movement: { begins: ['PICK', ...inventoryActions, 'CASTSPELL'], interrupts: ['crafting', 'emote'] },
};

/** A subscriber cancels its own work; synchronous delivery happens before the new owner starts. */
export function bindActionCancellation(world: Pick<ActionWorldContext, 'actionEvents'>, owner: object,
  group: ActionGroup, cancel: () => void): () => void {
  const rule = rules[group];
  const stopBegin = world.actionEvents?.on('action:begin', event => {
    if (event.owner !== owner && rule.begins.includes(event.action)) cancel();
  });
  const stopInterrupt = world.actionEvents?.on('action:interrupt', event => {
    if (rule.interrupts.includes(event.reason)) cancel();
  });
  return () => { stopBegin?.(); stopInterrupt?.(); };
}
