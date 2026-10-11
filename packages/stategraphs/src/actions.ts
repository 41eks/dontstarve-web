import type { BufferedActionObject } from './bufferedaction.ts';

/** Supported action strings from strings.lua + languages/chinese_s.po; priorities from actions.lua. */
export const ACTIONS = {
  NET: { priority: 3, strings: { GENERIC: '捕捉' } },
  HAMMER: { priority: 3, strings: { GENERIC: '敲' } },
  MINE: { priority: 0, strings: { GENERIC: '开采' } },
  CHOP: { priority: 0, strings: { GENERIC: '砍' } },
  DIG: { priority: 0, strings: { GENERIC: '挖' } },
  TERRAFORM: { priority: 0, strings: { GENERIC: '挖' } },
  TILL: { priority: 0, strings: { GENERIC: '耕地' } },
  PLANT: { priority: 0, strings: { GENERIC: '栽种' } },
  EAT: { priority: 0, strings: { GENERIC: '吃', DRINK: '饮用', PROCESS: '处理' } },
  PICK: { priority: 0, strings: { GENERIC: '采集' } },
  HARVEST: { priority: 0, strings: { GENERIC: '采收' } },
  PICKUP: { priority: 1, strings: { GENERIC: '拾起' } },
  STORE: { priority: 0, strings: { GENERIC: '存放', IMPRISON: '关入鸟笼' } },
  TAKEITEM: { priority: 0, strings: { GENERIC: '拿取物品', BIRDCAGE: '打扫' } },
  GIVE: { priority: 0, strings: { GENERIC: '给予', PLACE_ITEM: '放置{item}' } },
  REPAIR: { priority: 0, rmb: true, strings: { GENERIC: '修复' } },
  ADDFUEL: { priority: 0, strings: { GENERIC: '添加燃料' } },
  ADDWETFUEL: { priority: 0, strings: { GENERIC: '添加受潮的燃料' } },
  CASTSPELL: { priority: -1, distance: 20, rmb: true, strings: { GENERIC: '施放法术', RESKIN: '打扫' } },
  LIGHT: { priority: -4, strings: { GENERIC: '点燃' } },
  READ: { priority: 0, strings: { GENERIC: '阅读' } },
  SHAVE: { priority: 0, strings: { GENERIC: '刮', SELF: '给自己刮胡子' } },
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
