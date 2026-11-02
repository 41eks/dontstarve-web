/** tuning.lua SANITYAURA_SMALL: 100 / (seg_time * 8). */
export const SANITYAURA_SMALL = 100 / (30 * 8);

/** components/sanityaura.lua's fixed-aura branch. */
export class SanityAura {
  aura = 0;
  private readonly inst: { addTag(tag: string): void; removeTag(tag: string): void };
  constructor(inst: SanityAura['inst']) { this.inst = inst; inst.addTag('sanityaura'); }
  OnRemoveFromEntity(): void { this.inst.removeTag('sanityaura'); }
  GetBaseAura(): number { return this.aura; }
}
