import type { LuaFn } from './luaFn';
import { createSignal, readonlySignal } from '../../signals/src';

export interface ShelfInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
}

/** The shelf's inventory (maxslots 1): removal and the fallback drop of TakeItem. */
export interface ShelfHolder<Item> {
  RemoveItem(item: Item): void;
  DropItem(item: Item): void;
}

export interface ShelfTaker<Item> {
  /** inventory:GiveItem(item, nil, shelf position); false leaves the item with the shelf holder. */
  GiveItem(item: Item): boolean;
}

export type ShelfOnShelfItemFn<Inst, Item> = LuaFn<[inst: Inst, item: Item]>;
export type ShelfOnTakeItemFn<Inst, Item> = LuaFn<[inst: Inst, taker: ShelfTaker<Item> | undefined, item: Item]>;

/** components/shelf.lua: one item that can be taken once the owner allows it. */
export class Shelf<Item, Inst extends ShelfInst = ShelfInst> {
  private readonly itemState = createSignal<Item | undefined>(undefined);
  readonly itemonshelf = readonlySignal(this.itemState);
  private canTake = false;
  onshelfitemfn?: ShelfOnShelfItemFn<Inst, Item>;
  ontakeitemfn?: ShelfOnTakeItemFn<Inst, Item>;
  private readonly inst: Inst;
  private readonly holder: ShelfHolder<Item>;

  constructor(inst: Inst, holder: ShelfHolder<Item>) {
    this.inst = inst;
    this.holder = holder;
  }

  get cantakeitem(): boolean {
    return this.canTake;
  }
  set cantakeitem(value: boolean) {
    this.canTake = value;
    this.refreshTag();
  }

  SetOnShelfItem(fn: ShelfOnShelfItemFn<Inst, Item> | undefined): void {
    this.onshelfitemfn = fn;
  }
  SetOnTakeItem(fn: ShelfOnTakeItemFn<Inst, Item> | undefined): void {
    this.ontakeitemfn = fn;
  }

  PutItemOnShelf(item: Item): void {
    this.itemState.set(item);
    this.refreshTag();
    this.onshelfitemfn?.(this.inst, item);
  }

  TakeItem(taker: ShelfTaker<Item> | undefined): boolean {
    const item = this.itemState.peek();
    if (!this.canTake || item === undefined) {
      return false;
    }
    this.ontakeitemfn?.(this.inst, taker, item);
    this.holder.RemoveItem(item);
    this.itemState.set(undefined);
    this.refreshTag();
    if (!taker?.GiveItem(item)) {
      this.holder.DropItem(item);
    }
    return true;
  }

  dispose(): void {
    this.inst.removeTag('takeshelfitem');
    this.itemState.set(undefined);
  }

  private refreshTag(): void {
    if (this.canTake && this.itemState.peek() !== undefined) {
      this.inst.addTag('takeshelfitem');
    } else {
      this.inst.removeTag('takeshelfitem');
    }
  }
}
