import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { PrefabDisplay, SpriteState } from '@dontstarve-web/display';
import { createSignal } from '@dontstarve-web/signals';
import { torchFireFx } from '../../prefab/src/torchfire';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('lets the holder display load the fire, emit fire before delayed smoke and remove the particles with the follower', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = `../../../public/dst/data/${url.slice('/fx-test/'.length)}`;
    return new Response(await readFile(new URL(path, import.meta.url)));
  }));
  const sprite = new SpriteState({ name: 'idle' });
  const display = new PrefabDisplay({ sprite, status: createSignal('active'), empty: true });
  const follower = sprite.followSymbol('swap_object', 0, -110, torchFireFx('/fx-test'));
  await display.artLoaded();
  expect(follower.node.children).toHaveLength(2);
  for (let i = 0; i < 12; i++) sprite.update(1 / 30);
  const flame = follower.node.getObjectByName('torchfire') as THREE.Mesh;
  expect(flame.geometry.drawRange.count).toBeGreaterThan(0);
  // Smoke starts after its source delay (-50 particles at 80 per second).
  expect((follower.node.getObjectByName('torchfire_smoke') as THREE.Mesh).geometry.drawRange.count).toBe(0);

  follower.remove();
  sprite.update(0);
  expect(follower.node.children).toHaveLength(0);
  display.dispose();
});
