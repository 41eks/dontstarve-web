import type { LuaFn } from './luaFn';

/** An item in the incinerator's container, as ShouldIncinerateItem and OnPreDestroyItemCallbackFn read it. */
export interface IncineratorItem {
  readonly prefab: string;
  hasTag(tag: string): boolean;
  readonly components: { readonly container?: { IsEmpty(): boolean } };
  PushEvent?(name: string, data?: unknown): void;
}

/** The entity with the incinerator: its container destroys the contents. */
export interface IncineratorInst<Item extends IncineratorItem = IncineratorItem> {
  readonly components: {
    readonly container?: {
      DestroyContentsConditionally(filterfn: ((inst: unknown, item: Item) => boolean) | undefined,
        onpredestroyitemcallbackfn?: (inst: unknown, item: Item) => void): void;
    };
  };
}

export type ShouldIncinerateItemFn<Inst, Item> = LuaFn<[inst: Inst, item: Item], boolean>;

/**
 * incinerator.lua. OnPreDestroyItemCallbackFn's incineratesound / murdersound and the doer's murdered / killed events are
 * not ported: no item that can go in a container has a health or murderable component here.
 */
export class Incinerator<Inst extends IncineratorInst<Item>, Item extends IncineratorItem = IncineratorItem> {
  readonly inst: Inst;
  onincineratefn?: LuaFn<[inst: Inst], void>;
  shouldincinerateitemfn?: ShouldIncinerateItemFn<Inst, Item>;
  /** Set only while Incinerate runs, as OnPreDestroyItemCallbackFn reads it. */
  incinerate_doer?: object;

  constructor(inst: Inst) { this.inst = inst; }

  SetOnIncinerateFn(fn: LuaFn<[inst: Inst], void> | undefined): void { this.onincineratefn = fn; }
  SetShouldIncinerateItemFn(fn: ShouldIncinerateItemFn<Inst, Item> | undefined): void { this.shouldincinerateitemfn = fn; }

  /** Incinerator.OnPreDestroyItemCallbackFn: the item hears it is incinerated, and by whom. */
  private OnPreDestroyItemCallbackFn(item: Item): void {
    item.PushEvent?.('onincinerated', { incinerator: this.inst, doer: this.incinerate_doer });
  }

  Incinerate(doer?: object): boolean {
    const container = this.inst.components.container;
    if (!container) { return false; }
    this.incinerate_doer = doer;
    const filter = this.shouldincinerateitemfn;
    container.DestroyContentsConditionally(filter && ((_inst, item) => filter(this.inst, item)),
      (_inst, item) => this.OnPreDestroyItemCallbackFn(item));
    this.onincineratefn?.(this.inst);
    this.incinerate_doer = undefined;
    return true;
  }

  ShouldIncinerateItem(item: Item): boolean {
    return this.shouldincinerateitemfn ? this.shouldincinerateitemfn(this.inst, item) : true;
  }
}
