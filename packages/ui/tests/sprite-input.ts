import { expect, type Page } from '@playwright/test';

/** Follow the current camera/art and wait for the previous action to finish before the next real click. */
export async function hoverSprite(page: Page, screenPoint: () => Promise<{ x: number; y: number }>,
  gameKey: string, button: 'left' | 'right', action: string) {
  let point = { x: 0, y: 0 };
  await expect.poll(async () => {
    const busy = await page.evaluate(key => {
      const { player, inventory } = (window as any)[key];
      const graph = player.userData.animationController.stategraph;
      if (graph.stateName !== 'idle') return true;
      // These fixtures switch between the source shovel and sweeper. Their assets may finish after slot state changes.
      const build: Record<string, string> = { shovel: 'ground:swap_shovel', reskin_tool: 'ground:swap_reskin_tool' };
      const expected = build[inventory.handEquipment.peek()?.itemId];
      if (!expected) return false;
      const mesh = player.getObjectByProperty('isMesh', true);
      return !mesh.geometry.groups.some((group: { materialIndex: number }) => mesh.material[group.materialIndex].name === expected);
    }, gameKey);
    if (busy) return undefined;
    point = await screenPoint();
    await page.mouse.move(point.x, point.y);
    return page.evaluate(({ key, button }) => (window as any)[key].view.mouseActions.getMouseActions()[button]?.action, { key: gameKey, button });
  }).toBe(action);
  return point;
}
