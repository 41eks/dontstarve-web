/** tuning.lua SANITYAURA_SMALL: 100 / (seg_time * 8). */
export const SANITYAURA_SMALL = 100 / (30 * 8);
/** tuning.lua SANITYAURA_SUPERHUGE: 100 / (seg_time * .25). */
export const SANITYAURA_SUPERHUGE = 100 / (30 * 0.25);
/** tuning.lua SANITY_EFFECT_RANGE = 10, squared. */
const SANITY_EFFECT_RANGE_SQ = 10 * 10;

/** An entity GetAura measures the observer's distance from. */
interface SanityAuraObserver {
  GetDistanceSqToInst(inst: unknown): number;
}

/** components/sanityaura.lua. */
export class SanityAura {
  aura = 0;
  /** sanityaura.max_distsq: nil leaves GetAura on TUNING.SANITY_EFFECT_RANGE. */
  max_distsq?: number;
  /** sanityaura.aurafn(inst, observer): the aura's magnitude when it varies with state, in place of `aura`. */
  aurafn?: (inst: unknown, observer: unknown) => number;
  /** sanityaura.fallofffn(inst, observer, distsq): the divisor GetAura fades the aura by with distance. */
  fallofffn?: (inst: unknown, observer: unknown, distsq: number) => number;
  private readonly inst: { addTag(tag: string): void; removeTag(tag: string): void };
  constructor(inst: SanityAura['inst']) {
    this.inst = inst;
    inst.addTag('sanityaura');
  }
  OnRemoveFromEntity(): void {
    this.inst.removeTag('sanityaura');
  }
  /** SanityAura:GetBaseAura -- no falloff. */
  GetBaseAura(observer?: unknown): number {
    return this.aurafn ? this.aurafn(this.inst, observer) : this.aura;
  }
  /** SanityAura:GetAura: the aura within max_distsq, faded by fallofffn or the squared distance. */
  GetAura(observer: SanityAuraObserver): number {
    const distsq = observer.GetDistanceSqToInst(this.inst);
    if (distsq > (this.max_distsq ?? SANITY_EFFECT_RANGE_SQ)) {
      return 0;
    }
    const base = this.aurafn ? this.aurafn(this.inst, observer) : this.aura;
    return base / (this.fallofffn ? this.fallofffn(this.inst, observer, distsq) : Math.max(1, distsq));
  }
}
