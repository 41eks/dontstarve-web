import type { ItemEntity } from '../../inventory/src/entity';
import type { BufferedAction } from '../../stategraphs/src/bufferedaction';
import type { Worker } from './workable';

/** An inst an event names, as its listeners read it. */
interface TaggedInst {
  hasTag(tag: string): boolean;
}

/**
 * The data each source event carries, keyed by the event's name, as its pusher builds it in the Lua source. The
 * module that pushes an event owns its entry: engine and component events are listed here, and a prefab adds its
 * own with `declare module` beside its pusher. An event that is not listed carries unknown data.
 */
export interface EntityEventData {
  /** timer.lua OnTimerDone. */
  timerdone: { readonly name: string };
  /** finiteuses.lua / armor.lua / fueled.lua SetPercent. */
  percentusedchange: { readonly percent: number };
  /** temperature.lua OnUpdate. */
  temperaturedelta: { readonly last: number; readonly new: number; readonly hasrate: boolean };
  /** talker.lua Say. */
  ontalk: { readonly noanim?: boolean; readonly duration: number };
  /** fishingrod.lua Collect. */
  fishingcatch: { readonly build: string };
  /** actions.lua STEALMOLEBAIT: the thief takes the bait into its inventory. */
  onstolen: {
    readonly thief: { readonly components: { readonly inventory?: { GiveItem(item: ItemEntity): boolean } } };
  };
  /** explosive.lua OnBurnt, at each target in range. */
  explosion: { readonly explosive: Worker };
  /** combat.lua GetAttacked. */
  attacked: {
    readonly attacker: TaggedInst;
    readonly damage: number;
    readonly original_damage?: number;
    readonly weapon?: TaggedInst;
  };
  /** tool.lua / finiteuses.lua: a depleted tool tells its owner. */
  toolbroke: { readonly tool: { readonly prefab: string; readonly nobrokentoolfx?: boolean } };
  /** inventory.lua Equip / Unequip. */
  equip: { readonly item: ItemEntity; readonly eslot: EquipSlot };
  unequip: { readonly item: ItemEntity; readonly eslot: EquipSlot };
  /** inventory.lua: an equipped item used up, so the inventory can equip another of its prefab. */
  itemranout: {
    readonly prefab: string;
    readonly equipslot: import('../../inventory/src/types').EquipmentKind;
    readonly announce?: string;
  };
  /** stategraph.lua GoToState. */
  newstate: { readonly statename: string };
  /** health.lua SetVal, at zero health; a creature without health pushes it without data. */
  death: { readonly cause?: string } | undefined;
  /** health.lua DoDelta. */
  healthdelta: {
    readonly oldpercent: number;
    readonly newpercent: number;
    readonly overtime?: boolean;
    readonly cause?: string;
    readonly amount: number;
  };
  /** hunger.lua SetCurrent. */
  hungerdelta: {
    readonly oldpercent: number;
    readonly newpercent: number;
    readonly overtime?: boolean;
    readonly delta: number;
  };
  /** sanity.lua DoDelta. */
  sanitydelta: {
    readonly oldpercent: number;
    readonly newpercent: number;
    readonly overtime?: boolean;
    readonly sanitymode: number;
  };
  /** entityscript.lua PushBufferedAction / ClearBufferedAction. */
  actionfailed: { readonly action: BufferedAction; readonly reason?: string };
}

/** EQUIPSLOTS. */
export type EquipSlot = 'HANDS' | 'HEAD' | 'BODY';

/** The data an event of this name carries. */
export type EventData<E extends string> = E extends keyof EntityEventData ? EntityEventData[E] : unknown;

/** inst:PushEvent's data argument: required unless the event's data may be absent. */
export type EventDataArgs<E extends string> =
  undefined extends EventData<E> ? [data?: EventData<E>] : [data: EventData<E>];

/** inst:ListenForEvent as a component's inst declares it: the listener's data follows the event's name. */
export interface EventListening {
  ListenForEvent<E extends string>(event: E, fn: (inst: unknown, data: EventData<E>) => void): () => void;
}
