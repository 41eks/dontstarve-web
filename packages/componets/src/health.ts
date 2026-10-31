import { batch, createMemo, createSignal, readonlySignal, type Memo, type ReadonlySignal, type Signal } from '../../signals/src';

export interface HealthSaveData {
  health: number;
  maxhealth: number;
  penalty?: number;
}

/** Lua saves may omit maxhealth; setpieces may supply percent instead of health. */
export interface HealthLoadData {
  health?: number;
  maxhealth?: number;
  percent?: number;
  penalty?: number;
  invincible?: boolean;
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}

function maximum(value: number): number {
  if (finite(value, 'maxhealth') <= 0) throw new RangeError('maxhealth must be positive');
  return value;
}

function clamp(value: number, maxhealth: number): number {
  return Math.max(0, Math.min(value, maxhealth));
}

export interface HealthInst {
  hasTag?(tag: string): boolean;
  PushEvent?(name: string, data: unknown): void;
  readonly sg?: { hasStateTag?(tag: string): boolean; HasStateTag?(tag: string): boolean };
  readonly is_teleporting?: boolean;
}

export interface HealthAfflicter { hasTag(tag: string): boolean }

/** tuning.lua MAXIMUM_HEALTH_PENALTY. */
export const MAXIMUM_HEALTH_PENALTY = .75;

/** health.lua state; current and maximum health are signals so presentation can derive from them. */
export class Health {
  private readonly maximumState: Signal<number>;
  private readonly currentState: Signal<number>;
  /** Read-only views of maxhealth / currenthealth. */
  readonly maximum: ReadonlySignal<number>;
  readonly current: ReadonlySignal<number>;
  readonly percent: Memo<number>;
  private readonly penaltyState = createSignal(0);
  readonly maxWithPenalty: Memo<number>;
  invincible = false;
  /** SetAbsorptionAmountFromPlayer; added to absorb only for player afflicters. */
  playerabsorb = 0;
  absorb = 0;
  /** Healing action capability; Lua still allows repair and other direct DoDelta calls when false. */
  canheal = true;
  nofadeout = false;
  ondelta?: (inst: HealthInst, oldPercent: number, newPercent: number, overtime?: boolean, cause?: string, afflicter?: HealthAfflicter, amount?: number) => void;
  readonly inst: HealthInst;

  constructor(maxhealth = 100, inst: HealthInst = {}) {
    this.inst = inst;
    this.maximumState = createSignal(maximum(maxhealth));
    this.currentState = createSignal(this.maximumState.peek());
    this.maximum = readonlySignal(this.maximumState);
    this.current = readonlySignal(this.currentState);
    this.percent = createMemo(() => this.currentState.get() / this.maximumState.get());
    this.maxWithPenalty = createMemo(() => this.maximumState.get() * (1 - this.penaltyState.get()));
  }

  get maxhealth(): number { return this.maximumState.peek(); }
  get currenthealth(): number { return this.currentState.peek(); }
  get penalty(): number { return this.penaltyState.peek(); }

  SetInvincible(value: boolean): void {
    this.invincible = value;
    this.inst.PushEvent?.('invincibletoggle', { invincible: value });
  }
  IsInvincible(): boolean {
    return this.invincible || (this.inst.sg?.hasStateTag?.('temp_invincible')
      ?? this.inst.sg?.HasStateTag?.('temp_invincible') ?? false);
  }
  SetPenalty(penalty: number): void {
    this.penaltyState.set(Math.max(0, Math.min(finite(penalty, 'penalty'), MAXIMUM_HEALTH_PENALTY)));
  }
  DeltaPenalty(delta: number): void {
    this.SetPenalty(this.penalty + finite(delta, 'penalty delta'));
    this.ForceUpdateHUD(false);
  }
  GetMaxWithPenalty(): number { return this.maxhealth * (1 - this.penalty); }
  GetPercentWithPenalty(): number { return this.currenthealth / this.GetMaxWithPenalty(); }
  ForceUpdateHUD(overtime?: boolean): void { this.DoDelta(0, overtime, undefined, true, undefined, true); }

  /** As in Lua, configuring maximum health also fills the health bar. */
  SetMaxHealth(amount: number): void {
    const value = maximum(amount);
    batch(() => { this.maximumState.set(value); this.currentState.set(value); });
    this.ForceUpdateHUD(true);
  }

  /** Lua sets the field directly, without clamping, events or ondelta. */
  SetCurrentHealth(amount: number): void {
    this.currentState.set(finite(amount, 'health'));
  }

  SetAbsorptionAmountFromPlayer(amount: number): void { this.playerabsorb = finite(amount, 'playerabsorb'); }

  SetVal(value: number, cause?: string, afflicter?: HealthAfflicter): void {
    const old = this.currentState.peek();
    this.currentState.set(clamp(finite(value, 'health'), this.GetMaxWithPenalty()));
    // health.lua pushes "death" when health first reaches zero.
    if (old > 0 && this.currentState.peek() <= 0) this.inst.PushEvent?.('death', { cause, afflicter });
  }

  /** Positive amounts heal; negative amounts damage after absorption. Returns the applied delta, as in Lua. */
  DoDelta(amount: number, overtime?: boolean, cause?: string, ignoreInvincible = false, afflicter?: HealthAfflicter, ignoreAbsorb = false): number {
    finite(amount, 'amount');
    if (!ignoreInvincible && (this.IsInvincible() || this.inst.is_teleporting)) return 0;
    const oldPercent = this.GetPercent();
    if (amount < 0 && !ignoreAbsorb) {
      const absorb = this.playerabsorb !== 0 && afflicter?.hasTag('player') ? this.playerabsorb + this.absorb : this.absorb;
      amount *= Math.max(0, Math.min(1, 1 - absorb));
    }
    this.SetVal(this.currentState.peek() + amount, cause, afflicter);
    this.inst.PushEvent?.('healthdelta', { oldpercent: oldPercent, newpercent: this.GetPercent(), overtime, cause, afflicter, amount });
    this.ondelta?.(this.inst, oldPercent, this.GetPercent(), overtime, cause, afflicter, amount);
    return amount;
  }

  GetPercent(): number { return this.currenthealth / this.maxhealth; }

  SetPercent(percent: number, overtime?: boolean, cause?: string): void {
    this.SetVal(Math.max(0, Math.min(finite(percent, 'percent'), 1)) * this.maximumState.peek(), cause);
    this.DoDelta(0, overtime, cause, true, undefined, true);
  }

  IsDead(): boolean { return this.currentState.peek() <= 0; }
  IsHurt(): boolean { return this.currentState.peek() < this.GetMaxWithPenalty(); }

  /** Always include the maximum so this component can restore without prefab metadata. */
  OnSave(): HealthSaveData {
    return { health: this.currentState.peek(), maxhealth: this.maximumState.peek(),
      ...(this.penalty > 0 ? { penalty: this.penalty } : {}) };
  }

  OnLoad(data: HealthLoadData): void {
    // Validate the complete change before applying it to avoid a partial load.
    const maxhealth = data.maxhealth === undefined ? this.maximumState.peek() : maximum(data.maxhealth);
    const penalty = data.penalty === undefined ? this.penalty
      : Math.max(0, Math.min(finite(data.penalty, 'penalty'), MAXIMUM_HEALTH_PENALTY));
    const health = data.health !== undefined ? finite(data.health, 'health')
      : data.percent !== undefined ? Math.max(0, Math.min(finite(data.percent, 'percent'), 1)) * maxhealth
      : this.currentState.peek();
    batch(() => {
      this.maximumState.set(maxhealth); this.penaltyState.set(penalty);
      this.currentState.set(clamp(health, maxhealth * (1 - penalty)));
      if (data.invincible !== undefined) this.invincible = data.invincible;
    });
  }

  dispose(): void { this.percent.dispose(); this.maxWithPenalty.dispose(); this.ondelta = undefined; }
}

export default Health;
