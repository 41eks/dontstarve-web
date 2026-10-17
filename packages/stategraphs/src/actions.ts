import type { BufferedActionObject } from './bufferedaction.ts';

/** Supported action strings from strings.lua + languages/chinese_s.po; priorities from actions.lua. */
export const ACTIONS = {
  BLINK: { priority: 10, rmb: true, distance: 36, strings: { GENERIC: '传送', SOUL: '灵魂跳跃', FREESOUL: '灵魂回声' } },
  NET: { priority: 3, strings: { GENERIC: '捕捉' } },
  ATTACK: { priority: 2, strings: { GENERIC: '攻击', RANGEDLIGHT: '点燃' } },
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
  FEED: { priority: 0, strings: { GENERIC: '喂食' } },
  GIVE: { priority: 0, strings: { GENERIC: '给予', PLACE_ITEM: '放置{item}' } },
  REPAIR: { priority: 0, rmb: true, strings: { GENERIC: '修复' } },
  BATHBOMB: { priority: 0, strings: { GENERIC: '投入' } },
  FERTILIZE: { priority: 1, strings: { GENERIC: '施肥' } },
  ADDFUEL: { priority: 0, strings: { GENERIC: '添加燃料' } },
  ADDWETFUEL: { priority: 0, strings: { GENERIC: '添加受潮的燃料' } },
  FISH: { priority: 0, strings: { GENERIC: '钓鱼' } },
  REEL: { priority: 0, instant: true, strings: { GENERIC: '上钩', REEL: '收线', CANCEL: '停止钓鱼' } },
  CASTSPELL: { priority: -1, distance: 20, rmb: true, strings: { GENERIC: '施放法术', RESKIN: '打扫' } },
  LIGHT: { priority: -4, strings: { GENERIC: '点燃' } },
  PLAY: { priority: 0, strings: { GENERIC: '演奏' } },
  READ: { priority: 0, strings: { GENERIC: '阅读' } },
  DEPLOY: { priority: 0, distance: 1.1, strings: { GENERIC: '放置', PLANT: '种植' } },
  SHAVE: { priority: 0, strings: { GENERIC: '刮', SELF: '给自己刮胡子' } },
  SLEEPIN: { priority: 0, strings: { GENERIC: '睡觉' } },
  HAUNT: { priority: 0, ghost_valid: true, strings: { GENERIC: '作祟' } },
} as const;

export type MouseActionId = keyof typeof ACTIONS;
export interface ActionDescription {
  action: string;
  modifier?: string;
  invobject?: BufferedActionObject;
  target?: BufferedActionObject;
}

/** actions.lua `ghost_valid`; only the actions ported here that a ghost may do. */
export function isGhostValidAction(action: ActionDescription): boolean {
  return (ACTIONS[action.action as MouseActionId] as { ghost_valid?: boolean } | undefined)?.ghost_valid === true;
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
