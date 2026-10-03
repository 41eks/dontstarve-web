import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const moduleUrl = (path: string) => `/@fs${fileURLToPath(new URL(path, import.meta.url))}`;
const modules = {
  hats: moduleUrl('../../prefab/src/hats.ts'),
  player: moduleUrl('../../prefab/src/player.ts'),
  inventory: moduleUrl('../../../src/inventory.ts'),
  ui: moduleUrl('../src/index.ts'),
  atlas: moduleUrl('../../animation/src/imageAtlas.ts'),
  preview: moduleUrl('./hat-preview.ts'),
};

test('all hats have inventory icons; craft respects single hats and nonconsumed tools', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/tests/fixture.html');
  const result = await page.evaluate(async (modules) => {
    const { HAT_IDS, HAT_DEFINITIONS, HAT_ITEM_SPECS, HAT_RECIPES } = await import(modules.hats);
    const { createInventoryStore } = await import(modules.inventory);
    const { inventorySlotAddress, equipmentSlotAddress, INVENTORY_RECIPES } = await import(modules.ui);
    const { loadImageAtlas } = await import(modules.atlas);
    const missingIcons: string[] = [];
    for (const id of HAT_IDS) {
      const { icon, atlas } = HAT_ITEM_SPECS[id];
      const sprite = (await loadImageAtlas('/dst/data/databundles/images.zip', atlas)).require(icon);
      if (!sprite.pixels.some((v: number, index: number) => index % 4 === 3 && v > 0)) missingIcons.push(id);
    }
    const store = createInventoryStore([{ slot_index: 0, id: 'cutgrass', num: 24 }]);
    const crafted = [store.craft(INVENTORY_RECIPES.strawhat), store.craft(INVENTORY_RECIPES.strawhat)];
    const hatStacks = store.exportState().slots.flatMap(({ item }: { item: { itemId: string; count: number } | null }) =>
      item?.itemId === 'strawhat' ? [item.count] : []);
    const equipped = store.applySlotChanges([{ slot: inventorySlotAddress(1), itemId: 'strawhat', delta: -1 },
      { slot: equipmentSlotAddress('head'), itemId: 'strawhat', delta: 1 }]);
    const unequipped = store.applySlotChanges([{ slot: equipmentSlotAddress('head'), itemId: 'strawhat', delta: -1 },
      { slot: inventorySlotAddress(2), itemId: 'strawhat', delta: 1 }]);
    const woodie = createInventoryStore([
      { slot_index: 0, id: 'log', num: 6 }, { slot_index: 1, id: 'pinecone', num: 1 },
    ]);
    const noTool = woodie.craft(HAT_RECIPES.woodcarvedhat);
    woodie.add('lucy', 1);
    const withTool = woodie.craft(HAT_RECIPES.woodcarvedhat);
    return {
      hatCount: HAT_IDS.length, sourceRecipes: Object.keys(HAT_RECIPES).length,
      missingIcons, crafted, hatStacks, equipped, unequipped, noTool, withTool,
      toolCount: woodie.materialSummary().lucy,
      balloonCraftable: Boolean(INVENTORY_RECIPES.balloonhat),
      droppedHatHasRecipe: Boolean(HAT_RECIPES.walrushat),
      mirrorPaths: Object.values(HAT_DEFINITIONS).every((hat: any) => hat.archive.startsWith('hat_')),
    };
  }, modules);
  expect(result).toEqual({
    hatCount: 82, sourceRecipes: 51, missingIcons: [], crafted: [true, true], hatStacks: [1, 1],
    equipped: true, unequipped: true, noTool: false, withTool: true, toolCount: 1,
    balloonCraftable: false, droppedHatHasRecipe: false, mirrorPaths: true,
  });
});

test('82 hats render in every player facing and remain in one merged mesh', async ({ page }) => {
  test.setTimeout(120_000);
  const failedRequests: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400 && new URL(response.url()).pathname.startsWith('/dst/data/anim/')) failedRequests.push(response.url());
  });
  await page.goto('/tests/fixture.html');
  const result = await page.evaluate(async (modules) => {
    const { HAT_IDS, HAT_DEFINITIONS } = await import(modules.hats);
    const { createWilsonPlayer } = await import(modules.player);
    const player = await createWilsonPlayer('/dst/data/anim');
    const controller = player.userData.animationController;
    const visual = player.children[0];
    const mesh = visual.children[0];
    await controller.setHat(null);
    const unequipped = Array.from(mesh.geometry.attributes.position.array);
    const failures: string[] = [];
    for (const id of HAT_IDS) {
      await controller.setHat(id);
      for (const facing of ['down', 'side', 'up']) {
        controller.setFacing(facing, facing === 'side');
        controller.update(0.04);
        if (visual.children.length !== 1 || !mesh.isMesh || !mesh.geometry.index
          || mesh.geometry.drawRange.count < 6) failures.push(`${id}:${facing}:geometry`);
        const hatMaterials = mesh.geometry.groups.map((group: any) => mesh.material[group.materialIndex])
          .filter((material: any) => material.name.startsWith('hat:')
            && material.map && material.forceSinglePass && material.side === 2);
        if (!hatMaterials.length) failures.push(`${id}:${facing}:materials`);
      }
      controller.setFacing('down');
      controller.start('idle');
      await controller.setHat(null);
      if (JSON.stringify(Array.from(mesh.geometry.attributes.position.array)) !== JSON.stringify(unequipped)) {
        // Only active vertices matter: capacity grows when equipping layered hats.
        const count = mesh.geometry.drawRange.count / 6 * 12;
        if (JSON.stringify(Array.from(mesh.geometry.attributes.position.array).slice(0, count))
          !== JSON.stringify(unequipped.slice(0, count))) failures.push(`${id}:unequip`);
      }
    }
    for (const [id, definition] of Object.entries(HAT_DEFINITIONS)) {
      for (const skinId of Object.keys((definition as any).skinArchives)) {
        await controller.setHat(id, skinId);
        for (const facing of ['down', 'side', 'up']) {
          controller.setFacing(facing);
          controller.update(0.04);
          if (!mesh.geometry.groups.some((group: any) =>
            mesh.material[group.materialIndex].name.startsWith('hat:'))) failures.push(`${skinId}:${facing}:missing-art`);
        }
      }
    }
    controller.setFacing('down');
    // An earlier load must never replace the latest requested hat.
    const slow = controller.setHat('strawhat', 'strawhat_cowboy');
    await controller.setHat('footballhat');
    await slow;
    const afterRace = Array.from(mesh.geometry.attributes.position.array).slice(0, mesh.geometry.drawRange.count / 6 * 12);
    await controller.setHat(null);
    await controller.setHat('footballhat');
    const expectedRace = Array.from(mesh.geometry.attributes.position.array).slice(0, mesh.geometry.drawRange.count / 6 * 12);
    return { failures, raceSafe: JSON.stringify(afterRace) === JSON.stringify(expectedRace),
      skinCount: Object.values(HAT_DEFINITIONS).reduce((n: number, h: any) => n + Object.keys(h.skinArchives).length, 0) };
  }, modules);
  expect(failedRequests).toEqual([]);
  expect(result).toEqual({ failures: [], raceSafe: true, skinCount: 144 });
});

test('renders a visual catalog of the imported hats', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto('/tests/fixture.html');
  await page.evaluate(async (modules) => {
    const { renderHatCatalog } = await import(modules.preview);
    await renderHatCatalog();
  }, modules);
  await page.locator('#hat-gallery').screenshot({ path: testInfo.outputPath('hat-catalog.png') });
});

test('ground hats use anim geometry, preserve feet and pick up through merged mesh hits', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/tests/fixture.html');
  const result = await page.evaluate(async (url) => {
    const { checkGroundHats } = await import(url);
    return checkGroundHats();
  }, moduleUrl('./ground-hat-fixture.ts'));
  expect(result).toEqual({
    failedDrop: false, rollbackCount: 0, foot: [0, 0, 0], isAnimatedMesh: true,
    pickedUp: ['strawhat', 'torch'], rejectedPickupCount: 1, afterPickupCount: 0,
    failures: [], restoredFoot: [3, 0.25, 4], torchIsMesh: true, torchFoot: [-6, 0, 0], torchPickedUp: true,
  });
});
