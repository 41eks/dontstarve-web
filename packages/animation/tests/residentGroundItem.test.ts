import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { createSignal } from '@dontstarve-web/signals';
import type { ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { GroundPrefabContext } from '../../prefab/src/groundPrefab';

const created: ArchiveSprite[] = [];
vi.mock('@dontstarve-web/animation/archiveSprite', async importOriginal => ({
  ...await importOriginal<typeof import('@dontstarve-web/animation/archiveSprite')>(),
  createSharedArchiveSprite: vi.fn(async () => {
    const model = new THREE.Group();
    model.add(new THREE.Group());
    const sprite = { model, frameCount: 1, currentAnimation: 'idle', dispose: vi.fn(() => model.removeFromParent()), update: vi.fn(),
      start: vi.fn(), playOnce: vi.fn(), setFrame: vi.fn(), setPaused: vi.fn() } as unknown as ArchiveSprite;
    created.push(sprite);
    return sprite;
  }),
}));

const { createGroundItemFactory, GroundItemAssets } = await import('../../prefab/src/groundItems');

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

it('unloads a settled ground item sprite with its tile and rebuilds it when the tile wakes', async () => {
  const tile = createSignal(true);
  const tickingarea = () => Object.assign(tile, { dispose() {} }) as never;
  const factory = createGroundItemFactory({ assets: new GroundItemAssets(), tickingarea } as unknown as GroundPrefabContext);
  const visual = await factory.create({ itemId: 'twigs', name: 'twigs', icon: '', count: 1 });
  expect(created).toHaveLength(1);
  visual.model.position.set(3, 0, 4);
  visual.model.dispatchEvent({ type: 'onload' } as never);
  await tick();
  expect(visual.active?.peek()).toBe(true);
  tile.set(false); await tick();
  expect(visual.active?.peek()).toBe(false);
  expect(created[0].dispose).toHaveBeenCalledOnce();
  tile.set(true); await tick();
  expect(created).toHaveLength(2);
  expect(visual.model.children[0]).toBe(created[1].model);
  visual.dispose();
  expect(created[1].dispose).toHaveBeenCalledOnce();
});
