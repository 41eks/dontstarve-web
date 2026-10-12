import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { createWilsonPlayer } from '../../prefab/src/player';
import { TorchFireEffect, TORCH_FIRE_OFFSET_Y } from '../../prefab/src/torchfire';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('follows the held torch\'s swap_object symbol and its particles leave with the fx', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.startsWith('/fx-test/') ? `../../../public/dst/data/${url.slice('/fx-test/'.length)}`
      : `../../../public/dst/data/anim/${url.replace('/torch-test/', '')}`;
    return new Response(await readFile(new URL(path, import.meta.url)));
  }));
  const player = await createWilsonPlayer('/torch-test');
  const controller = player.userData.animationController;
  await controller.setCarryItem('torch');
  const hand = controller.followSymbol('swap_object', 0, 0);
  const tip = controller.followSymbol('swap_object', 0, TORCH_FIRE_OFFSET_Y);
  expect(tip.node.visible).toBe(true);
  // The offset is up the torch (animation y grows down, the scene's grows up).
  expect(tip.node.position.y).toBeGreaterThan(hand.node.position.y);
  hand.remove();

  const fire = new TorchFireEffect(tip.node, '/fx-test');
  await vi.waitFor(() => expect(tip.node.children).toHaveLength(2));
  for (let i = 0; i < 12; i++) fire.update(1 / 30);
  const flame = tip.node.getObjectByName('torchfire') as THREE.Mesh;
  expect(flame.geometry.drawRange.count).toBeGreaterThan(0);
  // Smoke starts after its source delay (-50 particles at 80 per second).
  expect((tip.node.getObjectByName('torchfire_smoke') as THREE.Mesh).geometry.drawRange.count).toBe(0);

  fire.dispose();
  expect(tip.node.children).toHaveLength(0);
  tip.remove();
  expect(tip.node.parent).toBeNull();
});
