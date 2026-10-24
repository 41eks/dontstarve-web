import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ItemEntity, equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { createPickupInventory } from './pickupFixture';
import { configureHeatRockEntity, type HeatRock } from '../../prefab/src/heatrock';
import { GroundItemAssets, createGroundItemSprite, createGroundItemFactory } from '../../prefab/src/groundItems';
import type { GroundPrefabContext } from '../../prefab/src/groundPrefab';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { createRecipe } from '../../ui/src/categories/shared';
import { batch, createSignal } from '../../signals/src';
import { ComponentUpdates } from '../../componets/src/componentUpdates';

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

it('registers temperature updates once, moves them between worlds and unregisters during removal', () => {
  const inventory = createPickupInventory(), updates = new ComponentUpdates(), nextUpdates = new ComponentUpdates();
  const temperature = createSignal(35);
  inventory.entities.bindTemperatureWorld({ temperature, componentUpdates: updates });
  try {
    inventory.add('log', 1);
    inventory.add('heatrock', 2);
    const first = inventory.getEntity(inventorySlotAddress(1))!, second = inventory.getEntity(inventorySlotAddress(2))!;
    inventory.configureItem(first);
    inventory.configureItem(first);
    const firstUpdate = vi.spyOn(first.components.temperature!, 'OnUpdate');
    const secondUpdate = vi.spyOn(second.components.temperature!, 'OnUpdate');
    first.components.temperature!.SetTemperature(45);
    updates.update(1);
    expect(first.components.temperature!.GetCurrent()).toBe(44);
    expect(firstUpdate).toHaveBeenCalledTimes(1);
    expect(secondUpdate).toHaveBeenCalledTimes(1);
    inventory.entities.bindTemperatureWorld({ temperature, componentUpdates: nextUpdates });
    firstUpdate.mockClear(); secondUpdate.mockClear();
    updates.update(10);
    expect(firstUpdate).not.toHaveBeenCalled();
    expect(secondUpdate).not.toHaveBeenCalled();
    // Removal from inside OnUpdate must unregister the component while allowing its peer to update.
    const onTemperature = first.ListenForEvent('temperaturedelta', () => first.remove());
    nextUpdates.update(1);
    expect(first.isRemoved).toBe(true);
    expect(firstUpdate).toHaveBeenCalledTimes(1);
    expect(secondUpdate).toHaveBeenCalledTimes(1);
    nextUpdates.update(1);
    expect(firstUpdate).toHaveBeenCalledTimes(1);
    expect(secondUpdate).toHaveBeenCalledTimes(2);
    onTemperature();
    inventory.dispose();
    nextUpdates.update(1);
    expect(secondUpdate).toHaveBeenCalledTimes(2);
  } finally { inventory.dispose(); updates.dispose(); nextUpdates.dispose(); }
});

it('derives range from temperature signals, updates icons in effects and preserves synchronous usage accounting', async () => {
  const ambient = createSignal(35), updates = new ComponentUpdates();
  const entity = new ItemEntity({ itemId: 'heatrock', count: 1, temperature: { current: 66 }, remainingFuel: 75 });
  configureHeatRockEntity(entity);
  entity.BindTemperatureWorld({ temperature: ambient, componentUpdates: updates });
  const temperature = entity.components.temperature!, rock = entity.getComponent<HeatRock>('heatrock')!;
  const image = () => entity.components.inventoryitem.image.peek()!.icon;
  try {
    expect('set' in temperature.current).toBe(false);
    expect('set' in rock.range).toBe(false);
    expect(rock.range.peek()).toBe(5);
    expect(image()).toBe('heat_rock5.tex');
    // Domain events must account for both transitions before the batched memo/effect settles.
    batch(() => { updates.update(21); updates.update(1); });
    expect(temperature.current.peek()).toBe(44);
    expect(rock.range.peek()).toBe(3);
    expect(entity.snapshot()).toMatchObject({ temperature: { current: 44 }, remainingFuel: 62.5 });
    expect(entity.highTemp).toBeUndefined();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(image()).toBe('heat_rock3.tex');
    // Ambient-only changes also derive a new range; the exact +30 boundary stays in range 4.
    ambient.set(13); updates.update(0);
    expect(rock.range.peek()).toBe(5);
    ambient.set(14); updates.update(0);
    expect(temperature.current.peek()).toBe(44);
    expect(rock.range.peek()).toBe(4);
    expect(entity.snapshot().remainingFuel).toBe(62.5);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(image()).toBe('heat_rock4.tex');
    entity.skinId = 'heatrock_fantasy';
    configureHeatRockEntity(entity);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(image()).toBe('heatrock_fantasy4.tex');
    expect(entity.snapshot()).toMatchObject({ temperature: { current: 44 }, remainingFuel: 62.5, skinId: 'heatrock_fantasy' });
    const changeImage = vi.spyOn(entity.components.inventoryitem, 'ChangeImageName');
    temperature.SetTemperature(80);
    rock.dispose(); // Cancels pending art changes and releases the temperature bridge/memo.
    temperature.SetTemperature(0);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(changeImage).not.toHaveBeenCalled();
    expect(rock.range.peek()).toBe(5);
  } finally { entity.destroy(); updates.dispose(); }
});

it('renders the source neutral pose for base and skinned stones and resolves their crafting icons', async () => {
  const assets = new GroundItemAssets();
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
      // The prefab only declares what the sprite follows; the display applies it.
      const sprite = prefabInstance(visual.model)!.sprite;
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(sprite.currentAnimation).toBe('1');
      visual.update?.(1);
      expect(entity.snapshot()).toMatchObject({ skinId: 'heatrock_fantasy', temperature: { current: 0 }, lowTemp: 0 });
      let mesh!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
      visual.model.traverse(object => { if (object instanceof THREE.Mesh) mesh ??= object as typeof mesh; });
      expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
      expect(mesh.material.some(material => material.name === 'ground:heatrock_fantasy')).toBe(true);
      entity.components.temperature!.SetTemperature(80);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(sprite.currentAnimation).toBe('5');
    } finally { visual.dispose(); entity.destroy(); factory.dispose?.(); }
  } finally { assets.dispose(); }
});
