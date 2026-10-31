import { batch, createMemo, createSignal, readonlySignal } from '@dontstarve-web/signals';
import type { EquipmentKind } from '../../inventory/src/types';
import type { Equippable, EquippableOwner } from './equippable';
import { SourceModifierList } from './sourcemodifierlist';

export interface SanityInst extends EquippableOwner {
  readonly components: {
    inventory?: { GetEquippedItem(slot: EquipmentKind): {
      readonly isRemoved: boolean;
      readonly components: { equippable?: Pick<Equippable, 'GetDapperness'> };
    } | null };
    health?: { IsInvincible(): boolean };
    sanity?: { IsInsanityMode(): boolean; GetPercent(): number };
  };
  readonly sg?: { hasStateTag(tag: string): boolean };
  readonly is_teleporting?: boolean;
  PushEvent?(name: string, data?: unknown): void;
}

export const SANITY_MODE_INSANITY = 0;
export const SANITY_MODE_LUNACY = 1;
export type SanityMode = typeof SANITY_MODE_INSANITY | typeof SANITY_MODE_LUNACY;
export interface SanitySaveData { current: number; sane: boolean; mode: SanityMode }

/** sanity.lua's state, transitions, penalties, mode and equipment-rate branches. */
export class Sanity {
  private readonly inst: SanityInst;
  private readonly currentState = createSignal(100);
  private readonly maximumState = createSignal(100);
  private readonly saneState = createSignal(true);
  private readonly modeState = createSignal<SanityMode>(SANITY_MODE_INSANITY);
  private readonly penaltyState = createSignal(0);
  private readonly inducedInsanity = createSignal<ReadonlySet<unknown>>(new Set());
  private readonly inducedLunacy = createSignal<ReadonlySet<unknown>>(new Set());
  private readonly lunacySources = new Set<unknown>();
  private readonly penalties = new Map<unknown, number>();
  readonly value = readonlySignal(this.currentState);
  readonly maximum = readonlySignal(this.maximumState);
  readonly percent = createMemo(() => this.inducedInsanity.get().size ? 0
    : this.inducedLunacy.get().size ? 1 - this.penaltyState.get() : this.currentState.get() / this.maximumState.get());
  readonly sane = createMemo(() => {
    const sane = this.saneState.get(), mode = this.modeState.get();
    const insanity = this.inducedInsanity.get().size > 0, lunacy = this.inducedLunacy.get().size > 0;
    return mode === SANITY_MODE_INSANITY ? (sane && !insanity) || lunacy : (sane && !lunacy) || insanity;
  });
  dapperness = 0;
  dapperness_mult = 1;
  rate_modifier = 1;
  no_moisture_penalty = false;
  ignore = false;
  rate = 0;
  readonly externalmodifiers = new SourceModifierList(0, (a, b) => a + b);
  custom_rate_fn?: (inst: SanityInst, dt: number) => number;
  redirect?: (inst: SanityInst, delta: number, overtime?: boolean) => void;
  onSane?: (inst: SanityInst) => void;
  onInsane?: (inst: SanityInst) => void;
  onEnlightened?: (inst: SanityInst) => void;
  private disposed = false;
  private oldPercent = 1;
  private oldIsSane = true;
  private oldMode: SanityMode = SANITY_MODE_INSANITY;

  constructor(inst: SanityInst, maximum = 100) { this.inst = inst; this.SetMax(maximum); }
  get current(): number { return this.currentState.peek(); }
  get max(): number { return this.maximumState.peek(); }
  get mode(): SanityMode { return this.modeState.peek(); }
  get penalty(): number { return this.penaltyState.peek(); }
  IsSane(): boolean {
    return this.IsInsanityMode() ? (this.saneState.peek() && !this.inducedInsanity.peek().size) || !!this.inducedLunacy.peek().size
      : (this.saneState.peek() && !this.inducedLunacy.peek().size) || !!this.inducedInsanity.peek().size;
  }
  IsInsane(): boolean { return this.IsInsanityMode() && (!this.saneState.peek() || !!this.inducedInsanity.peek().size) && !this.inducedLunacy.peek().size; }
  IsEnlightened(): boolean { return this.IsLunacyMode() && (!this.saneState.peek() || !!this.inducedLunacy.peek().size) && !this.inducedInsanity.peek().size; }
  IsCrazy(): boolean { return this.IsInsane() || this.IsEnlightened(); }
  IsInsanityMode(): boolean { return this.mode === SANITY_MODE_INSANITY; }
  IsLunacyMode(): boolean { return this.mode === SANITY_MODE_LUNACY; }
  GetSanityMode(): SanityMode { return this.mode; }
  GetRealPercent(): number { return this.current / this.max; }
  GetPercent(): number { return this.inducedInsanity.peek().size ? 0 : this.inducedLunacy.peek().size ? 1 - this.penalty : this.GetRealPercent(); }
  GetPercentWithPenalty(): number { return this.inducedInsanity.peek().size ? 0 : this.inducedLunacy.peek().size ? 1 : this.current / this.GetMaxWithPenalty(); }
  GetPenaltyPercent(): number { return this.penalty; }
  GetMaxWithPenalty(): number { return this.max * (1 - this.penalty); }
  SetMax(amount: number): void {
    if (finite(amount) <= 0) throw new RangeError('Maximum sanity must be positive');
    batch(() => { this.maximumState.set(amount); this.currentState.set(amount); });
    this.DoDelta(0);
  }
  SetCurrent(amount: number): void { this.currentState.set(finite(amount)); this.DoDelta(0); }
  SetPercent(percent: number, overtime?: boolean): void { this.DoDelta(finite(percent) * this.max - this.current, overtime); }
  AddSanityPenalty(key: unknown, modifier: number): void { this.penalties.set(key, finite(modifier)); this.RecalculatePenalty(); }
  RemoveSanityPenalty(key: unknown): void { this.penalties.delete(key); this.RecalculatePenalty(); }
  RecalculatePenalty(): void {
    this.penaltyState.set(Math.min([...this.penalties.values()].reduce((a, b) => a + b, 0), 1 - 5 / this.max));
    this.DoDelta(0);
  }
  EnableLunacy(enabled: boolean, source: unknown): void {
    if (enabled) this.lunacySources.add(source); else this.lunacySources.delete(source);
    this.UpdateMode_Internal();
  }
  UpdateMode_Internal(): void {
    const mode = this.lunacySources.size ? SANITY_MODE_LUNACY : SANITY_MODE_INSANITY;
    if (mode === this.mode) return;
    this.modeState.set(mode); this.inst.PushEvent?.('sanitymodechanged', { mode }); this.DoDelta(0);
  }
  SetInducedInsanity(source: unknown, enabled: boolean): void { this.setInduced(this.inducedInsanity, source, enabled); }
  SetInducedLunacy(source: unknown, enabled: boolean): void { this.setInduced(this.inducedLunacy, source, enabled); }
  private setInduced(state: typeof this.inducedInsanity, source: unknown, enabled: boolean): void {
    const sources = new Set(state.peek());
    if (enabled) sources.add(source); else sources.delete(source);
    state.set(sources); this.DoDelta(0);
  }
  DoDelta(delta: number, overtime?: boolean): void {
    finite(delta);
    if (this.disposed) return;
    if (this.redirect) { this.redirect(this.inst, delta, overtime); return; }
    if (this.ignore) return;
    batch(() => {
      this.currentState.set(Math.min(Math.max(this.current + delta, 0), this.GetMaxWithPenalty()));
      const percent = this.GetRealPercent(), sane = this.saneState.peek();
      if (this.IsInsanityMode()) {
        if (sane && percent <= 30 / 200) this.saneState.set(false);
        else if (!sane && percent >= 35 / 200) this.saneState.set(true);
      } else {
        if (sane && percent >= 170 / 200) this.saneState.set(false);
        else if (!sane && percent <= 165 / 200) this.saneState.set(true);
      }
    });
    this.inst.PushEvent?.('sanitydelta', { oldpercent: this.oldPercent, newpercent: this.GetPercent(), overtime, sanitymode: this.mode });
    this.oldPercent = this.GetPercent();
    const sane = this.IsSane();
    if (sane !== this.oldIsSane || (!this.oldIsSane && this.mode !== this.oldMode)) {
      this.oldIsSane = sane;
      if (sane) { this.onSane?.(this.inst); this.inst.PushEvent?.('gosane'); }
      else if (this.IsInsanityMode()) { this.onInsane?.(this.inst); this.inst.PushEvent?.('goinsane'); }
      else { this.onEnlightened?.(this.inst); this.inst.PushEvent?.('goenlightened'); }
    }
    this.oldMode = this.mode;
  }
  GetRate(dt = 0): number {
    if (this.disposed || this.isUpdatingBlocked()) return 0;
    let dapperness = 0;
    if (this.dapperness_mult !== 0) {
      dapperness = this.dapperness;
      for (const slot of ['hand', 'head', 'body'] as const) {
        const item = this.inst.components.inventory?.GetEquippedItem(slot);
        if (item && !item.isRemoved) dapperness += item.components.equippable?.GetDapperness(this.inst, this.no_moisture_penalty) ?? 0;
      }
      dapperness *= this.dapperness_mult;
    }
    return (dapperness + this.externalmodifiers.Get() + (this.custom_rate_fn?.(this.inst, dt) ?? 0)) * this.rate_modifier;
  }
  private isUpdatingBlocked(): boolean {
    return (this.ignore && !this.redirect) || !!this.inst.components.health?.IsInvincible()
      || this.inst.hasTag('spawnprotection') || !!this.inst.sg?.hasStateTag('sleeping') || this.inst.is_teleporting === true;
  }
  OnUpdate(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    this.UpdateMode_Internal();
    if (this.isUpdatingBlocked()) { this.rate = 0; return; }
    this.rate = this.GetRate(dt);
    this.DoDelta(this.rate * dt, true);
  }
  OnSave(): SanitySaveData { return { current: this.current, sane: this.saneState.peek(), mode: this.mode }; }
  OnLoad(data: Partial<SanitySaveData>): void {
    const current = data.current === undefined ? this.current : finite(data.current);
    const mode = data.mode ?? SANITY_MODE_INSANITY;
    if (mode !== SANITY_MODE_INSANITY && mode !== SANITY_MODE_LUNACY) throw new RangeError('Invalid sanity mode');
    batch(() => {
      if (data.sane !== undefined) this.saneState.set(data.sane);
      this.modeState.set(mode); this.currentState.set(current);
    });
    if (data.current !== undefined) this.DoDelta(0);
  }
  dispose(): void { this.disposed = true; this.externalmodifiers.Reset(); this.percent.dispose(); this.sane.dispose(); }
}

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Sanity must be finite');
  return value;
}
