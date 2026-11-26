import type { LuaFn } from './luaFn';
import { createEffect, createSignal, readonlySignal } from '../../signals/src';

export interface TraderInst {
  hasTag(tag: string): boolean;
  addTag(tag: string): void;
  removeTag(tag: string): void;
  readonly components?: object;
  PushEvent?(name: string, data: unknown): void;
}

export interface TradeItem {
  readonly prefab: string;
  readonly components?: {
    edible?: import('./edible').Edible;
    fertilizer?: import('./fertilizer').Fertilizer;
    bathbomb?: import('./bathbomb').BathBomb;
    repairer?: import('./repairer').Repairer;
    shaver?: import('./shaver').Shaver;
    fuel?: import('./fuel').Fuel;
    tradable?: import('./tradable').Tradable;
  };
  GetIsWet?(): boolean;
  hasTag(tag: string): boolean;
}

/** abletoaccepttest returns Lua's `false, reason` as `{ ok: false, reason }`. */
export type TradeAcceptance = { ok: true } | { ok: false; reason?: string };

export type TraderAbleToAcceptTestFn<Inst, Item, Giver> = LuaFn<
  [inst: Inst, item: Item, giver: Giver | undefined],
  TradeAcceptance
>;
export type TraderAcceptTestFn<Inst, Item, Giver> = LuaFn<[inst: Inst, item: Item, giver: Giver | undefined], boolean>;
export type TraderOnAcceptFn<Inst, Item, Giver> = LuaFn<[inst: Inst, giver: Giver | undefined, item: Item]>;
export type TraderOnRefuseFn<Inst, Item, Giver> = LuaFn<[inst: Inst, giver: Giver | undefined, item: Item]>;

/** components/trader.lua: gate on the ability to accept, then consume one item and notify. */
export class Trader<Item extends TradeItem = TradeItem, Giver = unknown, Inst extends TraderInst = TraderInst> {
  private readonly enabledState = createSignal(true);
  /** trader.lua enabled, read-only for presentations. */
  readonly enabled = readonlySignal(this.enabledState);
  deleteitemonaccept = true;
  private readonly acceptNonTradableState = createSignal(false);
  private abletoaccepttest?: TraderAbleToAcceptTestFn<Inst, Item, Giver>;
  private test?: TraderAcceptTestFn<Inst, Item, Giver>;
  private onaccept?: TraderOnAcceptFn<Inst, Item, Giver>;
  private onrefuse?: TraderOnRefuseFn<Inst, Item, Giver>;
  private readonly inst: Inst;
  private readonly stopTags: () => void;

  constructor(inst: Inst) {
    this.inst = inst;
    this.stopTags = createEffect(() => {
      const enabled = this.enabledState.get(),
        acceptsNonTradable = this.acceptNonTradableState.get();
      if (enabled) {
        inst.addTag('trader');
      } else {
        inst.removeTag('trader');
      }
      if (enabled && acceptsNonTradable) {
        inst.addTag('alltrader');
      } else {
        inst.removeTag('alltrader');
      }
    });
  }

  get acceptsNonTradable(): boolean {
    return this.acceptNonTradableState.value;
  }
  set acceptsNonTradable(value: boolean) {
    this.acceptNonTradableState.set(value);
  }
  get isEnabled(): boolean {
    return this.enabledState.value;
  }

  Enable(): void {
    this.enabledState.set(true);
  }
  Disable(): void {
    this.enabledState.set(false);
  }
  /** Like trader.lua, every callback receives the trader's inst first. */
  SetAbleToAcceptTest(fn: TraderAbleToAcceptTestFn<Inst, Item, Giver> | undefined): void {
    this.abletoaccepttest = fn;
  }
  SetAcceptTest(fn: TraderAcceptTestFn<Inst, Item, Giver> | undefined): void {
    this.test = fn;
  }
  SetOnAccept(fn: TraderOnAcceptFn<Inst, Item, Giver> | undefined): void {
    this.onaccept = fn;
  }
  SetOnRefuse(fn: TraderOnRefuseFn<Inst, Item, Giver> | undefined): void {
    this.onrefuse = fn;
  }

  AbleToAccept(item: Item | undefined, giver?: Giver): TradeAcceptance {
    if (!this.enabledState.value || !item) {
      return { ok: false };
    }
    return this.abletoaccepttest ? this.abletoaccepttest(this.inst, item, giver) : { ok: true };
  }

  WantsToAccept(item: Item, giver?: Giver): boolean {
    return this.enabledState.value && (!this.test || this.test(this.inst, item, giver));
  }

  /** `take` removes one item from its owner; it runs only after both tests pass. */
  AcceptGift(item: Item, take: (deleteItem: boolean) => boolean | Item, giver?: Giver): boolean {
    if (!this.AbleToAccept(item, giver).ok) {
      return false;
    }
    if (!this.WantsToAccept(item, giver)) {
      this.onrefuse?.(this.inst, giver, item);
      return false;
    }
    const taken = take(this.deleteitemonaccept);
    if (!taken) {
      return false;
    }
    if (typeof taken === 'object') {
      item = taken;
    }
    const inventory = (this.inst.components as { inventory?: { GiveItem(item: Item): boolean } } | undefined)
      ?.inventory;
    if (!this.deleteitemonaccept) {
      inventory?.GiveItem(item);
    }
    this.onaccept?.(this.inst, giver, item);
    this.inst.PushEvent?.('trade', { giver, item });
    return true;
  }

  dispose(): void {
    this.stopTags();
    this.inst.removeTag('trader');
    this.inst.removeTag('alltrader');
  }
}
