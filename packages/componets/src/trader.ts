import { createMemo, createSignal, readonlySignal } from '../../signals/src';

export interface TraderInst {
  hasTag(tag: string): boolean;
  addTag(tag: string): void;
  removeTag(tag: string): void;
}

export interface TradeItem {
  readonly prefab: string;
  readonly components?: { repairer?: import('./repairer').Repairer; shaver?: import('./shaver').Shaver; fuel?: import('./fuel').Fuel; tradable?: import('./tradable').Tradable };
  GetIsWet?(): boolean;
  hasTag(tag: string): boolean;
}

/** abletoaccepttest returns Lua's `false, reason` as `{ ok: false, reason }`. */
export type TradeAcceptance = { ok: true } | { ok: false; reason?: string };

/** components/trader.lua: gate on the ability to accept, then consume one item and notify. */
export class Trader<Item extends TradeItem = TradeItem, Giver = unknown> {
  private readonly enabledState = createSignal(true);
  /** trader.lua enabled, read-only for presentations. */
  readonly enabled = readonlySignal(this.enabledState);
  deleteitemonaccept = true;
  private readonly acceptNonTradableState = createSignal(false);
  /** The trader / alltrader tags are a pure view of the two flags. */
  private readonly tagsMemo = createMemo(() => {
    const enabled = this.enabledState.get();
    return { trader: enabled, alltrader: enabled && this.acceptNonTradableState.get() };
  });
  private abletoaccepttest?: (item: Item, giver: Giver | undefined) => TradeAcceptance;
  private test?: (item: Item, giver: Giver | undefined) => boolean;
  private onaccept?: (giver: Giver | undefined, item: Item) => void;
  private onrefuse?: (giver: Giver | undefined, item: Item) => void;
  private readonly inst: TraderInst;

  constructor(inst: TraderInst) {
    this.inst = inst;
    this.refreshTags();
  }

  get acceptsNonTradable(): boolean { return this.acceptNonTradableState.peek(); }
  set acceptsNonTradable(value: boolean) { this.acceptNonTradableState.set(value); this.refreshTags(); }
  get isEnabled(): boolean { return this.enabledState.peek(); }

  Enable(): void { this.enabledState.set(true); this.refreshTags(); }
  Disable(): void { this.enabledState.set(false); this.refreshTags(); }
  SetAbleToAcceptTest(fn: (item: Item, giver: Giver | undefined) => TradeAcceptance): void { this.abletoaccepttest = fn; }
  SetAcceptTest(fn: (item: Item, giver: Giver | undefined) => boolean): void { this.test = fn; }
  SetOnAccept(fn: (giver: Giver | undefined, item: Item) => void): void { this.onaccept = fn; }
  SetOnRefuse(fn: (giver: Giver | undefined, item: Item) => void): void { this.onrefuse = fn; }

  AbleToAccept(item: Item | undefined, giver?: Giver): TradeAcceptance {
    if (!this.enabledState.peek() || !item) return { ok: false };
    return this.abletoaccepttest ? this.abletoaccepttest(item, giver) : { ok: true };
  }

  WantsToAccept(item: Item, giver?: Giver): boolean {
    return this.enabledState.peek() && (!this.test || this.test(item, giver));
  }

  /** `take` removes one item from its owner; it runs only after both tests pass. */
  AcceptGift(item: Item, take: (deleteItem: boolean) => boolean, giver?: Giver): boolean {
    if (!this.AbleToAccept(item, giver).ok) return false;
    if (!this.WantsToAccept(item, giver)) {
      this.onrefuse?.(giver, item);
      return false;
    }
    if (!take(this.deleteitemonaccept)) return false;
    this.onaccept?.(giver, item);
    return true;
  }

  dispose(): void {
    this.inst.removeTag('trader');
    this.inst.removeTag('alltrader');
    this.tagsMemo.dispose();
  }

  private refreshTags(): void {
    const tags = this.tagsMemo.peek();
    for (const tag of ['trader', 'alltrader'] as const) {
      if (tags[tag]) this.inst.addTag(tag);
      else this.inst.removeTag(tag);
    }
  }
}
