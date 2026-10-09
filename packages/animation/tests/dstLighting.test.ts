import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { clockstate, seasonstate, moonphasestate } from '@dontstarve-web/signals';
import { DstLightingRenderer } from '../../../src/dstLighting';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('derives lighting with an effect, preserves transitions across progress updates and cancels pending work on disposal', async () => {
  let finishLoad!: () => void;
  const pending = new Promise<void>((resolve) => { finishLoad = resolve; });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    await pending;
    const file = await readFile(new URL(`../../../public/dst/data/images/colour_cubes/${url.split('/').at(-1)}`, import.meta.url));
    return new Response(file);
  }));
  clockstate.set({ phase: 'night', timeinphase: 0 });
  seasonstate.set({ season: 'spring', progress: 0.5 });
  moonphasestate.set('new');
  const renderer = { capabilities: { maxSamples: 4 } } as THREE.WebGLRenderer;
  const loading = DstLightingRenderer.create(renderer, '/dst/data/images/colour_cubes');
  clockstate.set({ phase: 'dusk', timeinphase: 0.5 });
  seasonstate.set({ season: 'winter', progress: 0.5 });
  finishLoad();
  const lighting = await loading;
  try {
    expect(lighting.getPhase()).toBe('dusk');
    expect(lighting.getSeason()).toBe('winter');
    const material = (lighting as unknown as { material: THREE.ShaderMaterial }).material;
    const initialLut = material.uniforms.destinationLut.value;
    clockstate.set({ phase: 'night', timeinphase: 0 });
    seasonstate.set({ season: 'summer', progress: 0.5 });
    await Promise.resolve();
    expect(lighting.getPhase()).toBe('night');
    expect(lighting.getSeason()).toBe('summer');
    expect(material.uniforms.destinationLut.value).not.toBe(initialLut);
    lighting.update(5);
    expect(material.uniforms.lutBlend.value).toBe(0.5);
    expect(lighting.sampleLightLevel(new THREE.Vector3())).toBeGreaterThan(0);
    clockstate.set({ phase: 'night', timeinphase: 0.5 });
    seasonstate.set({ season: 'summer', progress: 0.75 });
    await Promise.resolve();
    lighting.update(5);
    expect(material.uniforms.lutBlend.value).toBe(1);
    expect(lighting.sampleLightLevel(new THREE.Vector3())).toBe(0);
    moonphasestate.set('full');
    await Promise.resolve();
    expect(lighting.getPhase()).toBe('full_moon');
    expect(clockstate.peek().phase).toBe('night');
    lighting.update(8);
    expect(lighting.sampleLightLevel(new THREE.Vector3())).toBeGreaterThan(0);
    const appliedLut = material.uniforms.destinationLut.value;
    clockstate.set({ phase: 'day', timeinphase: 0 });
    seasonstate.set({ season: 'autumn', progress: 0.5 });
    moonphasestate.set('new');
    lighting.dispose(); lighting.dispose();
    await Promise.resolve();
    expect(material.uniforms.destinationLut.value).toBe(appliedLut);
    expect(material.uniforms.lutBlend.value).toBe(1);
    expect(lighting.getPhase()).toBe('day');
    expect(lighting.getSeason()).toBe('autumn');
  } finally { lighting.dispose(); }
});
