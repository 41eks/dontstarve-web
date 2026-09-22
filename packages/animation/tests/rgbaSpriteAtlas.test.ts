import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Animation, BuildPackage } from '../src/animationAssets';
import {
  composeRgbaSpriteAtlas,
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
          canvasWidth: 4,
          canvasHeight: 4,
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
      1, 1, 2, 2, 0, 0, 2, 2,
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
