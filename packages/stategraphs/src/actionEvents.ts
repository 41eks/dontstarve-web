import type { ActionWorldContext } from './actionContext.ts';

export type PlayerActionKind = 'ATTACK' | 'HAMMER' | 'MINE' | 'CHOP' | 'TERRAFORM' | 'TILL' | 'DIG'
  | 'NET' | 'PICK' | 'PICKUP' | 'HARVEST' | 'EAT' | 'READ' | 'SEED_SELECT' | 'FLOWER_PLANT' | 'BUILD' | 'DEPLOY' | 'CASTSPELL' | 'LIGHT' | 'GIVE' | 'REPAIR';
export type ActionInterruptReason = 'slot-select' | 'slot-context-menu' | 'drop' | 'craft' | 'crafting' | 'emote';
export interface PlayerActionEvents {
  'action:begin': { owner: object; action: PlayerActionKind };
  'action:interrupt': { reason: ActionInterruptReason };
}

type ActionGroup = 'attack' | 'hand' | 'spell' | 'net' | 'food' | 'read' | 'flower' | 'building' | 'deploy' | 'movement' | 'harvest' | 'pickup' | 'pick' | 'itemuse';
interface CancellationRule {
  begins: readonly PlayerActionKind[];
  interrupts: readonly ActionInterruptReason[];
}
const inventoryInterrupts = ['slot-select', 'slot-context-menu', 'craft', 'crafting', 'emote'] as const;
const inventoryActions = ['EAT', 'READ', 'SEED_SELECT', 'FLOWER_PLANT', 'BUILD', 'DEPLOY', 'HARVEST', 'PICKUP', 'GIVE', 'REPAIR'] as const;
const workActions = ['ATTACK', 'HAMMER', 'MINE', 'CHOP', 'TERRAFORM', 'TILL', 'DIG', 'CASTSPELL', 'LIGHT'] as const;

/** Existing interruption scopes, expressed as action categories rather than controller instances. */
const rules: Record<ActionGroup, CancellationRule> = {
  itemuse: { begins: [...workActions, ...inventoryActions, 'NET', 'PICK'], interrupts: [...inventoryInterrupts, 'drop'] },
  attack: { begins: [...workActions, ...inventoryActions, 'NET', 'PICK'], interrupts: inventoryInterrupts },
  pickup: { begins: [...workActions, ...inventoryActions, 'NET', 'PICK', 'CASTSPELL'], interrupts: inventoryInterrupts },
  harvest: { begins: [...workActions, ...inventoryActions, 'NET', 'PICK', 'CASTSPELL'], interrupts: inventoryInterrupts },
  pick: { begins: [...workActions, ...inventoryActions, 'NET', 'PICK', 'CASTSPELL'], interrupts: inventoryInterrupts },
  hand: { begins: ['ATTACK', 'CASTSPELL', 'LIGHT', ...inventoryActions], interrupts: inventoryInterrupts },
  spell: { begins: [...workActions, ...inventoryActions, 'NET', 'PICK', 'CASTSPELL'], interrupts: inventoryInterrupts },
  net: { begins: [...workActions, 'PICK', 'EAT', 'SEED_SELECT'], interrupts: ['emote'] },
  food: { begins: ['TILL', 'DIG', 'LIGHT', ...inventoryActions], interrupts: inventoryInterrupts },
  read: { begins: [...workActions, 'NET', 'PICK', ...inventoryActions], interrupts: inventoryInterrupts },
  flower: { begins: [...workActions, 'NET', 'PICK', ...inventoryActions], interrupts: ['slot-select', 'drop', 'emote'] },
  building: { begins: [...workActions, 'NET', 'PICK', ...inventoryActions], interrupts: ['emote'] },
  deploy: { begins: ['TILL', 'DIG', 'LIGHT', ...inventoryActions], interrupts: inventoryInterrupts },
  movement: { begins: ['PICK', ...inventoryActions, 'CASTSPELL', 'LIGHT'], interrupts: ['crafting', 'emote'] },
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
