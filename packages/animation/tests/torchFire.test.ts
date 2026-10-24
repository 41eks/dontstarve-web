import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { TorchFireEffect } from '../../prefab/src/torchfire';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('emits fire before delayed smoke and removes its particles on disposal', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = `../../../public/dst/data/${url.slice('/fx-test/'.length)}`;
    return new Response(await readFile(new URL(path, import.meta.url)));
  }));
  const anchor = new THREE.Group();
  const fire = new TorchFireEffect(anchor, '/fx-test');
  await vi.waitFor(() => expect(anchor.children).toHaveLength(2));
  for (let i = 0; i < 12; i++) fire.update(1 / 30);
  const flame = anchor.getObjectByName('torchfire') as THREE.Mesh;
  expect(flame.geometry.drawRange.count).toBeGreaterThan(0);
  // Smoke starts after its source delay (-50 particles at 80 per second).
  expect((anchor.getObjectByName('torchfire_smoke') as THREE.Mesh).geometry.drawRange.count).toBe(0);

  fire.dispose();
  expect(anchor.children).toHaveLength(0);
});
