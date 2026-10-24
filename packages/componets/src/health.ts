import { batch, createMemo, createSignal, readonlySignal, type Memo, type ReadonlySignal, type Signal } from '../../signals/src';

export interface HealthSaveData {
  health: number;
  maxhealth: number;
}

/** Lua saves may omit maxhealth; setpieces may supply percent instead of health. */
export interface HealthLoadData {
  health?: number;
  maxhealth?: number;
  percent?: number;
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
}

export interface HealthAfflicter { hasTag(tag: string): boolean }

/** health.lua state; current and maximum health are signals so presentation can derive from them. */
export class Health {
  private readonly maximumState: Signal<number>;
  private readonly currentState: Signal<number>;
  /** Read-only views of maxhealth / currenthealth. */
  readonly maximum: ReadonlySignal<number>;
  readonly current: ReadonlySignal<number>;
  readonly percent: Memo<number>;
  /** SetAbsorptionAmountFromPlayer; added to absorb only for player afflicters. */
  playerabsorb = 0;
  absorb = 0;
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
  }

  get maxhealth(): number { return this.maximumState.peek(); }
  get currenthealth(): number { return this.currentState.peek(); }

  /** As in Lua, configuring maximum health also fills the health bar. */
  SetMaxHealth(amount: number): void {
    const value = maximum(amount);
    batch(() => { this.maximumState.set(value); this.currentState.set(value); });
  }

  /** Lua sets the field directly, without clamping, events or ondelta. */
  SetCurrentHealth(amount: number): void {
    this.currentState.set(finite(amount, 'health'));
  }

  SetAbsorptionAmountFromPlayer(amount: number): void { this.playerabsorb = finite(amount, 'playerabsorb'); }

  SetVal(value: number): void {
    const old = this.currentState.peek();
    this.currentState.set(clamp(finite(value, 'health'), this.maximumState.peek()));
    // health.lua pushes "death" when health first reaches zero.
    if (old > 0 && this.currentState.peek() <= 0) this.inst.PushEvent?.('death', undefined);
  }

  /** Positive amounts heal; negative amounts damage after absorption. Returns the applied delta, as in Lua. */
  DoDelta(amount: number, overtime?: boolean, cause?: string, _ignoreInvincible?: boolean, afflicter?: HealthAfflicter, ignoreAbsorb = false): number {
    finite(amount, 'amount');
    const oldPercent = this.GetPercent();
    if (amount < 0 && !ignoreAbsorb) {
      const absorb = this.playerabsorb !== 0 && afflicter?.hasTag('player') ? this.playerabsorb + this.absorb : this.absorb;
      amount *= Math.max(0, Math.min(1, 1 - absorb));
    }
    this.SetVal(this.currentState.peek() + amount);
    this.inst.PushEvent?.('healthdelta', { oldpercent: oldPercent, newpercent: this.GetPercent(), overtime, cause, afflicter, amount });
    this.ondelta?.(this.inst, oldPercent, this.GetPercent(), overtime, cause, afflicter, amount);
    return amount;
  }

  GetPercent(): number { return this.percent.peek(); }

  SetPercent(percent: number): void {
    this.SetVal(Math.max(0, Math.min(finite(percent, 'percent'), 1)) * this.maximumState.peek());
  }

  IsDead(): boolean { return this.currentState.peek() <= 0; }
  IsHurt(): boolean { return this.currentState.peek() < this.maximumState.peek(); }

  /** Always include the maximum so this component can restore without prefab metadata. */
  OnSave(): HealthSaveData {
    return { health: this.currentState.peek(), maxhealth: this.maximumState.peek() };
  }

  OnLoad(data: HealthLoadData): void {
    // Validate the complete change before applying it to avoid a partial load.
    const maxhealth = data.maxhealth === undefined ? this.maximumState.peek() : maximum(data.maxhealth);
    const health = data.health !== undefined ? finite(data.health, 'health')
      : data.percent !== undefined ? Math.max(0, Math.min(finite(data.percent, 'percent'), 1)) * maxhealth
      : this.currentState.peek();
    batch(() => { this.maximumState.set(maxhealth); this.currentState.set(clamp(health, maxhealth)); });
  }

  dispose(): void { this.percent.dispose(); this.ondelta = undefined; }
}

export default Health;
