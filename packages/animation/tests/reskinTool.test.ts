import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createInventoryStore } from '../../../src/inventory';
import { executeDebugCommand } from '../../../src/debugCommands';
import { equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { GROUND_ITEM_DEFINITIONS, GroundItemAssets, createGroundItemSprite } from '../../prefab/src/groundItems';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { parseImageAtlasXml } from '../src/imageAtlas';

// Application inventory imports the UI's metadata through its package entry point.
vi.mock('@dontstarve-web/ui', async () => ({
  ...await import('../../ui/src/inventory-items'),
  ...await import('../../ui/src/categories/shared'),
}));

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const path = String(url).slice('/dst/data/'.length);
    return new Response(await readFile(new URL(`../../../public/dst/data/${path}`, import.meta.url)));
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('gives separate sweepers through the application inventory, resolves their icon and accepts hand equipment', async () => {
  const inventory = createInventoryStore();
  expect(await executeDebugCommand('c_give("reskin_tool", 2)', inventory)).toEqual({
    ok: true, message: '已添加 2 个 reskin_tool',
  });
  expect(inventory.get(inventorySlotAddress(0))).toEqual({ itemId: 'reskin_tool', count: 1 });
  expect(inventory.get(inventorySlotAddress(1))).toEqual({ itemId: 'reskin_tool', count: 1 });
  const spec = inventory.getItemSpec('reskin_tool');
  expect(spec).toMatchObject({
    name: '清洁扫把', icon: 'reskin_tool.tex', atlas: 'images/inventoryimages3.xml', maxStack: 1, equippable: 'hand',
  });
  const bytes = await readFile(new URL('../../../public/dst/data/databundles/images.zip', import.meta.url));
  const xml = unzipSync(bytes, { filter: (file) => file.name === spec.atlas })[spec.atlas!];
  expect(parseImageAtlasXml(new TextDecoder().decode(xml)).elements.has(spec.icon)).toBe(true);
  expect(inventory.applySlotChanges([
    { slot: inventorySlotAddress(0), itemId: 'reskin_tool', delta: -1 },
    { slot: equipmentSlotAddress('hand'), itemId: 'reskin_tool', delta: 1 },
  ])).toBe(true);
  expect(inventory.get(equipmentSlotAddress('hand'))).toEqual({ itemId: 'reskin_tool', count: 1 });
});

it('renders source ground and held art for the base sweeper and all four skins, then removes held art', async () => {
  const assets = new GroundItemAssets('/dst/data/anim');
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = player.userData.animationController as WilsonAnimationController;
  const skins = Object.keys(GROUND_ITEM_DEFINITIONS.reskin_tool.skinArchives);
  expect(skins).toHaveLength(4);
  for (const skinId of [undefined, ...skins]) {
    const ground = await createGroundItemSprite(assets, 'reskin_tool', skinId);
    expect((ground.model.children[0].children[0] as THREE.Mesh).geometry.drawRange.count).toBeGreaterThan(0);
    await animation.setCarryItem('reskin_tool', skinId);
    for (const facing of ['down', 'side', 'up'] as const) {
      animation.setFacing(facing);
      animation.update(1 / 30);
      const mesh = player.children[0].children[0] as THREE.Mesh;
      const build = skinId ?? 'swap_reskin_tool';
      expect((mesh.material as THREE.Material[]).some((material) => material.name === `ground:${build}`)).toBe(true);
    }
    ground.dispose();
  }
  await animation.setCarryItem(null);
  const mesh = player.children[0].children[0] as THREE.Mesh;
  expect((mesh.material as THREE.Material[]).some((material) => material.name.startsWith('ground:'))).toBe(false);
});
