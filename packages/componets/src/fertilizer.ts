/** fertilizer.lua's stackable branch. The inventory action supplies one-item consumption. */
export class Fertilizer {
  readonly fertilize_sound = 'dontstarve/common/fertilize' as const;
  private readonly inst: { addTag(tag: string): void; removeTag(tag: string): void };
  readonly withered_cycles: number;
  constructor(inst: { addTag(tag: string): void; removeTag(tag: string): void },
    withered_cycles = 1) { this.inst = inst; this.withered_cycles = withered_cycles; inst.addTag('fertilizer'); }
  OnApplied(consume: () => boolean): boolean { return consume(); }
  dispose(): void { this.inst.removeTag('fertilizer'); }
}
