import { createSignal, readonlySignal, type ReadonlySignal } from '../../signals/src';

export interface UseableItemInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
  /** `replica.equippable:IsEquipped()` */
  isEquipped(): boolean;
}

/** useableitem.lua: the "inuse" tag mirrors the flag; the item decides what using it does. */
export class UseableItem {
  private readonly inuseState = createSignal(false);
  readonly inuse: ReadonlySignal<boolean> = readonlySignal(this.inuseState);
  private onusefn?: (inst: UseableItemInst) => boolean | void;
  private onstopusefn?: (inst: UseableItemInst) => void;
  private readonly inst: UseableItemInst;

  constructor(inst: UseableItemInst) { this.inst = inst; }

  SetOnUseFn(fn: (inst: UseableItemInst) => boolean | void): void { this.onusefn = fn; }
  SetOnStopUseFn(fn: (inst: UseableItemInst) => void): void { this.onstopusefn = fn; }
  CanInteract(): boolean { return !this.inuseState.peek() && this.inst.isEquipped(); }

  private setInUse(inuse: boolean): void {
    this.inuseState.set(inuse);
    if (inuse) this.inst.addTag('inuse'); else this.inst.removeTag('inuse');
  }
  StartUsingItem(): boolean {
    this.setInUse(true);
    if (this.onusefn) this.setInUse(this.onusefn(this.inst) !== false);
    return this.inuseState.peek();
  }
  StopUsingItem(): void {
    this.setInUse(false);
    this.onstopusefn?.(this.inst);
  }
  /** OnRemoveFromEntity */
  dispose(): void { this.inst.removeTag('inuse'); this.onusefn = undefined; this.onstopusefn = undefined; }
}
