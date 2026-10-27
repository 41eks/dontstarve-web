import { createSignal, readonlySignal } from '../../signals/src';
import type { FuelItem } from './fuel';
import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';

export interface FueledInst {
  readonly isRemoved: boolean;
  addTag(tag: string): void;
  removeTag(tag: string): void;
  PushEvent?(name: string, data: unknown): void;
}

/** fueled.lua OnSave: only a fuel level other than full is written. */
export interface FueledSave { fuel: number }

type SectionFn<Inst> = (newsection: number, oldsection: number, inst: Inst, doer?: unknown) => void;

/** tuning.lua WET_FUEL_PENALTY. */
const WET_FUEL_PENALTY = .75;

/**
 * components/fueled.lua for world entities (firepit): sections, the consuming periodic task on game time and
 * TakeFuelItem. Inventory items keep their frame-batched FueledComponent in packages/inventory.
 */
export class Fueled<Inst extends FueledInst = FueledInst> {
  private readonly current = createSignal(0);
  /** currentfuel, as a read-only signal. */
  readonly fuel = readonlySignal(this.current);
  maxfuel = 0;
  rate = 1;
  sections = 1;
  period = 1;
  bonusmult = 1;
  private consumingState = false;
  private type = 'BURNABLE';
  private acceptingState = false;
  private sectionfn?: SectionFn<Inst>;
  private updatefn?: (inst: Inst) => void;
  private ontakefuelfn?: (inst: Inst, fuelvalue: number) => void;
  /** DoPeriodicTask(self.period, OnDoUpdate) while consuming. */
  private readonly task: ComponentTimer;
  readonly timer;
  private readonly inst: Inst;

  constructor(inst: Inst, scheduler: GameTimeScheduler) {
    this.inst = inst;
    this.task = new ComponentTimer(scheduler, () => {
      if (this.inst.isRemoved) return;
      this.task.start(this.period);
      this.DoUpdate(this.period);
    });
    this.timer = this.task.snapshot;
    this.setCurrent(0);
  }

  get currentfuel(): number { return this.current.peek(); }
  get consuming(): boolean { return this.consumingState; }
  get fueltype(): string { return this.type; }
  set fueltype(value: string) {
    this.inst.removeTag(`${this.type}_fueled`);
    this.type = value;
    if (this.acceptingState) this.inst.addTag(`${value}_fueled`);
  }
  get accepting(): boolean { return this.acceptingState; }
  set accepting(value: boolean) {
    this.acceptingState = value;
    if (value) this.inst.addTag(`${this.type}_fueled`);
    else this.inst.removeTag(`${this.type}_fueled`);
  }

  SetSections(num: number): void { this.sections = num; }
  SetSectionCallback(fn: SectionFn<Inst>): void { this.sectionfn = fn; }
  SetUpdateFn(fn: (inst: Inst) => void): void { this.updatefn = fn; }
  SetTakeFuelFn(fn: (inst: Inst, fuelvalue: number) => void): void { this.ontakefuelfn = fn; }

  IsEmpty(): boolean { return this.currentfuel <= 0; }
  GetPercent(): number { return this.maxfuel > 0 ? Math.max(0, Math.min(1, this.currentfuel / this.maxfuel)) : 0; }
  GetCurrentSection(): number {
    return this.IsEmpty() ? 0 : Math.min(Math.floor(this.GetPercent() * this.sections) + 1, this.sections);
  }
  GetSectionPercent(): number { return this.GetPercent() * this.sections - this.GetCurrentSection() + 1; }

  CanAcceptFuelItem(item: Pick<FuelItem, 'components'> | undefined): boolean {
    return this.acceptingState && !!item?.components.fuel && item.components.fuel.fueltype === this.type;
  }

  TakeFuelItem(item: FuelItem, doer?: unknown): boolean {
    if (item.isRemoved || !this.CanAcceptFuelItem(item)) return false;
    const fuel = item.components.fuel!;
    const fuelvalue = fuel.fuelvalue * this.bonusmult * (item.GetIsWet() ? WET_FUEL_PENALTY : 1);
    this.DoDelta(fuelvalue, doer);
    fuel.Taken(this.inst);
    item.remove();
    this.ontakefuelfn?.(this.inst, fuelvalue);
    this.inst.PushEvent?.('takefuel', { fuelvalue });
    return true;
  }

  InitializeFuelLevel(fuel: number): void {
    const oldsection = this.GetCurrentSection();
    if (this.maxfuel < fuel) this.maxfuel = fuel;
    this.setCurrent(fuel);
    const newsection = this.GetCurrentSection();
    if (oldsection !== newsection) {
      this.sectionfn?.(newsection, oldsection, this.inst);
      this.inst.PushEvent?.('onfueldsectionchanged', { newsection, oldsection });
    }
  }

  DoDelta(amount: number, doer?: unknown): void {
    const oldsection = this.GetCurrentSection();
    this.setCurrent(Math.max(0, Math.min(this.maxfuel, this.currentfuel + amount)));
    const newsection = this.GetCurrentSection();
    if (oldsection !== newsection) {
      this.sectionfn?.(newsection, oldsection, this.inst, doer);
      this.inst.PushEvent?.('onfueldsectionchanged', { newsection, oldsection, doer });
    }
    this.inst.PushEvent?.('percentusedchange', { percent: this.GetPercent() });
  }

  MakeEmpty(): void { if (this.currentfuel > 0) this.DoDelta(-this.currentfuel); }
  SetPercent(amount: number): void { this.DoDelta(this.maxfuel * amount - this.currentfuel); }

  StartConsuming(): void {
    this.consumingState = true;
    if (this.task.snapshot.peek().status !== 'scheduled') this.task.start(this.period);
  }
  StopConsuming(): void {
    this.consumingState = false;
    this.task.stop();
  }

  DoUpdate(dt: number): void {
    if (this.consumingState) this.DoDelta(-dt * this.rate);
    if (this.IsEmpty()) this.StopConsuming();
    this.updatefn?.(this.inst);
  }

  OnSave(): FueledSave | undefined {
    return this.currentfuel !== this.maxfuel ? { fuel: this.currentfuel } : undefined;
  }
  OnLoad(data: Partial<FueledSave>): void {
    if (data.fuel !== undefined) this.InitializeFuelLevel(Math.max(0, data.fuel));
  }

  /** OnRemoveFromEntity. */
  dispose(): void {
    this.StopConsuming();
    this.inst.removeTag(`${this.type}_fueled`);
    this.inst.removeTag('fueldepleted');
    this.sectionfn = undefined; this.updatefn = undefined; this.ontakefuelfn = undefined;
  }

  private setCurrent(fuel: number): void {
    this.current.set(fuel);
    if (fuel <= 0) this.inst.addTag('fueldepleted');
    else this.inst.removeTag('fueldepleted');
  }
}
