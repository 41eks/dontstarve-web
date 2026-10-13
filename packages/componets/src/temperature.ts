import type { Vector3 } from 'three';
import { createSignal, readonlySignal, watchSignal, type ReadonlySignal } from '../../signals/src';
import type { Heater } from './heater';

export interface TemperatureOwner {
  hasTag?(tag: string): boolean;
  getPosition?(): Vector3;
}
export interface TemperatureInst {
  readonly isRemoved: boolean;
  readonly components: { inventoryitem: { owner: TemperatureOwner | null } };
  getPosition(): Vector3;
  GetIsWet(): boolean;
  PushEvent(name: string, data: unknown): void;
}
export interface TemperatureSource {
  getPosition(): Vector3;
  readonly components: { heater?: Heater };
  hasTag(tag: string): boolean;
}
export interface TemperatureWorld {
  readonly temperature: ReadonlySignal<number>;
  readonly clock?: ReadonlySignal<{ readonly phase: string }>;
  /** Scene units per DST unit; radius and falloff calculations use the same scale. */
  readonly unitScale?: number;
  getLocalTemperature?(position: Vector3): number;
  findHeaters?(position: Vector3, radius: number, ignoredTags: readonly string[]): readonly TemperatureSource[];
}
export interface TemperatureSaveData { readonly current: number; }

/** temperature.lua's non-player item branch, including refrigeration and world heaters. */
export class Temperature {
  private readonly currentState = createSignal(35);
  readonly current = readonlySignal(this.currentState);
  mintemp = -20;
  maxtemp = 90;
  overheattemp = 70;
  inherentinsulation = 0;
  inherentsummerinsulation = 0;
  private rate = 0;
  private settemp?: number;
  private ignoreheatertags: readonly string[] = ['INLIMBO'];
  private world?: TemperatureWorld;
  private ambient?: ReadonlySignal<number>;
  private clock?: ReadonlySignal<{ readonly phase: string }>;
  private readonly cleanups: (() => void)[] = [];
  private initialized = false;
  private disposed = false;
  private readonly inst: TemperatureInst;
  constructor(inst: TemperatureInst, world?: TemperatureWorld, saved?: TemperatureSaveData) {
    this.inst = inst;
    if (saved) { this.currentState.set(saved.current); this.initialized = true; }
    if (world) this.BindWorld(world);
  }
  BindWorld(world: TemperatureWorld): void {
    if (this.disposed || this.world === world) return;
    this.cleanups.splice(0).forEach(stop => stop());
    this.world = world;
    this.ambient = watchSignal(world.temperature, stop => this.cleanups.push(stop));
    this.clock = world.clock && watchSignal(world.clock, stop => this.cleanups.push(stop));
    if (!this.initialized) {
      // heatrock.lua initializes from TheWorld.state.temperature, before its first update.
      this.currentState.set(this.ambient.peek());
      this.initialized = true;
    }
    this.OnUpdate(0);
  }
  GetCurrent(): number { return this.currentState.peek(); }
  GetMax(): number { return this.maxtemp; }
  GetAmbientTemperature(): number {
    const owner = this.inst.components.inventoryitem.owner;
    return owner?.hasTag?.('pocketdimension_container') ? this.ambient?.peek() ?? 35
      : this.world?.getLocalTemperature?.(this.getPosition()) ?? this.ambient?.peek() ?? 35;
  }
  private getPosition(): Vector3 {
    return this.inst.components.inventoryitem.owner?.getPosition?.() ?? this.inst.getPosition();
  }
  IgnoreTags(...tags: string[]): void { this.ignoreheatertags = ['INLIMBO', ...tags]; }
  SetTemp(value?: number): void {
    this.settemp = value;
    if (value !== undefined) this.SetTemperature(value);
  }
  SetTemperature(value: number): void {
    if (this.disposed || this.inst.isRemoved) return;
    if (!Number.isFinite(value)) throw new RangeError('Invalid entity temperature');
    const last = this.GetCurrent(), current = Math.max(this.mintemp, Math.min(this.maxtemp, value));
    this.currentState.set(current);
    if ((current < 0) !== (last < 0)) this.inst.PushEvent(current < 0 ? 'startfreezing' : 'stopfreezing', undefined);
    if ((current > this.overheattemp) !== (last > this.overheattemp)) {
      this.inst.PushEvent(current > this.overheattemp ? 'startoverheating' : 'stopoverheating', undefined);
    }
    this.inst.PushEvent('temperaturedelta', { last, new: current, hasrate: this.rate !== 0 });
  }
  GetInsulation(): readonly [number, number] {
    const phase = this.clock?.peek().phase;
    return [Math.max(0, this.inherentinsulation), Math.max(0, this.inherentsummerinsulation
      + (phase === 'dusk' ? 60 : phase === 'night' ? 120 : 0))];
  }
  DoDelta(delta: number, skipinsulation = false): void {
    const [winter, summer] = this.GetInsulation();
    this.SetTemperature(this.GetCurrent() + delta * (skipinsulation ? 1 : 30 / (30 + (delta > 0 ? summer : winter))));
  }
  OnUpdate(dt: number): void {
    if (this.disposed || this.inst.isRemoved) return;
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid temperature dt');
    this.rate = 0;
    if (this.settemp !== undefined) return;
    const current = this.GetCurrent(), ambient = this.GetAmbientTemperature();
    const owner = this.inst.components.inventoryitem.owner;
    let minimum = this.mintemp;
    if (owner?.hasTag?.('fridge') && !owner.hasTag('nocool')) {
      minimum = Math.max(minimum, Math.min(0, ambient));
      this.rate = owner.hasTag('lowcool') ? -.5 : -1;
    } else {
      let delta = ambient - current;
      if (!owner?.hasTag?.('pocketdimension_container')) {
        const position = this.getPosition(), scale = this.world?.unitScale ?? 1, radius = 10 * scale;
        for (const source of this.world?.findHeaters?.(position, radius, this.ignoreheatertags) ?? []) {
          if ((source as unknown) === this.inst || this.ignoreheatertags.some(tag => source.hasTag(tag))) continue;
          const heater = source.components.heater, heat = heater?.GetHeat(this.inst);
          if (heat === undefined || !heater || (!heater.IsExothermic() && !heater.IsEndothermic())) continue;
          const distanceSquared = position.distanceToSquared(source.getPosition());
          let factor = heater.ShouldFalloff() ? 1 - distanceSquared / (radius * radius) : 1;
          const cutoff = heater.GetHeatRadiusCutoff();
          if (cutoff !== undefined && distanceSquared > (cutoff * scale) ** 2) factor = 0;
          if (factor <= 0) continue;
          if (this.inst.GetIsWet()) factor *= heat > 0 ? .75 : heat < 0 ? 1 / .75 : 1;
          const target = heater.IsExothermic() ? heat * factor : (heat - this.overheattemp) * factor + this.overheattemp;
          if (heater.IsExothermic() ? target > current : target < current) delta += target - current;
        }
      }
      const [winter, summer] = this.GetInsulation();
      this.rate = ambient >= 35
        ? delta > 0 ? Math.min(delta, 30 / (30 + summer)) : Math.max(delta, current >= this.overheattemp ? -5 : -1)
        : delta < 0 ? Math.max(delta, -30 / (30 + winter)) : Math.min(delta, current <= 0 ? 5 : 1);
    }
    this.SetTemperature(Math.max(minimum, Math.min(this.maxtemp, current + this.rate * dt)));
  }
  OnSave(): TemperatureSaveData { return { current: this.GetCurrent() }; }
  OnLoad(data: TemperatureSaveData): void {
    this.initialized = true;
    this.currentState.set(data.current);
    this.OnUpdate(0);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cleanups.splice(0).forEach(stop => stop());
    this.world = undefined;
  }
}
