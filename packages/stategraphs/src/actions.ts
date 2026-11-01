import type { BufferedActionObject } from './bufferedaction.ts';

/** Supported action strings from strings.lua + languages/chinese_s.po; priorities from actions.lua. */
export const ACTIONS = {
  BLINK: { priority: 10, rmb: true, distance: 36, strings: { GENERIC: '传送', SOUL: '灵魂跳跃', FREESOUL: '灵魂回声' } },
  BLINK_MAP: { priority: 10, rmb: true, map_action: true, arrive_anywhere: true, strings: { GENERIC: '灵魂跳跃' } },
  NET: { priority: 3, strings: { GENERIC: '捕捉' } },
  ATTACK: { priority: 2, strings: { GENERIC: '攻击', RANGEDLIGHT: '点燃' } },
  HAMMER: { priority: 3, strings: { GENERIC: '敲' } },
  MINE: { priority: 0, strings: { GENERIC: '开采' } },
  CHOP: { priority: 0, distance: 1.75, strings: { GENERIC: '砍' } },
  DIG: { priority: 0, rmb: true, strings: { GENERIC: '挖' } },
  TERRAFORM: { priority: 0, strings: { GENERIC: '挖' } },
  TILL: { priority: 0, distance: 0.5, strings: { GENERIC: '耕地' } },
  PLANT: { priority: 0, strings: { GENERIC: '栽种' } },
  PLANTSOIL: { priority: 0, strings: { GENERIC: '栽种' } },
  EAT: { priority: 0, strings: { GENERIC: '吃', DRINK: '饮用', PROCESS: '处理' } },
  PICK: { priority: 0, strings: { GENERIC: '采集' } },
  HARVEST: { priority: 0, strings: { GENERIC: '采收' } },
  TURNON: { priority: 2, strings: { GENERIC: '打开' } },
  TURNOFF: { priority: 2, strings: { GENERIC: '关闭' } },
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
  MIGRATE: { priority: 0, rmb: false, ghost_valid: true, strings: { GENERIC: '进入' } },
  HAUNT: { priority: 0, rmb: false, mindistance: 2, ghost_valid: true, ghost_exclusive: true, strings: { GENERIC: '作祟' } },
  RUMMAGE: { priority: -1, strings: { GENERIC: '打开', CLOSE: '关闭' } },
} as const;

export type MouseActionId = keyof typeof ACTIONS;
export interface ActionDescription {
  action: string;
  modifier?: string;
  /** BufferedAction.doer, for the strfns that ask who acts. */
  doer?: object;
  invobject?: BufferedActionObject;
  target?: BufferedActionObject;
  /** A point action's ground position. */
  pos?: { readonly x: number; readonly y: number; readonly z: number };
}

type ActionFlags = { ghost_valid?: boolean; ghost_exclusive?: boolean };

/** actions.lua `ghost_valid` (a ghost-exclusive action is ghost-valid); only the actions ported here that a ghost may do. */
export function isGhostValidAction(action: ActionDescription): boolean {
  const flags = ACTIONS[action.action as MouseActionId] as ActionFlags | undefined;
  return flags?.ghost_valid === true || flags?.ghost_exclusive === true;
}

/** player_common.lua PlayerActionFilter, at the bottom of the filter stack: the living cannot do ghost-exclusive actions. */
export function PlayerActionFilter(action: ActionDescription): boolean {
  return (ACTIONS[action.action as MouseActionId] as ActionFlags | undefined)?.ghost_exclusive !== true;
}

export function getActionPriority(action: ActionDescription): number {
  return ACTIONS[action.action as MouseActionId]?.priority ?? 0;
}

/** BufferedAction:GetActionString -> GetActionString(action.id, action.strfn(action)). */
export function getActionString(action: ActionDescription): string {
  const strings: Readonly<Record<string, string>> | undefined = ACTIONS[action.action as MouseActionId]?.strings;
  const modifier = action.modifier ?? strfn(action);
  const text = (modifier && strings?.[modifier]) || strings?.GENERIC || 'ACTION';
  return text.includes('{item}') ? text.replace('{item}', action.invobject?.getDisplayName?.() ?? '') : text;
}

/** actions.lua ACTIONS.<id>.strfn, for the ported actions whose string depends on the act. */
function strfn(act: ActionDescription): string | undefined {
  const target = act.target as (BufferedActionObject & { components?: { container?: { IsOpenedBy(doer: object): boolean } } }) | undefined;
  switch (act.action) {
    case 'CASTSPELL': return act.invobject?.spelltype;
    case 'EAT': return act.invobject?.hasTag('fooddrink') ? 'DRINK' : undefined;
    case 'RUMMAGE': return act.doer && target?.components?.container?.IsOpenedBy(act.doer) ? 'CLOSE' : undefined;
    case 'HARVEST': return target?.prefab === 'birdcage' ? 'FREE' : undefined;
    case 'TAKEITEM': return target?.prefab === 'birdcage' ? 'BIRDCAGE' : 'GENERIC';
    case 'BLINK': {
      const doer = act.doer as { hasTag?(tag: string): boolean; _freesoulhop_counter?: number } | undefined;
      return !act.invobject && doer?.hasTag?.('soulstealer') ? ((doer._freesoulhop_counter ?? 0) > 0 ? 'FREESOUL' : 'SOUL') : undefined;
    }
    case 'ATTACK': {
      // The invobject is the weapon; PROP, RANGEDSMOTHER and WHACK are not ported.
      const combat = (act.doer as { components?: { combat?: { CanLightTarget(target: never, weapon?: never): boolean } } } | undefined)?.components?.combat;
      const weapon = (act.invobject as { components?: { weapon?: unknown } } | undefined)?.components?.weapon;
      return target && act.invobject && combat?.CanLightTarget(target as never, weapon as never) ? 'RANGEDLIGHT' : undefined;
    }
    case 'REEL': {
      const rod = (act.invobject as { components?: { fishingrod?: { readonly target?: unknown; HasHookedFish(): boolean } } } | undefined)?.components?.fishingrod;
      if (!rod || rod.target !== act.target) return undefined;
      if (rod.HasHookedFish()) return 'REEL';
      // act.doer:HasTag("nibble"): the hook string is REEL's GENERIC.
      return (act.doer as { sg?: { HasStateTag(tag: string): boolean } } | undefined)?.sg?.HasStateTag('nibble') ? undefined : 'CANCEL';
    }
    default: return undefined;
  }
}
