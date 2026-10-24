import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'vite';
import { assetCachePlugin } from '../scripts/asset-cache-plugin.mjs';

test('production worker version is stable and changes when public asset bytes change', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dontstarve-cache-'));
  try {
    for (const directory of ['dst/data', 'hamlet-assets', 'generating-world', 'creepy-hands', 'audio']) {
      await mkdir(join(root, 'public', directory), { recursive: true });
    }
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Cache build</title>');
    const asset = join(root, 'public/dst/data/torch.zip');
    await writeFile(asset, 'first');

    async function buildWorker() {
      const result = await build({
        root, configFile: false, logLevel: 'silent', base: '/preview/',
        plugins: [assetCachePlugin()],
        build: { write: false },
      });
      return result.output.find(file => file.fileName === 'sw.js').source;
    }

    const first = await buildWorker();
    assert.equal(await buildWorker(), first);
    assert.doesNotMatch(first, /__ASSET_CACHE_/);
    assert.match(first, /\b[0-9a-f]{64}\b/);

    await writeFile(asset, 'other');
    assert.notEqual(await buildWorker(), first);
    assert.equal(await readFile(asset, 'utf8'), 'other');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
