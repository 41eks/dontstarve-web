import { createSignal, readonlySignal } from '../../signals/src';

export interface HeaterInst { addTag(tag: string): void; removeTag(tag: string): void; }
type HeatFn = (inst: HeaterInst, observer: unknown) => number | undefined;
interface HeaterState {
  readonly heat?: number;
  readonly heatfn?: HeatFn;
  readonly exothermic: boolean;
  readonly endothermic: boolean;
  readonly shouldFalloff: boolean;
  readonly radiusCutoff?: number;
}

/** heater.lua's world heat-source branch. The observer's temperature owns heat consumption. */
export class Heater {
  private readonly state = createSignal<HeaterState>(Object.freeze({ exothermic: true, endothermic: false, shouldFalloff: true }));
  readonly configuration = readonlySignal(this.state);
  private readonly inst: HeaterInst;
  private disposed = false;
  constructor(inst: HeaterInst) { this.inst = inst; inst.addTag('HASHEATER'); }
  private configure(patch: Partial<HeaterState>): void { this.state.set(Object.freeze({ ...this.state.peek(), ...patch })); }
  SetHeat(heat?: number): void {
    if (heat !== undefined && !Number.isFinite(heat)) throw new RangeError('Invalid heater output');
    this.configure({ heat });
  }
  SetHeatFn(heatfn?: HeatFn): void { this.configure({ heatfn }); }
  SetThermics(exothermic: boolean, endothermic: boolean): void {
    this.configure({ exothermic, endothermic });
  }
  IsExothermic(): boolean { return this.state.peek().exothermic; }
  IsEndothermic(): boolean { return this.state.peek().endothermic; }
  SetShouldFalloff(shouldFalloff: boolean): void { this.configure({ shouldFalloff }); }
  ShouldFalloff(): boolean { return this.state.peek().shouldFalloff; }
  SetHeatRadiusCutoff(radiusCutoff?: number): void {
    if (radiusCutoff !== undefined && (!Number.isFinite(radiusCutoff) || radiusCutoff < 0)) throw new RangeError('Invalid heat radius');
    this.configure({ radiusCutoff });
  }
  GetHeatRadiusCutoff(): number | undefined { return this.state.peek().radiusCutoff; }
  GetHeat(observer?: unknown): number | undefined {
    const { heat, heatfn } = this.state.peek();
    // Lua's `or` preserves zero and falls back only when the function returns nil.
    return heatfn?.(this.inst, observer) ?? heat;
  }
  OnRemoveFromEntity(): void {
    if (this.disposed) return;
    this.disposed = true; this.inst.removeTag('HASHEATER');
  }
  dispose(): void { this.OnRemoveFromEntity(); }
}
