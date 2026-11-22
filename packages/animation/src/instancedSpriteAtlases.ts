import type * as THREE from 'three';
import type { Animation, ResolvedSprite } from './animationAssets';
import {
  createResolvedRgbaSpriteAtlasComposer,
  type RgbaSpriteAtlas,
  type RgbaSpriteAtlasComposer,
  type RgbaSpriteAtlasFrame,
} from './rgbaSpriteAtlas';
import { spritePerf } from './spritePerf';

/** One shown animation and its composed atlas pages, shared by every instance showing the same key. */
export interface Appearance {
  readonly animation: Animation;
  readonly frames: ResolvedSprite[][];
  readonly resolve: (frameIndex: number) => ResolvedSprite[];
  composer?: RgbaSpriteAtlasComposer;
  pages?: RgbaSpriteAtlas[];
  locations?: { atlas: RgbaSpriteAtlas; frame: RgbaSpriteAtlasFrame }[];
  /** When no entity last showed or drew it (`releaseUnused`), while none does. */
  unusedSince?: number;
}

/** How long no entity may show or draw an appearance before its record or pages can go. */
export const RELEASE_UNUSED_AFTER_MS = 10_000;
/**
 * Composed pages of unused appearances kept for entities that show them again, longest unused released first above
 * this. An appearance shown again after its release draws nothing until it is composed anew, so pages are not dropped
 * the moment the last entity sleeps; but a world-wide state (snow) or a passing state seen during spawn must not keep
 * hundreds of megabytes of variants nobody draws (see docs/gpu-process-oom.md).
 */
export const UNUSED_PAGE_BUDGET_BYTES = 256 * 1024 * 1024;

/** The GPU bytes of an appearance's composed RGBA8 pages. */
export function appearancePageBytes(appearance: Appearance): number {
  let bytes = 0;
  for (const { width, height } of appearance.pages ?? []) {
    bytes += width * height * 4;
  }
  return bytes;
}

/** The atlas page and frame drawn for `frame` of a composed appearance, holding its last frame past the end. */
export function appearanceLocation(
  appearance: Appearance,
  frame: number,
): { atlas: RgbaSpriteAtlas; frame: RgbaSpriteAtlasFrame } {
  const locations = appearance.locations!;
  return locations[Math.min(frame, locations.length - 1)];
}

/**
 * The instanced pass's appearance cache. Atlases for appearances shown for the first time are composed in
 * first-use order within a per-frame budget, never inside the draw loop.
 */
export class InstancedSpriteAtlases {
  /** Appearances whose atlas is not composed yet, in first-use order. */
  private readonly composing = new Set<Appearance>();
  private readonly appearances = new Map<string, Appearance>();

  /** The shared appearance for `key`, queued for composition while it has no pages. */
  request(key: string, animation: Animation, resolve: () => (frameIndex: number) => ResolvedSprite[]): Appearance {
    let appearance = this.appearances.get(key);
    if (!appearance) {
      appearance = { animation, frames: [], resolve: resolve() };
      this.appearances.set(key, appearance);
    }
    this.enqueue(appearance);
    return appearance;
  }

  /** Whether any requested appearance still waits for its pages. */
  get pending(): boolean {
    return this.composing.size > 0;
  }

  /** Queues an appearance that lost or never had its pages. */
  enqueue(appearance: Appearance): void {
    if (!appearance.pages) {
      this.composing.add(appearance);
    }
  }

  /**
   * Advances pending compositions until `budgetMs` has passed; `Infinity` composes every pending appearance. With
   * `used`, an appearance no entity shows or draws any more (a state passed through within a frame) leaves the queue
   * uncomposed; showing it again queues it again.
   */
  step(renderer: THREE.WebGLRenderer, budgetMs: number, phase = 'compose', used?: ReadonlySet<Appearance>): void {
    if (this.composing.size === 0) {
      return;
    }
    const deadline = performance.now() + budgetMs;
    for (const appearance of this.composing) {
      if (used && !used.has(appearance)) {
        appearance.composer?.cancel();
        appearance.composer = undefined;
        this.composing.delete(appearance);
        continue;
      }
      const { animation, frames } = appearance;
      const pages = spritePerf(phase, `${animation.frames.length} frames`, () => {
        appearance.composer ??= createResolvedRgbaSpriteAtlasComposer(
          animation,
          index => (frames[index] ??= spritePerf('resolve', animation.name, () => appearance.resolve(index))),
          Math.min(4096, renderer.capabilities.maxTextureSize),
          renderer,
        );
        return appearance.composer.step(Math.max(0, deadline - performance.now()));
      });
      if (pages) {
        appearance.pages = pages;
        appearance.composer = undefined;
        appearance.locations = [];
        for (const atlas of pages) {
          for (const frame of atlas.frames) {
            appearance.locations[frame.frameIndex] = { atlas, frame };
          }
        }
        this.composing.delete(appearance);
      }
      if (performance.now() >= deadline) {
        break;
      }
    }
  }

  /**
   * Releases what no entity uses: `used` holds every appearance an entity shows or draws now. An unused appearance
   * without pages goes after RELEASE_UNUSED_AFTER_MS; composed ones also go after that long, longest unused first,
   * while the unused pages exceed UNUSED_PAGE_BUDGET_BYTES. Returns the released pages' atlases, already disposed.
   */
  releaseUnused(used: ReadonlySet<Appearance>, now: number): RgbaSpriteAtlas[] {
    const unused: [string, Appearance][] = [];
    let unusedBytes = 0;
    for (const [key, appearance] of this.appearances) {
      if (used.has(appearance)) {
        appearance.unusedSince = undefined;
        continue;
      }
      appearance.unusedSince ??= now;
      if (appearance.pages) {
        unused.push([key, appearance]);
        unusedBytes += appearancePageBytes(appearance);
      } else if (now - appearance.unusedSince >= RELEASE_UNUSED_AFTER_MS) {
        appearance.composer?.cancel();
        this.composing.delete(appearance);
        this.appearances.delete(key);
      }
    }
    const released: RgbaSpriteAtlas[] = [];
    unused.sort(([, a], [, b]) => a.unusedSince! - b.unusedSince!);
    for (const [key, appearance] of unused) {
      if (unusedBytes <= UNUSED_PAGE_BUDGET_BYTES || now - appearance.unusedSince! < RELEASE_UNUSED_AFTER_MS) {
        break;
      }
      unusedBytes -= appearancePageBytes(appearance);
      for (const atlas of appearance.pages!) {
        atlas.texture.dispose();
        released.push(atlas);
      }
      appearance.pages = appearance.locations = undefined;
      this.appearances.delete(key);
    }
    return released;
  }

  /**
   * Cancels pending compositions and releases every composed page, keeping the appearances themselves. Nothing is
   * queued afterwards: the caller re-queues the appearances still shown.
   */
  invalidate(): void {
    for (const appearance of this.appearances.values()) {
      appearance.composer?.cancel();
      appearance.composer = undefined;
      for (const atlas of appearance.pages ?? []) {
        atlas.texture.dispose();
      }
      appearance.pages = appearance.locations = undefined;
    }
    this.composing.clear();
  }

  dispose(): void {
    for (const appearance of this.appearances.values()) {
      appearance.composer?.cancel();
      for (const atlas of appearance.pages ?? []) {
        atlas.texture.dispose();
      }
    }
    this.appearances.clear();
    this.composing.clear();
  }
}
