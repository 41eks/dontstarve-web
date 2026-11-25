import type * as THREE from 'three';
import type { Animation, ResolvedSprite } from './animationAssets';
import { createInstancedPartTable, type InstancedPartFrame, type InstancedPartTable } from './instancedPartTable';
import type { BatchPage } from './instancedSpriteBatches';
import {
  createResolvedRgbaSpriteAtlasComposer,
  type RgbaSpriteAtlas,
  type RgbaSpriteAtlasComposer,
  type RgbaSpriteAtlasFrame,
} from './rgbaSpriteAtlas';
import { spritePerf } from './spritePerf';

/** Where an appearance's frame is drawn from: a composed page's cell or a part table's row. */
export interface AppearanceLocation {
  readonly page: BatchPage;
  readonly frame: RgbaSpriteAtlasFrame | InstancedPartFrame;
}

/**
 * One shown animation and what draws it, shared by every instance showing the same key: composed atlas pages, or a
 * part table when composing would take PART_TABLE_COMPOSED_BYTES or more.
 */
export interface Appearance {
  readonly animation: Animation;
  readonly frames: ResolvedSprite[][];
  readonly resolve: (frameIndex: number) => ResolvedSprite[];
  composer?: RgbaSpriteAtlasComposer;
  pages?: RgbaSpriteAtlas[];
  parts?: InstancedPartTable;
  /** Set once the appearance is drawn from `pages` or `parts`. */
  locations?: AppearanceLocation[];
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

/**
 * Composed pages this large or larger are replaced by a part table drawn straight from the build atlases. Composing
 * costs frames × the clip-wide cell, so a long loop of a large tree (evergreen and moon_tree sway loops, 50–200 MB)
 * would hold far more memory than its parts (tens of KB) for the few entities showing it; small appearances stay
 * composed, one instance per entity.
 */
export const PART_TABLE_COMPOSED_BYTES = 16 * 1024 * 1024;

/** The GPU bytes of an appearance's composed RGBA8 pages or part table. */
export function appearancePageBytes(appearance: Appearance): number {
  let bytes = appearance.parts?.bytes ?? 0;
  for (const { width, height } of appearance.pages ?? []) {
    bytes += width * height * 4;
  }
  return bytes;
}

/** The page and frame drawn for `frame` of a drawable appearance, holding its last frame past the end. */
export function appearanceLocation(appearance: Appearance, frame: number): AppearanceLocation {
  const locations = appearance.locations!;
  return locations[Math.min(frame, locations.length - 1)];
}

/** Releases an appearance's GPU resources, its pages' textures or its part table, adding them to `released`. */
function releaseDrawn(appearance: Appearance, released?: BatchPage[]): void {
  for (const atlas of appearance.pages ?? []) {
    atlas.texture.dispose();
    released?.push(atlas);
  }
  if (appearance.parts) {
    appearance.parts.texture.dispose();
    released?.push(appearance.parts);
  }
  appearance.pages = appearance.parts = appearance.locations = undefined;
}

/**
 * The instanced pass's appearance cache. Appearances shown for the first time get a part table or composed atlases in
 * first-use order within a per-frame budget, never inside the draw loop.
 */
export class InstancedSpriteAtlases {
  /** Appearances whose atlas is not composed yet, in first-use order. */
  private readonly composing = new Set<Appearance>();
  private readonly appearances = new Map<string, Appearance>();

  /** The shared appearance for `key`, queued while it has nothing to draw from. */
  request(key: string, animation: Animation, resolve: () => (frameIndex: number) => ResolvedSprite[]): Appearance {
    let appearance = this.appearances.get(key);
    if (!appearance) {
      appearance = { animation, frames: [], resolve: resolve() };
      this.appearances.set(key, appearance);
    }
    this.enqueue(appearance);
    return appearance;
  }

  /** Whether any requested appearance still waits for its pages or part table. */
  get pending(): boolean {
    return this.composing.size > 0;
  }

  /** Queues an appearance that lost or never had its pages or part table. */
  enqueue(appearance: Appearance): void {
    if (!appearance.locations) {
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
      const resolve = (index: number) =>
        (frames[index] ??= spritePerf('resolve', animation.name, () => appearance.resolve(index)));
      if (!appearance.composer) {
        // Composing resolves every frame anyway; the parts decide whether it is worth its pages.
        const parts = spritePerf('parts', animation.name, () => createInstancedPartTable(animation, resolve));
        if (parts && parts.composedBytes >= PART_TABLE_COMPOSED_BYTES) {
          appearance.parts = parts;
          appearance.locations = parts.frames.map(frame => ({ page: parts, frame }));
          this.composing.delete(appearance);
          if (performance.now() >= deadline) {
            break;
          }
          continue;
        }
        // Never uploaded: dropping it releases nothing on the GPU.
        parts?.texture.dispose();
      }
      const pages = spritePerf(phase, `${animation.frames.length} frames`, () => {
        appearance.composer ??= createResolvedRgbaSpriteAtlasComposer(
          animation,
          resolve,
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
            appearance.locations[frame.frameIndex] = { page: atlas, frame };
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
   * with nothing to draw from goes after RELEASE_UNUSED_AFTER_MS; drawable ones also go after that long, longest
   * unused first, while their unused pages and tables exceed UNUSED_PAGE_BUDGET_BYTES. Returns the released pages and
   * tables, already disposed.
   */
  releaseUnused(used: ReadonlySet<Appearance>, now: number): BatchPage[] {
    const unused: [string, Appearance][] = [];
    let unusedBytes = 0;
    for (const [key, appearance] of this.appearances) {
      if (used.has(appearance)) {
        appearance.unusedSince = undefined;
        continue;
      }
      appearance.unusedSince ??= now;
      if (appearance.locations) {
        unused.push([key, appearance]);
        unusedBytes += appearancePageBytes(appearance);
      } else if (now - appearance.unusedSince >= RELEASE_UNUSED_AFTER_MS) {
        appearance.composer?.cancel();
        this.composing.delete(appearance);
        this.appearances.delete(key);
      }
    }
    const released: BatchPage[] = [];
    unused.sort(([, a], [, b]) => a.unusedSince! - b.unusedSince!);
    for (const [key, appearance] of unused) {
      if (unusedBytes <= UNUSED_PAGE_BUDGET_BYTES || now - appearance.unusedSince! < RELEASE_UNUSED_AFTER_MS) {
        break;
      }
      unusedBytes -= appearancePageBytes(appearance);
      releaseDrawn(appearance, released);
      this.appearances.delete(key);
    }
    return released;
  }

  /**
   * Cancels pending compositions and releases every composed page and part table, keeping the appearances
   * themselves. Nothing is queued afterwards: the caller re-queues the appearances still shown.
   */
  invalidate(): void {
    for (const appearance of this.appearances.values()) {
      appearance.composer?.cancel();
      appearance.composer = undefined;
      releaseDrawn(appearance);
    }
    this.composing.clear();
  }

  dispose(): void {
    for (const appearance of this.appearances.values()) {
      appearance.composer?.cancel();
      releaseDrawn(appearance);
    }
    this.appearances.clear();
    this.composing.clear();
  }
}
