interface FertilizerInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
  readonly components: {
    readonly finiteuses?: { use(amount?: number): boolean };
    readonly stackable?: { Consume(): boolean };
  };
  remove(): boolean;
}

/** fertilizer.lua. */
export class Fertilizer {
  readonly fertilize_sound = 'dontstarve/common/fertilize' as const;
  private readonly inst: FertilizerInst;
  readonly withered_cycles: number;
  constructor(inst: FertilizerInst, withered_cycles = 1) { this.inst = inst; this.withered_cycles = withered_cycles; inst.addTag('fertilizer'); }
  /**
   * fertilizer.lua OnApplied(doer, target): a finiteuses fertilizer spends a use, and its final use removes the inst
   * (finiteuses.use does so on reaching zero); otherwise one of the stack is removed. onappliedfn is not ported.
   */
  OnApplied(_doer?: unknown, _target?: unknown): void {
    if (this.inst.components.finiteuses?.use(1)) return;
    if (this.inst.components.stackable) this.inst.components.stackable.Consume();
    else this.inst.remove();
  }
  dispose(): void { this.inst.removeTag('fertilizer'); }
}
