import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

for (const itemId of ['yellowstaff'] as const) {
 for (const hasRandomUUID of [false]) {
  test(`${itemId} summons persistent lights (crypto.randomUUID: ${hasRandomUUID})`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    if (!hasRandomUUID) await page.addInitScript(() => {
      Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    });
    await page.goto('/tests/dst-lighting.html');
    const result = await page.evaluate(async ({ url, itemId }) => {
      const { checkYellowStaff } = await import(url);
      return checkYellowStaff(itemId);
    }, { url: `/@fs${fileURLToPath(new URL('./yellowstaff-fixture.ts', import.meta.url))}`, itemId });
    expect(result.failures).toEqual([]);
    expect(result.skins).toBe(4);
    expect(result).toMatchObject({ unlitHand: true, ignoredLeft: true, busy: true, beforeCommit: 0,
      given: { ok: true }, transferred: true,
      prefabId: itemId === 'opalstaff' ? 'staffcoldlight' : 'stafflight',
      afterCommit: 1, remainingSeconds: itemId === 'opalstaff' ? 960 : 1440, fixedPosition: true,
      survivesUntilExpiry: true, expiresAtLifetime: true, lifetimeRemoved: true,
      stops: 2, appeared: true, cancelled: true, noCastingLight: true,
      ignoredUnequipped: true, restoredLit: true, expiredNotSaved: true, expiredRemoved: true, survivor: 1 });
    expect(result.position[0]).toBeCloseTo(30);
    expect(result.position[1]).toBe(0);
    expect(result.position[2]).toBeCloseTo(0);
    expect(result.radius).toBeGreaterThanOrEqual(33);
    expect(result.radius).toBeLessThanOrEqual(36);
    expect(result.colour).toEqual(itemId === 'opalstaff' ? [64 / 255, 64 / 255, 208 / 255] : [223 / 255, 208 / 255, 69 / 255]);
    expect(result.bright).toBeGreaterThan(result.baseline + 100);
    expect(result.far).toBe(result.baseline);
    expect(result.disposedDark).toBe(result.baseline);
    expect(errors).toEqual([]);
  });
 }
}
