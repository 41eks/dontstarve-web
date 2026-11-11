import timings from './animationTimings.json' with { type: 'json' };

/** Source anim.bin timing, imported at build time; gameplay never reads a downloaded sprite to schedule animover. */
export function animationLengths(archive: keyof typeof timings): ReadonlyMap<string, number> {
  return new Map(timings[archive].map(clip => [clip.name, clip.frames / clip.frameRate]));
}

/**
 * The timing of `bank`'s clip `name` in whichever of the entity's ANIM assets holds it, as AnimState:PlayAnimation finds
 * it; a clip found in two of them is ambiguous.
 */
export function bankAnimationTiming(archives: readonly string[], name: string, bank: number) {
  const found = archives.flatMap(archive => timings[archive as keyof typeof timings]?.filter(clip => clip.name === name && clip.bank === bank) ?? []);
  if (found.length === 0) throw new Error(`Missing animation timing ${name} in ${archives.join(', ')}`);
  if (found.length > 1) throw new Error(`Animation ${name} is in more than one of ${archives.join(', ')}`);
  return found[0];
}

export function animationTiming(archive: string, name: string, bank?: number) {
  const timing = timings[archive as keyof typeof timings]?.find(clip => clip.name === name && (bank === undefined || clip.bank === bank));
  if (!timing) throw new Error(`Missing animation timing ${archive}:${name}`);
  return timing;
}
