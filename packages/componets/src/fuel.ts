export interface FuelInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
  PushEvent(name: string, data: unknown): void;
}

/** components/fuel.lua: fuel type advertises USEITEM.fuel; the receiver owns consumption. */
export class Fuel {
  fuelvalue = 1;
  private type = 'BURNABLE';
  private ontaken?: (inst: FuelInst, target: unknown) => void;
  private readonly inst: FuelInst;
  constructor(inst: FuelInst) { this.inst = inst; inst.addTag(`${this.type}_fuel`); }
  get fueltype(): string { return this.type; }
  set fueltype(value: string) {
    this.inst.removeTag(`${this.type}_fuel`);
    this.type = value;
    this.inst.addTag(`${value}_fuel`);
  }
  SetOnTakenFn(fn: (inst: FuelInst, target: unknown) => void): void { this.ontaken = fn; }
  Taken(target: unknown): void {
    this.inst.PushEvent('fueltaken', { taker: target });
    this.ontaken?.(this.inst, target);
  }
  dispose(): void { this.inst.removeTag(`${this.type}_fuel`); this.ontaken = undefined; }
}

export interface FuelItem {
  readonly isRemoved: boolean;
  readonly components: { readonly fuel?: Fuel };
  GetIsWet(): boolean;
  remove(): boolean;
}
