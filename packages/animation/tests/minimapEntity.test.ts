import { readFile } from 'node:fs/promises';
import { Vector3 } from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { MiniMapEntity } from '../../prefab/src/minimapEntity';
import { loadMinimapIcon } from '../../prefab/src/minimapIcons';
import { ItemEntity, InventoryStore, BodySlot, equipmentSlotAddress } from '../../inventory/src';
import { configureBackpackEntity } from '../../prefab/src/backpack';
import { createPigKing } from '../../prefab/src/pigking';
import { disposeSprite } from '../../prefab/src/disposeSprite';

afterEach(() => vi.unstubAllGlobals());

it('tracks the owner transform without a cached position, and releases visibility on removal', () => {
  const position = new Vector3(6, 0, 6);
  const minimap = new MiniMapEntity(position);
  minimap.SetCanUseCache(false);
  position.set(-18, 0, 18);
  expect(minimap.position).toBe(position);
  expect(minimap.position.toArray()).toEqual([-18, 0, 18]);
  minimap.SetEnabled(false);
  expect(minimap.enabled).toBe(false);
  minimap.SetEnabled(true);
  expect(minimap.enabled).toBe(true);
  minimap.dispose();
  expect(minimap.enabled).toBe(false);
  expect(position.toArray()).toEqual([-18, 0, 18]);
});

it('resolves the player icon from its actual native minimap atlas', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(
    `../../../public${new URL(url).pathname}`, import.meta.url))));
  const icon = await loadMinimapIcon('http://minimap-test/dst/data', 'willow.png');
  expect(icon.name).toBe('willow.png');
  expect(icon.texturePath).toBe('http://minimap-test/dst/data/minimap/minimap_atlas2.tex');
  expect(icon.width).toBe(icon.height);
  expect(icon.width).toBeGreaterThan(32);
  expect(icon.pixels.some((value, i) => i % 4 === 3 && value === 0)).toBe(true);
  expect(icon.pixels.some((value, i) => i % 4 === 3 && value === 255)).toBe(true);
  for (const name of ['pigking.png', 'backpack.png']) {
    const worldIcon = await loadMinimapIcon('http://minimap-test/dst/data', name);
    expect(worldIcon.texturePath).toBe('http://minimap-test/dst/data/minimap/minimap_atlas2.tex');
  }
  await expect(loadMinimapIcon('http://minimap-test/dst/data', 'missing-player.png')).rejects.toThrow('lack icon');
});

it('keeps a backpack icon on the logical item through equip, drop, reskin and load, disposing it only on removal', () => {
  const body = equipmentSlotAddress('body');
  const specs = { backpack: { name: '背包', icon: 'backpack.tex', maxStack: 1, equippable: 'body' as const,
    canGoInContainer: false, configureEntity: configureBackpackEntity } };
  const store = new InventoryStore([{ address: body, slot: new BodySlot() }], specs, {});
  const backpack = new ItemEntity({ itemId: 'backpack', count: 1, entityId: 'map-backpack' });
  store.configureItem(backpack);
  const icon = backpack.MiniMapEntity!;
  backpack.transform.position.set(24, 0, -36);
  expect(icon.position).toBe(backpack.transform.position);
  expect(icon.icon).toBe('backpack.png');
  expect(store.Equip(backpack)).toBe(true);
  expect(icon.enabled).toBe(false);
  expect(store.entities.miniMapEntities).toEqual([]);
  const state = store.exportState();
  store.replaceState(state, {});
  expect(icon.enabled).toBe(false);
  const restored = store.getEntity(body)!;
  expect(restored.id).toBe('map-backpack');
  expect(restored.MiniMapEntity?.enabled).toBe(false);
  expect(store.entities.miniMapEntities).toEqual([]);
  store.DropItem(restored, new Vector3(-12, 0, 48));
  expect(restored.MiniMapEntity?.enabled).toBe(true);
  expect(store.entities.miniMapEntities).toEqual([restored.MiniMapEntity]);
  expect(restored.MiniMapEntity?.position.toArray()).toEqual([-12, 0, 48]);
  const droppedIcon = restored.MiniMapEntity;
  restored.apply({ ...restored.snapshot(), skinId: 'backpack_babybeef' });
  configureBackpackEntity(restored);
  expect(restored.MiniMapEntity).toBe(droppedIcon);
  expect(store.entities.miniMapEntities).toEqual([droppedIcon]);
  expect(restored.MiniMapEntity?.icon).toBe('backpack.png');
  restored.destroy();
  expect(droppedIcon?.enabled).toBe(false);
  expect(store.entities.miniMapEntities).toEqual([]);
  store.dispose();
});

it('initializes the source pig king icon and priority, and hides it on scene disposal', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(
    `../../../public/dst/data/${String(url).slice('/dst/data/'.length)}`, import.meta.url))));
  const king = await createPigKing('/dst/data/anim', { position: new Vector3(48, 0, 60) });
  expect(king.MiniMapEntity.icon).toBe('pigking.png');
  expect(king.MiniMapEntity.priority).toBe(1);
  expect(king.MiniMapEntity.position).toBe(king.standee.position);
  king.dispose();
  expect(king.MiniMapEntity.enabled).toBe(false);
  disposeSprite(king.standee);
});
