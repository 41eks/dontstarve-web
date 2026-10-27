import type { ActionWorldContext } from './actionContext.ts';

export type PlayerActionKind = 'BLINK' | 'BLINK_MAP' | 'ATTACK' | 'HAMMER' | 'MINE' | 'CHOP' | 'TERRAFORM' | 'TILL' | 'DIG'
  | 'NET' | 'PICK' | 'PICKUP' | 'HARVEST' | 'EAT' | 'READ' | 'SEED_SELECT' | 'BUILD' | 'DEPLOY' | 'FERTILIZE' | 'BATHBOMB' | 'CASTSPELL' | 'LIGHT' | 'GIVE' | 'FEED' | 'REPAIR' | 'SHAVE' | 'STORE' | 'TAKEITEM' | 'ADDFUEL' | 'ADDWETFUEL' | 'SLEEPIN' | 'PLAY' | 'FISH' | 'HAUNT' | 'MIGRATE' | 'TURNON' | 'TURNOFF';
export type ActionInterruptReason = 'slot-select' | 'slot-context-menu' | 'drop' | 'craft' | 'crafting' | 'emote';
export interface PlayerActionEvents {
  'action:begin': { owner: object; action: PlayerActionKind };
  'action:interrupt': { reason: ActionInterruptReason };
}

type ActionGroup = 'attack' | 'hand' | 'spell' | 'net' | 'food' | 'read' | 'play' | 'building' | 'deploy' | 'movement' | 'fishing' | 'harvest' | 'sleep' | 'haunt' | 'migrate' | 'pickup' | 'pick' | 'itemuse';
interface CancellationRule {
  begins: readonly PlayerActionKind[];
  interrupts: readonly ActionInterruptReason[];
}
const inventoryInterrupts = ['slot-select', 'slot-context-menu', 'craft', 'crafting', 'emote'] as const;
const inventoryActions = ['EAT', 'READ', 'SEED_SELECT', 'BUILD', 'DEPLOY', 'HARVEST', 'PICKUP', 'GIVE', 'FEED', 'REPAIR', 'STORE', 'TAKEITEM', 'ADDFUEL', 'ADDWETFUEL', 'FERTILIZE', 'BATHBOMB', 'PLAY', 'TURNON', 'TURNOFF'] as const;
const workActions = ['BLINK', 'BLINK_MAP', 'ATTACK', 'HAMMER', 'MINE', 'CHOP', 'TERRAFORM', 'TILL', 'DIG', 'CASTSPELL', 'LIGHT', 'FISH'] as const;

/** Existing interruption scopes, expressed as action categories rather than controller instances. */
const rules: Record<ActionGroup, CancellationRule> = {
  itemuse: { begins: [...workActions, ...inventoryActions, 'NET', 'PICK'], interrupts: [...inventoryInterrupts, 'drop'] },
  attack: { begins: [...workActions, ...inventoryActions, 'NET', 'PICK'], interrupts: inventoryInterrupts },
  haunt: { begins: [...workActions, ...inventoryActions, 'NET', 'PICK', 'CASTSPELL'], interrupts: inventoryInterrupts },
  pickup: { begins: [...workActions, ...inventoryActions, 'NET', 'PICK', 'CASTSPELL'], interrupts: inventoryInterrupts },
  harvest: { begins: [...workActions, ...inventoryActions, 'NET', 'PICK', 'CASTSPELL'], interrupts: inventoryInterrupts },
  migrate: { begins: [...workActions, ...inventoryActions, 'NET', 'PICK', 'CASTSPELL'], interrupts: inventoryInterrupts },
  sleep: { begins: [...workActions, ...inventoryActions, 'NET', 'PICK', 'CASTSPELL'], interrupts: inventoryInterrupts },
  pick: { begins: [...workActions, ...inventoryActions, 'NET', 'PICK', 'CASTSPELL'], interrupts: inventoryInterrupts },
  hand: { begins: ['ATTACK', 'CASTSPELL', 'LIGHT', ...inventoryActions], interrupts: inventoryInterrupts },
  spell: { begins: [...workActions, ...inventoryActions, 'NET', 'PICK', 'CASTSPELL'], interrupts: inventoryInterrupts },
  net: { begins: [...workActions, 'PICK', 'EAT', 'SEED_SELECT'], interrupts: ['emote'] },
  food: { begins: ['TILL', 'DIG', 'LIGHT', ...inventoryActions], interrupts: inventoryInterrupts },
  read: { begins: [...workActions, 'NET', 'PICK', ...inventoryActions], interrupts: inventoryInterrupts },
  play: { begins: [...workActions, 'NET', 'PICK', ...inventoryActions], interrupts: inventoryInterrupts },
  building: { begins: [...workActions, 'NET', 'PICK', ...inventoryActions], interrupts: ['emote'] },
  deploy: { begins: [...workActions, 'NET', 'PICK', ...inventoryActions], interrupts: inventoryInterrupts },
  fishing: { begins: [...workActions, ...inventoryActions, 'NET', 'PICK'], interrupts: inventoryInterrupts },
  movement: { begins: ['BLINK', 'BLINK_MAP', 'PICK', ...inventoryActions, 'CASTSPELL', 'LIGHT'], interrupts: ['crafting', 'emote'] },
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
