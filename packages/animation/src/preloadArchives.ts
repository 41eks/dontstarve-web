import { loadAnimationArchivePart } from './animationArchiveLoader';

/** A zip read for both parts, or split when the prefab pairs one bank archive with another build archive. */
export type AnimationArchiveSpec = string | { readonly animation: string; readonly build: string };

/**
 * Warm the shared archive caches so later factory creation reuses the decoded parts.
 * Failures are ignored here: the prefab that actually needs the archive still reports its own load error.
 */
export async function preloadAnimationArchives(
  specs: Iterable<AnimationArchiveSpec>, assetBaseUrl: string, signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const requests = new Map<string, () => Promise<unknown>>();
  const add = (file: string, kind: 'animation' | 'build') =>
    requests.set(`${kind}\n${file}`, () => loadAnimationArchivePart(file, assetBaseUrl, kind));
  for (const spec of specs) {
    if (typeof spec === 'string') { add(spec, 'animation'); add(spec, 'build'); }
    else { add(spec.animation, 'animation'); add(spec.build, 'build'); }
  }
  await Promise.allSettled([...requests.values()].map(start => start()));
  signal?.throwIfAborted();
}
