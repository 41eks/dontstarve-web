import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { clockstate, createSignal, seasonstate, moonphasestate } from '@dontstarve-web/signals';
import { DstLightingRenderer } from '../../display/src/worldLighting';
import { Sanity } from '../../componets/src/sanity';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('derives lighting with an effect, preserves transitions across progress updates and cancels pending work on disposal', async () => {
  let finishLoad!: () => void;
  const pending = new Promise<void>(resolve => {
    finishLoad = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      await pending;
      const file = await readFile(
        new URL(`../../../public/dst/data/images/colour_cubes/${url.split('/').at(-1)}`, import.meta.url),
      );
      return new Response(file);
    }),
  );
  clockstate.set({ phase: 'night', timeinphase: 0 });
  seasonstate.set({ season: 'spring', progress: 0.5 });
  moonphasestate.set('new');
  const renderer = {
    capabilities: { maxSamples: 4 },
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    render: () => {},
  } as unknown as THREE.WebGLRenderer;
  const loading = DstLightingRenderer.create(renderer, '/dst/data/images/colour_cubes');
  clockstate.set({ phase: 'dusk', timeinphase: 0.5 });
  seasonstate.set({ season: 'winter', progress: 0.5 });
  finishLoad();
  const lighting = await loading;
  try {
    expect(lighting.getPhase()).toBe('dusk');
    expect(lighting.getSeason()).toBe('winter');
    const cube = lighting.colourCube;
    const initialLut = cube.layers.value.destination;
    clockstate.set({ phase: 'night', timeinphase: 0 });
    seasonstate.set({ season: 'summer', progress: 0.5 });
    await Promise.resolve();
    expect(lighting.getPhase()).toBe('night');
    expect(lighting.getSeason()).toBe('summer');
    expect(cube.layers.value.destination).not.toBe(initialLut);
    lighting.update(5);
    expect(cube.blend.value).toBe(0.5);
    expect(lighting.sampleLightLevel(new THREE.Vector3())).toBeGreaterThan(0);
    clockstate.set({ phase: 'night', timeinphase: 0.5 });
    seasonstate.set({ season: 'summer', progress: 0.75 });
    await Promise.resolve();
    lighting.update(5);
    expect(cube.blend.value).toBe(1);
    expect(lighting.sampleLightLevel(new THREE.Vector3())).toBe(0);
    moonphasestate.set('full');
    await Promise.resolve();
    expect(lighting.getPhase()).toBe('full_moon');
    expect(clockstate.value.phase).toBe('night');
    lighting.update(8);
    expect(lighting.sampleLightLevel(new THREE.Vector3())).toBeGreaterThan(0);
    const appliedLut = cube.layers.value.destination;
    clockstate.set({ phase: 'day', timeinphase: 0 });
    seasonstate.set({ season: 'autumn', progress: 0.5 });
    moonphasestate.set('new');
    lighting.dispose();
    lighting.dispose();
    await Promise.resolve();
    expect(cube.layers.value.destination).toBe(appliedLut);
    expect(cube.blend.value).toBe(1);
    expect(lighting.getPhase()).toBe('day');
    expect(lighting.getSeason()).toBe('autumn');
  } finally {
    lighting.dispose();
  }
});

it('re-blends the colour cube only when a blend input changes, and scales ambient by the bound weather light', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const file = await readFile(
        new URL(`../../../public/dst/data/images/colour_cubes/${url.split('/').at(-1)}`, import.meta.url),
      );
      return new Response(file);
    }),
  );
  clockstate.set({ phase: 'day', timeinphase: 0 });
  seasonstate.set({ season: 'autumn', progress: 0.5 });
  moonphasestate.set('new');
  const sanity = new Sanity({ components: {}, hasTag: () => false }, 200);
  sanity.SetCurrent(100);
  const renderer = {
    capabilities: { maxSamples: 4 },
    getRenderTarget: () => null,
    setRenderTarget: vi.fn(),
    render: vi.fn(),
  };
  const lighting = await DstLightingRenderer.create(renderer as never, '/dst/data/images/colour_cubes', {
    sanityPercent: sanity.percent,
    lunacyMode: sanity.lunacyMode,
  });
  // Every renderer.render here is a combine_colour_cubes bake, which follows the cube's signals.
  const bakes = () => renderer.render.mock.calls.length;
  try {
    expect(bakes()).toBe(1);
    // 50% -> 52%: still the 50% grading step, so the cube is not re-blended.
    sanity.SetCurrent(104);
    expect(bakes()).toBe(1);
    sanity.SetCurrent(80);
    expect(bakes()).toBe(2);
    // Clock settlements inside a phase change nothing.
    clockstate.set({ phase: 'day', timeinphase: 0.5 });
    await Promise.resolve();
    expect(bakes()).toBe(2);

    // A phase change starts a cube transition (new cubes and blend 0 together: one bake); paused frames (dt = 0) do
    // not re-blend, progress does.
    clockstate.set({ phase: 'dusk', timeinphase: 0 });
    await Promise.resolve();
    expect(bakes()).toBe(3);
    lighting.update(0);
    expect(bakes()).toBe(3);
    lighting.update(1);
    expect(bakes()).toBe(4);

    // weathertick's light scales the ambient colour while bound; unbinding returns to full light.
    lighting.update(10);
    const origin = new THREE.Vector3();
    const clear = lighting.sampleLightLevel(origin);
    const light = createSignal(0.5);
    const unbind = lighting.bindWeatherLight(light);
    expect(lighting.sampleLightLevel(origin)).toBeCloseTo(clear * 0.5);
    light.set(0.75);
    await Promise.resolve();
    expect(lighting.sampleLightLevel(origin)).toBeCloseTo(clear * 0.75);
    unbind();
    expect(lighting.sampleLightLevel(origin)).toBeCloseTo(clear);
  } finally {
    lighting.dispose();
    sanity.dispose();
  }
});

it('drops the insanity grading and distortion in lunacy mode, as colourcube.lua SetOnlyLunacyIntensityParams', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const file = await readFile(
        new URL(`../../../public/dst/data/images/colour_cubes/${url.split('/').at(-1)}`, import.meta.url),
      );
      return new Response(file);
    }),
  );
  const sanity = new Sanity({ components: {}, hasTag: () => false }, 200);
  sanity.SetCurrent(40);
  const renderer = {
    capabilities: { maxSamples: 4 },
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    render: () => {},
  } as unknown as THREE.WebGLRenderer;
  const lighting = await DstLightingRenderer.create(renderer, '/dst/data/images/colour_cubes', {
    sanityPercent: sanity.percent,
    lunacyMode: sanity.lunacyMode,
  });
  const effects = () => [lighting.colourCube.insanityIntensity.value, lighting.colourCube.distortionIntensity.value];
  try {
    expect(effects().every(value => value > 0)).toBe(true);
    // Low enlightenment and full enlightenment both show no insanity filter.
    sanity.EnableLunacy(true, 'island');
    expect(effects()).toEqual([0, 0]);
    sanity.SetCurrent(200);
    expect(effects()).toEqual([0, 0]);
    sanity.SetCurrent(40);
    sanity.EnableLunacy(false, 'island');
    expect(effects().every(value => value > 0)).toBe(true);
  } finally {
    lighting.dispose();
    sanity.dispose();
  }
});
