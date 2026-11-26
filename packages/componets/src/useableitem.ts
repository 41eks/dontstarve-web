import type { LuaFn } from './luaFn';
import { createSignal, readonlySignal, type ReadonlySignal } from '../../signals/src';

export interface UseableItemInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
  readonly components: { equippable?: { IsEquipped(): boolean } };
}

export type UseableItemOnUseFn = LuaFn<[inst: UseableItemInst], boolean | void>;
export type UseableItemOnStopUseFn = LuaFn<[inst: UseableItemInst]>;

/** useableitem.lua: the "inuse" tag mirrors the flag; the item decides what using it does. */
export class UseableItem {
  private readonly inuseState = createSignal(false);
  readonly inuse: ReadonlySignal<boolean> = readonlySignal(this.inuseState);
  private onusefn?: UseableItemOnUseFn;
  private onstopusefn?: UseableItemOnStopUseFn;
  private readonly inst: UseableItemInst;

  constructor(inst: UseableItemInst) {
    this.inst = inst;
  }

  SetOnUseFn(fn: UseableItemOnUseFn | undefined): void {
    this.onusefn = fn;
  }
  SetOnStopUseFn(fn: UseableItemOnStopUseFn | undefined): void {
    this.onstopusefn = fn;
  }
  /** `inst.replica.equippable:IsEquipped()`. */
  CanInteract(): boolean {
    return !this.inuseState.value && !!this.inst.components.equippable?.IsEquipped();
  }

  private setInUse(inuse: boolean): void {
    this.inuseState.set(inuse);
    if (inuse) {
      this.inst.addTag('inuse');
    } else {
      this.inst.removeTag('inuse');
    }
  }
  StartUsingItem(): boolean {
    this.setInUse(true);
    if (this.onusefn) {
      this.setInUse(this.onusefn(this.inst) !== false);
    }
    return this.inuseState.value;
  }
  StopUsingItem(): void {
    this.setInUse(false);
    this.onstopusefn?.(this.inst);
  }
  /** OnRemoveFromEntity */
  dispose(): void {
    this.inst.removeTag('inuse');
    this.onusefn = undefined;
    this.onstopusefn = undefined;
  }
}
