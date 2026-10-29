import timings from './animationTimings.json' with { type: 'json' };

/** Source anim.bin timing, imported at build time; gameplay never reads a downloaded sprite to schedule animover. */
export function animationLengths(archive: keyof typeof timings): ReadonlyMap<string, number> {
  return new Map(timings[archive].map(clip => [clip.name, clip.frames / clip.frameRate]));
}

export function animationTiming(archive: string, name: string, bank?: number) {
  const timing = timings[archive as keyof typeof timings]?.find(clip => clip.name === name && (bank === undefined || clip.bank === bank));
  if (!timing) throw new Error(`Missing animation timing ${archive}:${name}`);
  return timing;
}
