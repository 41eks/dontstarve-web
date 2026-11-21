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

  /** Queues an appearance that lost or never had its pages. */
  enqueue(appearance: Appearance): void {
    if (!appearance.pages) {
      this.composing.add(appearance);
    }
  }

  /** Advances pending compositions until `budgetMs` has passed; `Infinity` composes every pending appearance. */
  step(renderer: THREE.WebGLRenderer, budgetMs: number, phase = 'compose'): void {
    if (this.composing.size === 0) {
      return;
    }
    const deadline = performance.now() + budgetMs;
    for (const appearance of this.composing) {
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
