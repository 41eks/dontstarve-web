import { createMemo, createSignal, readonlySignal, type ReadonlySignal } from '../../signals/src';
import type { FuelItem } from './fuel';
import type { GameTimeScheduler } from './gameTimeScheduler';
import type { TimerSnapshot } from './timer';
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
/** FUELTYPE.USAGE: worn items that are repaired by sewing. */
const USAGE = 'USAGE';

/**
 * components/fueled.lua. StartConsuming runs DoPeriodicTask(period, OnDoUpdate) on the game time of the scheduler the
 * inst is bound to; an inventory item is bound with its world and keeps consuming across owners. `Settle` consumes the
 * elapsed part of the current period before the inst is saved, moved or stops consuming.
 */
export class Fueled<Inst extends FueledInst = FueledInst> {
  private readonly current = createSignal(0);
  private readonly maximum = createSignal(0);
  /** currentfuel, as a read-only signal. */
  readonly fuel = readonlySignal(this.current);
  /** GetPercent, derived from currentfuel and maxfuel. */
  readonly percent = createMemo(() => {
    const maxfuel = this.maximum.get();
    return maxfuel > 0 ? Math.max(0, Math.min(1, this.current.get() / maxfuel)) : 0;
  });
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
  private depleted?: (inst: Inst) => void;
  private firstperiod?: number;
  private firstperiodfull?: number;
  private scheduler?: GameTimeScheduler;
  /** DoPeriodicTask(self.period, OnDoUpdate) while consuming, and the game time consumption was settled to. */
  private task?: { readonly scheduler: GameTimeScheduler; readonly timer: ComponentTimer; settledAt: number };
  /** StartWallUpdatingComponent for the first period: OnWallUpdate charges `firstperioddt` on the next update. */
  private firstperiodtask?: { readonly timer: ComponentTimer; readonly dt: number };
  /** The first period of consumption started before the inst had a scheduler. */
  private pendingfirstperioddt?: number;
  private readonly timerState = createSignal<ReadonlySignal<TimerSnapshot> | undefined>(undefined);
  /** The consuming task's timer, while consuming on a scheduler. */
  readonly timer = readonlySignal(this.timerState);
  private readonly inst: Inst;

  constructor(inst: Inst, scheduler?: GameTimeScheduler) {
    this.inst = inst;
    this.scheduler = scheduler;
    this.setCurrent(0);
  }

  get currentfuel(): number { return this.current.peek(); }
  get maxfuel(): number { return this.maximum.peek(); }
  set maxfuel(value: number) { this.maximum.set(value); this.onmaxfuel(); }
  get consuming(): boolean { return this.consumingState; }
  /** onfueltype: USAGE marks needssewing instead of accepting fuel. */
  get fueltype(): string { return this.type; }
  set fueltype(value: string) {
    this.inst.removeTag(this.type === USAGE ? 'needssewing' : `${this.type}_fueled`);
    this.type = value;
    if (value === USAGE) this.onmaxfuel();
    else if (this.acceptingState) this.inst.addTag(`${value}_fueled`);
  }
  get accepting(): boolean { return this.acceptingState; }
  set accepting(value: boolean) {
    this.acceptingState = value;
    if (this.type === USAGE) return;
    if (value) this.inst.addTag(`${this.type}_fueled`);
    else this.inst.removeTag(`${this.type}_fueled`);
  }

  SetSections(num: number): void { this.sections = num; }
  SetSectionCallback(fn: SectionFn<Inst>): void { this.sectionfn = fn; }
  SetDepletedFn(fn: (inst: Inst) => void): void { this.depleted = fn; }
  SetUpdateFn(fn?: (inst: Inst) => void): void { this.updatefn = fn; }
  SetTakeFuelFn(fn: (inst: Inst, fuelvalue: number) => void): void { this.ontakefuelfn = fn; }
  SetFirstPeriod(firstperiod: number, firstperiodfull?: number): void {
    this.firstperiod = firstperiod;
    this.firstperiodfull = firstperiodfull;
  }

  IsEmpty(): boolean { return this.currentfuel <= 0; }
  IsFull(): boolean { return this.maxfuel > 0 && this.currentfuel >= this.maxfuel; }
  GetPercent(): number { return this.maxfuel > 0 ? Math.max(0, Math.min(1, this.currentfuel / this.maxfuel)) : 0; }
  GetCurrentSection(): number {
    return this.IsEmpty() ? 0 : Math.min(Math.floor(this.GetPercent() * this.sections) + 1, this.sections);
  }
  GetSectionPercent(): number { return this.GetPercent() * this.sections - this.GetCurrentSection() + 1; }

  CanAcceptFuelItem(item: Pick<FuelItem, 'components'> | undefined): boolean {
    return this.acceptingState && !!item?.components.fuel && item.components.fuel.fueltype === this.type;
  }

  TakeFuelItem(item: FuelItem, doer?: unknown): boolean {
    if (this.inst.isRemoved || item.isRemoved || !this.CanAcceptFuelItem(item)) return false;
    // The fuel joins what is left at this moment.
    this.Settle();
    if (this.inst.isRemoved) return false;
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
      if (this.currentfuel <= 0) this.depleted?.(this.inst);
    }
    this.inst.PushEvent?.('percentusedchange', { percent: this.GetPercent() });
  }

  MakeEmpty(): void { if (this.currentfuel > 0) this.DoDelta(-this.currentfuel); }
  SetPercent(amount: number): void { this.DoDelta(this.maxfuel * amount - this.currentfuel); }

  StartConsuming(): void {
    this.consumingState = true;
    if (this.task || this.inst.isRemoved) return;
    const firstperioddt = this.firstperiod === undefined ? undefined
      : this.currentfuel >= this.maxfuel ? this.firstperiodfull ?? this.firstperiod : this.firstperiod;
    if (this.scheduler) this.startTask(this.scheduler, firstperioddt);
    else this.pendingfirstperioddt = firstperioddt;
  }

  /** Consume the part of the current period that has passed. */
  Settle(): void {
    const task = this.task;
    if (!task) return;
    const dt = task.scheduler.now - task.settledAt;
    // Settle first: consumption may remove the inst and stop consuming.
    task.settledAt = task.scheduler.now;
    if (dt > 0) this.DoUpdate(dt);
  }

  /** The inst's world was bound or replaced: consumption continues on its game time. */
  BindScheduler(scheduler: GameTimeScheduler | undefined): void {
    if (this.scheduler === scheduler) return;
    this.Settle();
    const firstperioddt = this.firstperiodtask?.dt ?? this.pendingfirstperioddt;
    this.stopTask();
    this.scheduler = scheduler;
    if (!this.consumingState || this.inst.isRemoved) return;
    if (scheduler) this.startTask(scheduler, firstperioddt);
    else this.pendingfirstperioddt = firstperioddt;
  }

  DoUpdate(dt: number): void {
    if (this.consumingState) this.DoDelta(-dt * this.rate);
    if (this.IsEmpty()) this.StopConsuming();
    this.updatefn?.(this.inst);
  }
  LongUpdate(dt: number): void { this.DoUpdate(dt); }

  StopConsuming(): void {
    // The first period is cancelled uncharged, as StopWallUpdatingComponent does.
    this.firstperiodtask?.timer.stop();
    this.firstperiodtask = undefined;
    this.pendingfirstperioddt = undefined;
    this.Settle();
    this.consumingState = false;
    this.stopTask();
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
    this.inst.removeTag(this.type === USAGE ? 'needssewing' : `${this.type}_fueled`);
    this.inst.removeTag('fueldepleted');
    this.sectionfn = undefined; this.updatefn = undefined; this.ontakefuelfn = undefined; this.depleted = undefined;
    this.percent.dispose();
  }

  private startTask(scheduler: GameTimeScheduler, firstperioddt?: number): void {
    this.pendingfirstperioddt = undefined;
    const timer = new ComponentTimer(scheduler, () => {
      if (this.task?.timer !== timer || this.inst.isRemoved) return;
      timer.start(this.period);
      this.Settle();
    });
    this.task = { scheduler, timer, settledAt: scheduler.now };
    this.timerState.set(timer.snapshot);
    timer.start(this.period);
    if (firstperioddt === undefined) return;
    const first = new ComponentTimer(scheduler, () => {
      if (this.firstperiodtask?.timer !== first) return;
      this.firstperiodtask = undefined;
      this.DoUpdate(firstperioddt);
    });
    this.firstperiodtask = { timer: first, dt: firstperioddt };
    first.start(0);
  }

  private stopTask(): void {
    this.firstperiodtask?.timer.stop();
    this.firstperiodtask = undefined;
    this.task?.timer.stop();
    this.task = undefined;
    this.timerState.set(undefined);
  }

  /** oncurrentfuel */
  private setCurrent(fuel: number): void {
    this.current.set(fuel);
    if (fuel <= 0) this.inst.addTag('fueldepleted');
    else this.inst.removeTag('fueldepleted');
    this.onmaxfuel();
  }

  /** onmaxfuel: a USAGE inst below its maximum needs sewing. */
  private onmaxfuel(): void {
    if (this.type !== USAGE) return;
    if (this.currentfuel < this.maxfuel) this.inst.addTag('needssewing');
    else this.inst.removeTag('needssewing');
  }
}
