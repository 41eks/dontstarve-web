export interface TraderInst {
  hasTag(tag: string): boolean;
  addTag(tag: string): void;
  removeTag(tag: string): void;
}

export interface TradeItem {
  readonly prefab: string;
  readonly components?: { repairer?: import('./repairer').Repairer };
  hasTag(tag: string): boolean;
}

/** abletoaccepttest returns Lua's `false, reason` as `{ ok: false, reason }`. */
export type TradeAcceptance = { ok: true } | { ok: false; reason?: string };

/** components/trader.lua: gate on the ability to accept, then consume one item and notify. */
export class Trader<Item extends TradeItem = TradeItem, Giver = unknown> {
  private enabled = true;
  deleteitemonaccept = true;
  private acceptnontradable = false;
  private abletoaccepttest?: (item: Item, giver: Giver | undefined) => TradeAcceptance;
  private test?: (item: Item, giver: Giver | undefined) => boolean;
  private onaccept?: (giver: Giver | undefined, item: Item) => void;
  private onrefuse?: (giver: Giver | undefined, item: Item) => void;
  private readonly inst: TraderInst;

  constructor(inst: TraderInst) {
    this.inst = inst;
    this.refreshTags();
  }

  get acceptsNonTradable(): boolean { return this.acceptnontradable; }
  set acceptsNonTradable(value: boolean) { this.acceptnontradable = value; this.refreshTags(); }
  get isEnabled(): boolean { return this.enabled; }

  Enable(): void { this.enabled = true; this.refreshTags(); }
  Disable(): void { this.enabled = false; this.refreshTags(); }
  SetAbleToAcceptTest(fn: (item: Item, giver: Giver | undefined) => TradeAcceptance): void { this.abletoaccepttest = fn; }
  SetAcceptTest(fn: (item: Item, giver: Giver | undefined) => boolean): void { this.test = fn; }
  SetOnAccept(fn: (giver: Giver | undefined, item: Item) => void): void { this.onaccept = fn; }
  SetOnRefuse(fn: (giver: Giver | undefined, item: Item) => void): void { this.onrefuse = fn; }

  AbleToAccept(item: Item | undefined, giver?: Giver): TradeAcceptance {
    if (!this.enabled || !item) return { ok: false };
    return this.abletoaccepttest ? this.abletoaccepttest(item, giver) : { ok: true };
  }

  WantsToAccept(item: Item, giver?: Giver): boolean {
    return this.enabled && (!this.test || this.test(item, giver));
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
  }

  private refreshTags(): void {
    for (const [tag, wanted] of [['trader', this.enabled], ['alltrader', this.enabled && this.acceptnontradable]] as const) {
      if (wanted) this.inst.addTag(tag);
      else this.inst.removeTag(tag);
    }
  }
}
