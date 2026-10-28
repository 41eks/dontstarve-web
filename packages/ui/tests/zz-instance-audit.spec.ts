// Temporary audit: lists projected entity roots without a PrefabInstance. Delete after use.
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const src = (name: string) => `/@fs${fileURLToPath(new URL(`../../../src/${name}.ts`, import.meta.url))}`;
const pkg = (path: string) => `/@fs${fileURLToPath(new URL(`../../${path}`, import.meta.url))}`;

for (const shard of ['Master', 'Caves']) {
  test(`instance audit ${shard}`, async ({ page }) => {
    test.setTimeout(600_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/tests/dst-lighting.html?save=Cluster_1/${shard}.json`);
    await page.evaluate(async url => { await import(url); }, src('main'));
    await expect(page.locator('canvas[data-game-canvas]')).toHaveAttribute('data-loaded', 'true', { timeout: 120_000 });
    const ids: string[] = await page.evaluate(async url => {
      const { PREFAB_DEFINITIONS } = await import(url);
      return [...new Set(Object.values(PREFAB_DEFINITIONS).flatMap((definition: any) => definition.debugSpawnIds as string[]))];
    }, src('prefabDefinitions'));
    for (const id of ids) {
      await page.evaluate(command => document.querySelector('dst-debug-console')!.dispatchEvent(
        new CustomEvent('game:debug-command', { detail: { command } })), `c_spawn("${id}")`);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(5000);
    const result = await page.evaluate(async urls => {
      const { scene } = await import(urls.universal);
      const { activePrefabs } = await import(urls.active);
      const { mouseTargets } = await import(urls.mouse);
      const roots = new Map<any, string[]>();
      const note = (model: any, source: string) => { if (!roots.has(model)) roots.set(model, []); roots.get(model)!.push(source); };
      scene.traverse((object: any) => { if (object.userData.actionEntity?.model === object) note(object, 'scene'); });
      for (const entity of activePrefabs) note(entity.model, 'activePrefabs');
      for (const entity of mouseTargets) note(entity.model, 'mouseTargets');
      const missing = new Map<string, { count: number; sources: Set<string>; hasItemEntity: boolean; tagsOwner: string }>();
      let total = 0;
      for (const [model, sources] of roots) {
        total++;
        if ((window as any).__prefabInstance(model)) continue;
        const entity = model.userData.actionEntity;
        const prefab = entity?.prefab ?? model.userData.itemId ?? model.name;
        const entry = missing.get(prefab) ?? { count: 0, sources: new Set(), hasItemEntity: false, tagsOwner: '' };
        entry.count++; for (const s of sources) entry.sources.add(s);
        entry.hasItemEntity ||= !!model.userData.itemEntity || !!model.userData.entity;
        entry.tagsOwner = Array.isArray(model.userData.tags) ? 'userData.tags' : 'none';
        missing.set(prefab, entry);
      }
      return { total, missing: [...missing].map(([prefab, e]) => ({ prefab, count: e.count, sources: [...e.sources].join('+'), hasItemEntity: e.hasItemEntity, tags: e.tagsOwner }))
        .sort((a, b) => a.prefab.localeCompare(b.prefab)) };
    }, { universal: src('universal'), active: pkg('prefab/src/activePrefabs.ts'), mouse: pkg('prefab/src/mouseTargets.ts') });
    writeFileSync(`/tmp/claude-1000/-home-alex-projects-dontstarve-web/317f327d-74aa-40c6-a294-b691531cccba/scratchpad/instance-audit-${shard}.json`,
      JSON.stringify({ spawned: ids.length, errors, ...result }, null, 2));
  });
}
