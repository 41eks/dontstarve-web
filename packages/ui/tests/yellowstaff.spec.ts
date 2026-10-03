import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

for (const hasRandomUUID of [true, false]) {
  test(`yellowstaff summons persistent dwarf stars (crypto.randomUUID: ${hasRandomUUID})`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    if (!hasRandomUUID) await page.addInitScript(() => {
      Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    });
    await page.goto('/tests/dst-lighting.html');
    const result = await page.evaluate(async (url) => {
      const { checkYellowStaff } = await import(url);
      return checkYellowStaff();
    }, `/@fs${fileURLToPath(new URL('./yellowstaff-fixture.ts', import.meta.url))}`);
    expect(result.failures).toEqual([]);
    expect(result.skins).toBe(4);
    expect(result).toMatchObject({ unlitHand: true, ignoredLeft: true, busy: true, beforeCommit: 0,
      afterCommit: 1, remainingSeconds: 1440, fixedPosition: true,
      survivesUntil24Minutes: true, expiresAt24Minutes: true, lifetimeRemoved: true,
      stops: 2, appeared: true, cancelled: true, noCastingLight: true,
      ignoredUnequipped: true, restoredLit: true, expiredNotSaved: true, expiredRemoved: true, survivor: 1 });
    expect(result.position[0]).toBeCloseTo(30);
    expect(result.position[1]).toBe(0);
    expect(result.position[2]).toBeCloseTo(0);
    expect(result.radius).toBeGreaterThanOrEqual(33);
    expect(result.radius).toBeLessThanOrEqual(36);
    expect(result.bright).toBeGreaterThan(result.baseline + 100);
    expect(result.far).toBe(result.baseline);
    expect(result.disposedDark).toBe(result.baseline);
    expect(errors).toEqual([]);
  });
}
