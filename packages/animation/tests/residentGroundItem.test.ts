import { prefabDisplay } from '../../display/src';
import { displayLights } from '../../display/src/displaySprites';
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { createSignal } from '@dontstarve-web/signals';
import type { ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { createPerishWorld } from './perishWorldFixture';
import { createPickupInventory } from './pickupFixture';
import { LanternEntity } from '../../prefab/src/lantern';

const created: ArchiveSprite[] = [];
vi.mock('@dontstarve-web/animation/archiveSprite', async importOriginal => ({
  ...await importOriginal<typeof import('@dontstarve-web/animation/archiveSprite')>(),
  preloadSharedArchiveSprite: vi.fn(async () => () => {
    const model = new THREE.Group();
    model.add(new THREE.Group());
    const sprite = { model, frameCount: 1, currentAnimation: 'idle', dispose: vi.fn(() => model.removeFromParent()), update: vi.fn(),
      start: vi.fn(), playOnce: vi.fn(), setFrame: vi.fn(), setPaused: vi.fn(), setSkin: vi.fn(), holdLastFrame: vi.fn(),
      setPlaybackRate: vi.fn() } as unknown as ArchiveSprite;
    created.push(sprite);
    return sprite;
  }),
}));

const { ItemWorldFixture, itemAt } = await import('./itemWorldFixture');

/** An item world whose one tile is awake while `tile` is true. */
function itemWorld(tile: ReturnType<typeof createSignal<boolean>>, inventory = createPickupInventory()) {
  const scene = new THREE.Scene();
  const items = new ItemWorldFixture(scene, new THREE.PerspectiveCamera(), undefined, '/dst/data/databundles/images.zip', inventory,
    '/dst/data/anim', new THREE.Group(), undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, () => Object.assign(tile, { dispose() {} }) as never);
  return { scene, items, inventory, dispose() { items.dispose(); inventory.dispose(); } };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

it('unloads a settled ground item sprite with its tile and rebuilds it when the tile wakes', async () => {
  const tile = createSignal(true), world = itemWorld(tile);
  const model = world.items.spawnFromSave('twigs', { itemId: 'twigs', name: 'twigs', icon: '', count: 1 }, new THREE.Vector3(3, 0, 4));
  const inst = itemAt(model), display = prefabDisplay(model)!;
  try {
    await tick(); // The display loads the art, then draws the first sprite.
    expect(created).toHaveLength(1);
    expect(inst.status.peek()).toBe('active');
    tile.set(false); await tick();
    expect(inst.status.peek()).toBe('asleep');
    expect(created[0].dispose).toHaveBeenCalledOnce();
    tile.set(true); await tick();
    expect(created).toHaveLength(2);
    expect(display.model.children[0]).toBe(created[1].model);
    // Picked up, the inst leaves the scene (RemoveFromScene): its display releases the sprite while it is held.
    expect(world.inventory.GiveItem(inst)).toBe(true);
    await tick();
    expect(inst.inlimbo).toBe(true);
    expect(created[1].dispose).toHaveBeenCalledOnce();
  } finally { world.dispose(); }
});

it('retains a lantern machine, light and fuel while its tile releases and rebuilds the sprite', async () => {
  const { LANTERN_FUEL } = await import('../../prefab/src/lantern');
  const tile = createSignal(true), world = itemWorld(tile);
  const perish = createPerishWorld();
  world.inventory.entities.bindPerishWorld(perish);
  const item = world.inventory.entities.create({ itemId: 'lantern', count: 1 });
  // inventoryitem:OnDropped turns the lantern on where it is set down.
  world.items.spawnGroundItem({ itemId: 'lantern', name: 'lantern', icon: '', count: 1, entity: item }, new THREE.Vector3(3, 0, 4));
  await tick();
  const model = item.transform.model, light = item.light.slots.peek();
  const listed = () => [...displayLights()].some(entry => entry.model === model);
  const drawn = created.at(-1)!;
  try {
    expect(light?.size).toBe(1);
    expect(listed()).toBe(true);
    expect(item.hasTag('light')).toBe(true);
    tile.set(false); await tick();
    expect(drawn.dispose).toHaveBeenCalledOnce();
    expect(model.parent).toBeNull();
    expect(item.components.machine!.IsOn()).toBe(true);
    expect(item).toBeInstanceOf(LanternEntity);
    expect(item instanceof LanternEntity && item._light!.parent).toBe(item);
    // The lanternlight is parented to the ground lantern: it goes out while the lantern's tile sleeps.
    expect(listed()).toBe(false);
    // Fuel follows the item's game time, not its sprite or frames.
    perish.advance(60);
    expect(item.components.fueled!.currentfuel).toBeCloseTo(LANTERN_FUEL - 60 - 1 / 60);
    tile.set(true); await tick();
    expect(model.parent).toBe(world.scene);
    expect(item.light.slots.peek()).toBe(light);
    expect(listed()).toBe(true);
    expect(model.position.toArray()).toEqual([3, 0, 4]);
    expect(created.at(-1)).not.toBe(drawn);
    prefabDisplay(model)!.update(0);
    expect(created.at(-1)!.playOnce).toHaveBeenCalledWith('idle_on');
  } finally { world.dispose(); }
});
