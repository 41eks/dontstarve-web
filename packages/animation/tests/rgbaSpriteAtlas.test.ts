import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Animation, BuildPackage, ResolvedSprite } from '../src/animationAssets';
import {
  composeRgbaSpriteAtlas,
  composeResolvedRgbaSpriteAtlases,
  createRgbaSpriteFrameGeometry,
} from '../src/rgbaSpriteAtlas';

class FakeCanvasContext {
  imageSmoothingEnabled = false;
  imageSmoothingQuality: ImageSmoothingQuality = 'low';
  readonly transforms: number[][] = [];
  readonly draws: unknown[][] = [];

  createImageData(width: number, height: number) {
    return { data: new Uint8ClampedArray(width * height * 4) } as ImageData;
  }

  putImageData() {}

  setTransform(...values: number[]) {
    this.transforms.push(values);
  }

  drawImage(...values: unknown[]) {
    this.draws.push(values);
  }

  resetTransform() {}
}

class FakeCanvas {
  width = 0;
  height = 0;
  readonly context = new FakeCanvasContext();

  getContext() {
    return this.context;
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('RGBA sprite atlas', () => {
  it('pages resolved frames on one source-anchored texel grid so changing bounds cannot shake stationary parts', () => {
    const canvases: FakeCanvas[] = [];
    vi.stubGlobal('document', { createElement: () => {
      const canvas = new FakeCanvas(); canvases.push(canvas); return canvas;
    } });
    const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const part: ResolvedSprite = {
      element: { imageHash: 1, imageIndex: 0, layerHash: 1, matrix: [1, 0, 0, 1, 3, 4], z: 0 },
      image: { index: 0, duration: 1, x: 0, y: 0, width: 20, height: 20, vertexIndex: 0, vertexCount: 6,
        bbx: 0, bby: 0, canvasWidth: 8, canvasHeight: 8 }, materials: [material],
    };
    const frames = [4, 5, 6].map(tx => [part, { ...part, element: { ...part.element,
      matrix: [1, 0, 0, 1, tx, 4] as [number, number, number, number, number, number] } }]);
    const animation: Animation = { name: 'idle', facing: 0, bankHash: 0, frameRate: 30,
      frames: frames.map(() => ({ elements: [part.element] })) };
    const pages = composeResolvedRgbaSpriteAtlases(animation, frames, 16);
    try {
      expect(pages).toHaveLength(3);
      expect(pages.map(page => [page.width, page.height, page.resolutionScale])).toEqual([[16, 14, .5], [16, 14, .5], [16, 14, .5]]);
      expect(pages.flatMap(page => page.frames.map(frame => frame.frameIndex))).toEqual([0, 1, 2]);
      for (const page of pages) {
        expect(page.frames[0]).toMatchObject({ minX: -8, minY: -6, width: 24, height: 20 });
        expect(page.frames[0].width * page.resolutionScale).toBeCloseTo((page.frames[0].u1 - page.frames[0].u0) * page.width);
      }
      expect(canvases.filter(canvas => canvas.context.transforms.length > 0)
        .map(canvas => canvas.context.transforms[0])).toEqual(Array(3).fill([.5, 0, 0, .5, 7.5, 7]));
      expect(() => composeResolvedRgbaSpriteAtlases(animation, frames, 8)).toThrow('maximum atlas size');
    } finally { pages.forEach(page => page.texture.dispose()); texture.dispose(); material.dispose(); }
  });

  it('composites a transformed frame and exposes matching quad geometry', () => {
    const canvases: FakeCanvas[] = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas = new FakeCanvas();
        canvases.push(canvas);
        return canvas;
      },
    });
    const buildPackage: BuildPackage = {
      build: {
        name: 'test',
        atlasNames: ['test.tex'],
        symbols: new Map([[1, [{
          index: 0,
          duration: 1,
          x: 1,
          y: 1,
          width: 2,
          height: 2,
          vertexIndex: 0,
          vertexCount: 6,
          sampler: 0,
          bbx: 1,
          bby: 1,
          canvasWidth: 8,
          canvasHeight: 8,
        }]]]),
      },
      atlases: [{ width: 4, height: 4, pixels: new Uint8Array(64) }],
    };
    const animation: Animation = {
      name: 'idle',
      facing: 0,
      bankHash: 0,
      frameRate: 30,
      frames: [{ elements: [{
        imageHash: 1,
        imageIndex: 0,
        layerHash: 2,
        matrix: [1, 0, 0, 1, 3, 4],
        z: 0,
      }] }],
    };

    const atlas = composeRgbaSpriteAtlas(buildPackage, animation, {
      frameIndices: [0],
      padding: 2,
    });

    expect([atlas.width, atlas.height]).toEqual([6, 6]);
    expect(atlas.frameRate).toBe(30);
    expect(atlas.resolutionScale).toBe(1);
    expect(atlas.frames[0]).toMatchObject({
      minX: 3,
      minY: 4,
      maxX: 5,
      maxY: 6,
      width: 2,
      height: 2,
      u0: 2 / 6,
      u1: 4 / 6,
    });
    expect(atlas.frames[0].v0).toBeCloseTo(2 / 6);
    expect(atlas.frames[0].v1).toBeCloseTo(4 / 6);
    expect(canvases[0].context.transforms).toEqual([[1, 0, 0, 1, 2, 2]]);
    expect(canvases[0].context.draws[0].slice(1)).toEqual([
      .5, .5, 1, 1, 0, 0, 2, 2,
    ]);

    const geometry = createRgbaSpriteFrameGeometry(atlas.frames[0]);
    expect(Array.from(geometry.getAttribute('position').array)).toEqual([
      3, 4, 0, 5, 4, 0, 5, 6, 0, 3, 6, 0,
    ]);
    expect(Array.from(geometry.index!.array)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(atlas.texture).toBeInstanceOf(THREE.CanvasTexture);

    const bottomAnchored = createRgbaSpriteFrameGeometry(
      atlas.frames[0],
      { anchor: 'bottom' },
    );
    expect(Array.from(bottomAnchored.getAttribute('position').array)).toEqual([
      3, -2, 0, 5, -2, 0, 5, 0, 0, 3, 0, 0,
    ]);
  });
});
