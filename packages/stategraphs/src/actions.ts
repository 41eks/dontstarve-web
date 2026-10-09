import type { BufferedActionObject } from './bufferedaction.ts';

/** Supported action strings from strings.lua + languages/chinese_s.po; priorities from actions.lua. */
export const ACTIONS = {
  NET: { priority: 3, strings: { GENERIC: '捕捉' } },
  HAMMER: { priority: 3, strings: { GENERIC: '敲' } },
  MINE: { priority: 0, strings: { GENERIC: '开采' } },
  DIG: { priority: 0, strings: { GENERIC: '挖' } },
  TERRAFORM: { priority: 0, strings: { GENERIC: '挖' } },
  TILL: { priority: 0, strings: { GENERIC: '耕地' } },
  PLANT: { priority: 0, strings: { GENERIC: '栽种' } },
  EAT: { priority: 0, strings: { GENERIC: '吃', DRINK: '饮用', PROCESS: '处理' } },
  PICK: { priority: 0, strings: { GENERIC: '采集' } },
  PICKUP: { priority: 1, strings: { GENERIC: '拾起' } },
  GIVE: { priority: 0, strings: { GENERIC: '给予', PLACE_ITEM: '放置{item}' } },
  CASTSPELL: { priority: -1, distance: 20, rmb: true, strings: { GENERIC: '施放法术', RESKIN: '打扫' } },
} as const;

export type MouseActionId = keyof typeof ACTIONS;
export interface ActionDescription {
  action: string;
  modifier?: string;
  invobject?: BufferedActionObject;
  target?: BufferedActionObject;
}

export function getActionPriority(action: ActionDescription): number {
  return ACTIONS[action.action as MouseActionId]?.priority ?? 0;
}

/** BufferedAction:GetActionString -> GetActionString(action.id, action.strfn(action)). */
export function getActionString(action: ActionDescription): string {
  const strings: Readonly<Record<string, string>> | undefined = ACTIONS[action.action as MouseActionId]?.strings;
  const modifier = action.modifier ?? (action.action === 'CASTSPELL' ? action.invobject?.spelltype
    : action.action === 'EAT' && action.invobject?.hasTag('fooddrink') ? 'DRINK' : undefined);
  const text = (modifier && strings?.[modifier]) || strings?.GENERIC || 'ACTION';
  return text.includes('{item}') ? text.replace('{item}', action.invobject?.getDisplayName?.() ?? '') : text;
}
