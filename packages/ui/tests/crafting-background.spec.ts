import { expect, test } from '@playwright/test';

test('composes the frame into one background and replaces/releases it when layout changes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/tests/fixture.html');
  const crafting = page.locator('dst-crafting-ui');
  await crafting.locator('.craft-quick-toggle').click();
  const background = crafting.locator('.craft-background');
  await expect(background).toHaveAttribute('data-loaded', 'true');
  const firstUrl = await background.evaluate((node) => node.style.backgroundImage.slice(5, -2));
  const pixels = await crafting.evaluate(async (host) => {
    const root = host.shadowRoot!;
    const panel = root.querySelector<HTMLElement>('.craft-panel')!;
    const background = root.querySelector<HTMLElement>('.craft-background')!;
    const categories = root.querySelector<HTMLElement>('.craft-categories')!;
    const marker = root.querySelector<HTMLElement>('.craft-scroll-marker')!;
    const image = new Image();
    image.src = background.style.backgroundImage.slice(5, -2);
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    const scale = image.width / panel.offsetWidth;
    const top = -parseFloat(background.style.top);
    const categoryY = categories.offsetTop + categories.offsetHeight;
    const detailY = marker.offsetTop + marker.offsetHeight / 2;
    const centreY = Math.round((top + (categoryY + detailY) / 2) * scale);
    const centreAlpha = data[(centreY * image.width + Math.floor(image.width / 2)) * 4 + 3];
    const opaqueWidth = (divider: number) => {
      const centre = Math.round((top + divider) * scale);
      return Math.max(...Array.from({ length: 25 }, (_, offset) => {
        const y = centre + offset - 12;
        let opaque = 0;
        for (let x = 0; x < image.width; x++) if (data[(y * image.width + x) * 4 + 3] > 245) opaque++;
        return opaque / image.width;
      }));
    };
    return { centreAlpha, categoryBar: opaqueWidth(categoryY), detailBar: opaqueWidth(detailY),
      children: background.childElementCount, extendsBeyondPanel: image.height > panel.offsetHeight * scale };
  });
  expect(pixels.children).toBe(0);
  expect(pixels.centreAlpha).toBeGreaterThan(140);
  expect(pixels.centreAlpha).toBeLessThan(155);
  expect(pixels.categoryBar).toBeGreaterThan(0.9);
  expect(pixels.detailBar).toBeGreaterThan(0.9);
  expect(pixels.extendsBeyondPanel).toBe(true);

  await crafting.locator('.craft-view-toggle').click();
  await expect(background).toBeVisible();
  const collapsed = await crafting.evaluate((host) => {
    const root = host.shadowRoot!;
    const panel = root.querySelector<HTMLElement>('.craft-panel')!;
    const bounds = panel.getBoundingClientRect();
    const quick = root.querySelector<HTMLElement>('.craft-quickbar')!.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, width: panel.offsetWidth,
      quickLeft: quick.left, inert: root.querySelector<HTMLElement>('.craft-header')!.inert };
  });
  expect(collapsed.left).toBeLessThan(0);
  expect(collapsed.right).toBeGreaterThan(0);
  expect(collapsed.right).toBeLessThan(16);
  expect(collapsed.quickLeft).toBeGreaterThan(0);
  expect(collapsed.quickLeft).toBeLessThan(10);
  expect(collapsed.width).toBe(580);
  expect(collapsed.inert).toBe(true);
  expect(await background.evaluate((node) => node.style.backgroundImage.slice(5, -2))).toBe(firstUrl);
  await crafting.locator('.craft-quick-toggle').click();
  await expect(background).toBeVisible();
  expect(await background.evaluate((node) => node.style.backgroundImage.slice(5, -2))).toBe(firstUrl);

  await page.setViewportSize({ width: 640, height: 640 });
  await expect.poll(() => background.evaluate((node) => node.style.backgroundImage.slice(5, -2))).not.toBe(firstUrl);
  await expect(background).toHaveAttribute('data-loaded', 'true');
  const resizedUrl = await background.evaluate((node) => node.style.backgroundImage.slice(5, -2));
  const revoked = async (url: string) => page.evaluate(async (url) => {
    const image = new Image(); image.src = url;
    return image.decode().then(() => false, () => true);
  }, url);
  expect(await revoked(firstUrl)).toBe(true);
  await crafting.evaluate((element) => element.remove());
  expect(await revoked(resizedUrl)).toBe(true);
});
