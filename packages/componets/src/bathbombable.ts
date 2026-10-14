import { createSignal, readonlySignal } from '../../signals/src';

export interface BathBombableInst { addTag(tag: string): void; removeTag(tag: string): void; }
type BathBombedFn<Item, Doer> = (inst: BathBombableInst, item: Item | undefined, doer: Doer | undefined) => void;

/** bathbombable.lua: the `bathbombable` tag is a pure view of can_be_bathbombed. */
export class BathBombable<Item = unknown, Doer = unknown> {
  private readonly canState = createSignal(true);
  private readonly bombedState = createSignal(false);
  readonly canBeBathBombed = readonlySignal(this.canState);
  readonly isBathBombed = readonlySignal(this.bombedState);
  private onbathbombedfn?: BathBombedFn<Item, Doer>;
  private readonly inst: BathBombableInst;
  private disposed = false;
  constructor(inst: BathBombableInst) { this.inst = inst; inst.addTag('bathbombable'); }
  get can_be_bathbombed(): boolean { return this.canState.peek(); }
  get is_bathbombed(): boolean { return this.bombedState.peek(); }
  private setState(can: boolean, bombed: boolean): void {
    this.bombedState.set(bombed);
    this.canState.set(can);
    if (this.disposed) return;
    if (can) this.inst.addTag('bathbombable'); else this.inst.removeTag('bathbombable');
  }
  SetOnBathBombedFn(fn: BathBombedFn<Item, Doer>): void { this.onbathbombedfn = fn; }
  OnBathBombed(item?: Item, doer?: Doer): void {
    this.setState(false, true);
    this.onbathbombedfn?.(this.inst, item, doer);
  }
  DisableBathBombing(): void { this.setState(false, false); }
  Reset(): void { this.setState(true, false); }
  OnRemoveFromEntity(): void {
    if (this.disposed) return;
    this.disposed = true; this.inst.removeTag('bathbombable');
  }
  dispose(): void { this.OnRemoveFromEntity(); this.onbathbombedfn = undefined; }
}
