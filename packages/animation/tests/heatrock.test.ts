import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ItemEntity, equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { createPickupInventory } from './pickupFixture';
import { configureHeatRockEntity } from '../../prefab/src/heatrock';
import { GroundItemAssets, createGroundItemSprite, createGroundItemFactory } from '../../prefab/src/groundItems';
import type { GroundPrefabContext } from '../../prefab/src/groundPrefab';
import { createRecipe } from '../../ui/src/categories/shared';

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('creates individual unequippable stones with source tags and preserves their fueled durability', () => {
  const inventory = createPickupInventory();
  const saved = new ItemEntity({ itemId: 'heatrock', count: 1, remainingFuel: 62.5 });
  try {
    expect(inventory.add('heatrock', 2)).toBe(true);
    const first = inventory.getEntity(inventorySlotAddress(0))!;
    expect(first.snapshot()).toMatchObject({ itemId: 'heatrock', count: 1, remainingFuel: 100 });
    expect(inventory.get(inventorySlotAddress(1))).toMatchObject({ itemId: 'heatrock', count: 1 });
    expect(first.hasTag('heatrock')).toBe(true);
    expect(first.hasTag('icebox_valid')).toBe(true);
    expect(first.signals.durabilityPercent.peek()).toBe(1);
    expect(inventory.transfer(inventorySlotAddress(0), equipmentSlotAddress('hand'), 1)).toBe(false);
    expect(inventory.getEntity(inventorySlotAddress(0))).toBe(first);
    configureHeatRockEntity(saved); configureHeatRockEntity(saved);
    expect(saved.snapshot().remainingFuel).toBe(62.5);
    expect(saved.signals.durabilityPercent.peek()).toBe(.625);
  } finally { inventory.dispose(); saved.destroy(); }
});

it('renders the source neutral pose for base and skinned stones and resolves their crafting icons', async () => {
  const assets = new GroundItemAssets('/dst/data/anim');
  try {
    for (const skin of [undefined, 'heatrock_fantasy']) {
      const sprite = await createGroundItemSprite(assets, 'heatrock', skin);
      try {
        expect(sprite.currentAnimation).toBe('3');
        sprite.update(60);
        expect(sprite.currentAnimation).toBe('3');
        const mesh = sprite.model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
        expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
        expect(mesh.material.some(material => material.name === `ground:${skin ?? 'heat_rock'}`)).toBe(true);
        expect(Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      } finally { sprite.dispose(); }
    }
    const recipe = createRecipe('heatrock');
    expect(recipe.inventoryIcon).toBe('heat_rock3.tex');
    expect(recipe.skins.find(skin => skin.id === 'heatrock_fantasy')?.inventoryIcon).toBe('heatrock_fantasy3.tex');
    // A cold inst dropped or reskinned receives its own range, rather than the catalog's neutral pose.
    const entity = new ItemEntity({ itemId: 'heatrock', count: 1, skinId: 'heatrock_fantasy', temperature: { current: 0 }, lowTemp: 0 });
    configureHeatRockEntity(entity);
    const factory = createGroundItemFactory({ assets } as GroundPrefabContext);
    const visual = await factory.create({ ...entity.snapshot(), name: '暖石', icon: 'heatrock_fantasy1.tex' });
    try {
      visual.bindEntity?.(entity);
      expect((visual as unknown as { currentAnimation: string }).currentAnimation).toBe('1');
      visual.update?.(1);
      expect(entity.snapshot()).toMatchObject({ skinId: 'heatrock_fantasy', temperature: { current: 0 }, lowTemp: 0 });
      const mesh = visual.model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
      expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
      expect(mesh.material.some(material => material.name === 'ground:heatrock_fantasy')).toBe(true);
    } finally { visual.dispose(); entity.destroy(); factory.dispose?.(); }
  } finally { assets.dispose(); }
});
