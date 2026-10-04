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

/** Basic health.lua state, independent of entities, damage modifiers and HUDs. */
export class Health {
  private maximumHealth: number;
  private currentHealth: number;

  constructor(maxhealth = 100) {
    this.maximumHealth = maximum(maxhealth);
    this.currentHealth = this.maximumHealth;
  }

  get maxhealth(): number { return this.maximumHealth; }
  get currenthealth(): number { return this.currentHealth; }

  /** As in Lua, configuring maximum health also fills the health bar. */
  SetMaxHealth(amount: number): void {
    this.maximumHealth = maximum(amount);
    this.currentHealth = this.maximumHealth;
  }

  SetVal(value: number): void {
    this.currentHealth = clamp(finite(value, 'health'), this.maximumHealth);
  }

  /** Positive amounts heal; negative amounts damage. Returns the requested delta, as in Lua. */
  DoDelta(amount: number): number {
    finite(amount, 'amount');
    this.currentHealth = clamp(this.currentHealth + amount, this.maximumHealth);
    return amount;
  }

  GetPercent(): number { return this.currentHealth / this.maximumHealth; }

  SetPercent(percent: number): void {
    this.currentHealth = Math.max(0, Math.min(finite(percent, 'percent'), 1)) * this.maximumHealth;
  }

  IsDead(): boolean { return this.currentHealth <= 0; }
  IsHurt(): boolean { return this.currentHealth < this.maximumHealth; }

  /** Always include the maximum so this component can restore without prefab metadata. */
  OnSave(): HealthSaveData {
    return { health: this.currentHealth, maxhealth: this.maximumHealth };
  }

  OnLoad(data: HealthLoadData): void {
    // Validate the complete change before applying it to avoid a partial load.
    const maxhealth = data.maxhealth === undefined ? this.maximumHealth : maximum(data.maxhealth);
    const health = data.health !== undefined ? finite(data.health, 'health')
      : data.percent !== undefined ? Math.max(0, Math.min(finite(data.percent, 'percent'), 1)) * maxhealth
      : this.currentHealth;
    this.maximumHealth = maxhealth;
    this.currentHealth = clamp(health, maxhealth);
  }
}

export default Health;
