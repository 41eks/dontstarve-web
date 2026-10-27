import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { createSignal } from '@dontstarve-web/signals';
import type { ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { GroundPrefabContext } from '../../prefab/src/groundPrefab';
import { createPerishWorld } from './perishWorldFixture';

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
  // Pausing is sprite json: it reaches the drawn sprite on its next frame.
  visual.model.dispatchEvent({ type: 'onputininventory' } as never);
  visual.update!(0);
  expect(created[1].setPaused).toHaveBeenLastCalledWith(true);
  visual.dispose();
  expect(created[1].dispose).toHaveBeenCalledOnce();
});

it('retains a lantern machine, light and fuel while its tile releases and rebuilds the sprite', async () => {
  const { createLanternGroundSprite, configureLanternEntity, getLanternController, LANTERN_FUEL } = await import('../../prefab/src/lantern');
  const { ItemEntity } = await import('../../inventory/src');
  const tile = createSignal(true), assets = new GroundItemAssets();
  const visual = await createLanternGroundSprite({ assets, tickingarea: () => Object.assign(tile, { dispose() {} }) as never });
  const item = new ItemEntity({ itemId: 'lantern', count: 1 });
  const world = createPerishWorld();
  item.BindPerishWorld(world);
  configureLanternEntity(item); visual.bindEntity!(item);
  const scene = new THREE.Scene(), model = visual.model;
  scene.add(model); model.position.set(3, 0, 4);
  model.dispatchEvent({ type: 'ondropped' } as never); await tick();
  const controller = getLanternController(item), light = model.getObjectByName('lanternlight');
  const drawn = created.at(-1)!;
  try {
    expect(light).toBeDefined();
    expect(model.userData.instance.hasTag('light')).toBe(true);
    tile.set(false); await tick();
    expect(drawn.dispose).toHaveBeenCalledOnce();
    expect(model.parent).toBeNull();
    expect(controller.isOn).toBe(true);
    expect(visual.light.parent).toBe(model);
    // Fuel follows the item's game time, not its sprite or frames.
    world.advance(60);
    expect(item.components.fueled!.currentfuel).toBeCloseTo(LANTERN_FUEL - 60 - 1 / 60);
    tile.set(true); await tick();
    expect(model.parent).toBe(scene);
    expect(model.getObjectByName('lanternlight')).toBe(light);
    expect(model.position.toArray()).toEqual([3, 0, 4]);
    expect(created.at(-1)).not.toBe(drawn);
    visual.update!(0);
    expect(created.at(-1)!.playOnce).toHaveBeenCalledWith('idle_on');
  } finally { visual.dispose(); item.destroy(); assets.dispose(); }
});
