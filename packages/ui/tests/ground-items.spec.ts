import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const moduleUrl = (path: string) => `/@fs${fileURLToPath(new URL(path, import.meta.url))}`;

test('base turf and woodfloor preserve complete ground sprites at different camera angles', async ({ page }) => {
  await page.goto('/tests/fixture.html');
  const result = await page.evaluate(async (url) => {
    const { checkTurfOcclusion } = await import(url);
    return checkTurfOcclusion();
  }, moduleUrl('./turf-fixture.ts'));
  expect(result).toEqual({ comparisons: 24, failures: [] });
});

test('ground catalog renders every source frame and skin without inventory icons', async ({ page }) => {
  test.setTimeout(240_000);
  const failedRequests: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400 && new URL(response.url()).pathname.startsWith('/dst/data/')) failedRequests.push(response.url());
  });
  await page.goto('/tests/fixture.html');
  const result = await page.evaluate(async (urls) => {
    const { GroundItemAssets, GROUND_ITEM_DEFINITIONS, createGroundItemSprite, GROUND_ITEM_SKIN_SPECS } = await import(urls.ground);
    const { HAT_DEFINITIONS, HAT_CRAFTING_DEFINITIONS } = await import(urls.hats);
    const { loadImageAtlas } = await import(urls.atlas);
    const { createInventoryStore } = await import(urls.inventory);
    const assets = new GroundItemAssets('/dst/data/anim');
    const failures: string[] = [];
    const check = async (id: string, skinId?: string) => {
      try {
        const sprite = await createGroundItemSprite(assets, id, skinId);
        const definition = GROUND_ITEM_DEFINITIONS[id];
        const clip = (await assets.loadAnimation(definition.animationArchive)).animations
          .find((animation: any) => animation.name === definition.animation)!;
        for (let step = 0; step <= Math.ceil(clip.frames.length / clip.frameRate / 0.05); step++) {
          sprite.update(0.05);
          const mesh = sprite.model.children[0].children[0];
          if (!mesh.isMesh) throw new Error('missing merged mesh');
          const rawFrame = Math.floor((step + 1) * 0.05 * clip.frameRate + 0.000001);
          const frame = clip.frames[definition.loop ? rawFrame % clip.frames.length : Math.min(rawFrame, clip.frames.length - 1)];
          if (frame.elements.length > 0 && mesh.geometry.drawRange.count < 6) throw new Error('empty geometry');
          if (mesh.material.some((material: any) => !material.forceSinglePass)) throw new Error('face passes');
        }
        if (skinId) {
          const mesh = sprite.model.children[0].children[0];
          const skin = await assets.loadBuild(definition.skinArchives[skinId]);
          if (!mesh.material.some((material: any) => skin.materials.includes(material))) throw new Error('skin unused');
        }
        sprite.dispose();
      } catch (error) { failures.push(`${id}:${skinId ?? ''}:${String(error)}`); }
    };
    for (const id of Object.keys(GROUND_ITEM_DEFINITIONS)) {
      await check(id);
      const spec = GROUND_ITEM_DEFINITIONS[id];
      const image = (await loadImageAtlas('/dst/data/databundles/images.zip', spec.atlas)).require(spec.icon);
      if (!image.pixels.some((value: number, index: number) => index % 4 === 3 && value > 0)) failures.push(`${id}:icon`);
    }
    for (const [id, definition] of Object.entries(GROUND_ITEM_DEFINITIONS)) {
      for (const skinId of Object.keys((definition as any).skinArchives)) await check(id, skinId);
    }
    const store = createInventoryStore();
    let removed = false;
    try { store.getItemSpec('shadow_thrall_parasitehat'); } catch { removed = true; }
    const common = ['torch', 'lantern', 'lightbulb', 'yellowstaff', 'meatballs', 'cutgrass', 'twigs', 'log', 'rocks', 'goldnugget',
      'gears', 'charcoal', 'pigskin', 'cutstone', 'rope',
      'wall_stone_item', 'wall_wood_item', 'wall_hay_item', 'wall_ruins_item',
      'wall_moonrock_item', 'wall_dreadstone_item', 'wall_scrap_item', 'axe', 'hammer'];
    return { failures, count: Object.keys(GROUND_ITEM_DEFINITIONS).length,
      skins: Object.keys(GROUND_ITEM_SKIN_SPECS).length,
      common: common.every((id) => GROUND_ITEM_DEFINITIONS[id] && store.getItemSpec(id)),
      removed: removed && !HAT_DEFINITIONS.shadow_thrall_parasitehat
        && !HAT_CRAFTING_DEFINITIONS.some((recipe: any) =>
          recipe.name === 'shadow_thrall_parasitehat' || recipe.config.product === 'shadow_thrall_parasitehat'),
    };
  }, { ground: moduleUrl('../../prefab/src/groundItems.ts'), hats: moduleUrl('../../prefab/src/hats.ts'),
    atlas: moduleUrl('../../animation/src/imageAtlas.ts'), inventory: moduleUrl('../../../src/inventory.ts') });
  expect(result.failures).toEqual([]);
  expect(result).toMatchObject({ count: 223, skins: 132, common: true, removed: true });
  expect(failedRequests).toEqual([]);
});

test('common ground items drop and pick up with native geometry and preserve saved feet', async ({ page }) => {
  await page.goto('/tests/fixture.html');
  const result = await page.evaluate(async (url) => {
    const { checkGroundItemPickup } = await import(url);
    return checkGroundItemPickup();
  }, moduleUrl('./ground-item-pickup-fixture.ts'));
  expect(result).toEqual({ failures: [],
    pickedUp: ['torch', 'lantern', 'lightbulb', 'yellowstaff', 'meatballs', 'cutgrass', 'twigs', 'log', 'rocks', 'goldnugget',
      'gears', 'charcoal', 'pigskin', 'cutstone', 'rope',
      'wall_stone_item', 'wall_wood_item', 'wall_hay_item', 'wall_ruins_item',
      'wall_moonrock_item', 'wall_dreadstone_item', 'wall_scrap_item', 'axe', 'hammer'],
    blockedDistantPickups: 24, failedLoad: true, inventoryMutations: 0, failedTransfer: false, remaining: 0, restoredFoot: [2, 0.25, 3],
  });
});
