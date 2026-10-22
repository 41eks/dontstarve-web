import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import type { Animation, ResolvedSprite } from '../src/animationAssets';
import { createResolvedRgbaSpriteAtlasComposer } from '../src/rgbaSpriteAtlas';

/** Exercises ownership and buffer writes; pixel correctness is checked by real WebGL browser tests. */
function rendererStub() {
  let target: THREE.WebGLRenderTarget | null = null;
  let alpha = .7;
  const colour = new THREE.Color(0x123456);
  const draws: { geometry: THREE.BufferGeometry; position: THREE.BufferAttribute; index: THREE.BufferAttribute;
    count: number; groups: THREE.BufferGeometry['groups'] }[] = [];
  const renderer = {
    extensions: { has: () => true }, autoClear: true,
    info: { autoReset: true, render: { frame: 10, calls: 7, triangles: 5, lines: 0, points: 0 } },
    initTexture: vi.fn(),
    getRenderTarget: () => target, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    getClearAlpha: () => alpha, getClearColor: (out: THREE.Color) => out.copy(colour),
    setClearColor: (value: THREE.ColorRepresentation, opacity: number) => { colour.set(value); alpha = opacity; },
    setRenderTarget: (value: THREE.WebGLRenderTarget | null) => { target = value; },
    clear: vi.fn(),
    render: vi.fn((scene: THREE.Scene) => {
      renderer.info.render.frame++; renderer.info.render.calls++;
      const mesh = scene.children[0] as THREE.Mesh;
      if (!Array.isArray(mesh.material)) return;
      draws.push({ geometry: mesh.geometry, position: mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
        index: mesh.geometry.index!, count: mesh.geometry.drawRange.count, groups: mesh.geometry.groups.map(group => ({ ...group })) });
    }),
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, raw: renderer, draws };
}

function clip() {
  const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
  const other = texture.clone();
  const materials = [texture, other].map(map => new THREE.MeshBasicMaterial({ map }));
  const part: ResolvedSprite = {
    element: { imageHash: 1, imageIndex: 0, layerHash: 1, matrix: [1, 0, 0, 1, 0, 0], z: 0 },
    image: { index: 0, duration: 1, x: 0, y: 0, width: 4, height: 4, vertexIndex: 0, vertexCount: 6,
      bbx: 0, bby: 0, canvasWidth: 4, canvasHeight: 4 }, materials: [materials[0]],
  };
  const frames = [[part], [part, { ...part, materials: [materials[1]] }, part], [part, part]];
  const animation: Animation = { name: 'idle', facing: 0, bankHash: 0, frameRate: 30,
    frames: frames.map(sprites => ({ elements: sprites.map(sprite => sprite.element) })) };
  return { animation, frames, dispose() { materials.forEach(material => material.dispose()); texture.dispose(); other.dispose(); } };
}

afterEach(() => vi.restoreAllMocks());

it('resolves lazily and reuses task buffers and materials across pages while preserving layer runs and renderer state', () => {
  const source = clip(), { renderer, raw, draws } = rendererStub();
  const resolve = vi.fn((index: number) => source.frames[index]);
  const composer = createResolvedRgbaSpriteAtlasComposer(source.animation, resolve, 8, renderer);
  expect(resolve).not.toHaveBeenCalled();
  expect(composer.step(0)).toBeUndefined();
  expect(resolve.mock.calls).toEqual([[0]]);
  const original = { ...raw.info.render };
  const originalColour = renderer.getClearColor(new THREE.Color());
  const pages = composer.step(Infinity)!;
  try {
    expect(pages).toHaveLength(3);
    expect(raw.initTexture).toHaveBeenCalledTimes(2);
    expect(draws.map(draw => draw.count)).toEqual([6, 18, 12]);
    expect(new Set(draws.map(draw => draw.geometry)).size).toBe(1);
    expect(draws[1].position).toBe(draws[2].position);
    expect(draws[1].index).toBe(draws[2].index);
    // The stub leaves writes unconsumed: the shorter last frame must retain the preceding longer update range.
    expect(draws[2].position.updateRanges).toEqual([{ start: 0, count: 36 }]);
    expect(draws[1].groups.map(group => [group.start, group.count, group.materialIndex])).toEqual([[0, 6, 0], [6, 6, 1], [12, 6, 0]]);
    expect(draws[2].groups.map(group => [group.start, group.count, group.materialIndex])).toEqual([[0, 12, 0]]);
    expect(raw.info.render).toEqual({ ...original, frame: original.frame + 6 });
    expect(raw.info.autoReset).toBe(true); expect(raw.autoClear).toBe(true);
    expect(renderer.getClearColor(new THREE.Color())).toEqual(originalColour);
    expect(renderer.getClearAlpha()).toBe(.7); expect(renderer.getRenderTarget()).toBeNull();
    // Completing transfers ownership: cancelling must not dispose the caller's pages.
    const dispose = vi.fn(); pages[0].texture.addEventListener('dispose', dispose);
    composer.cancel(); expect(dispose).not.toHaveBeenCalled();
    expect(composer.step(0)).toBe(pages);
  } finally { pages.forEach(page => page.texture.dispose()); source.dispose(); }
});

it('cancels a partly composed multipage atlas, releasing completed private pages and current targets exactly once', () => {
  const source = clip(), { renderer, raw } = rendererStub();
  const dispose = vi.spyOn(THREE.WebGLRenderTarget.prototype, 'dispose');
  const composer = createResolvedRgbaSpriteAtlasComposer(source.animation, source.frames, 8, renderer);
  try {
    for (let step = 0; raw.clear.mock.calls.length < 2 && step < 30; step++) composer.step(0);
    expect(raw.clear).toHaveBeenCalledTimes(2);
    composer.cancel(); composer.cancel();
    expect(dispose).toHaveBeenCalledTimes(4);
    expect(new Set(dispose.mock.contexts).size).toBe(4);
    expect(() => composer.step(0)).toThrow('cancelled');
  } finally { composer.cancel(); source.dispose(); }
});

it('releases all targets and restores renderer state when a draw fails', () => {
  const source = clip(), { renderer, raw } = rendererStub();
  const dispose = vi.spyOn(THREE.WebGLRenderTarget.prototype, 'dispose');
  raw.render.mockImplementationOnce(() => { throw new Error('draw failed'); });
  const composer = createResolvedRgbaSpriteAtlasComposer(source.animation, source.frames, 8, renderer);
  try {
    expect(() => composer.step(Infinity)).toThrow('draw failed');
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(new Set(dispose.mock.contexts).size).toBe(2);
    expect(renderer.getRenderTarget()).toBeNull(); expect(raw.autoClear).toBe(true);
    expect(raw.info.autoReset).toBe(true); expect(renderer.getClearAlpha()).toBe(.7);
  } finally { composer.cancel(); source.dispose(); }
});
