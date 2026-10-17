import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const assetDirectories = ['dst/data/', 'hamlet-assets/', 'generating-world/', 'creepy-hands/', 'audio/'];
const workerTemplate = new URL('./asset-service-worker.js', import.meta.url);

export function assetCachePlugin() {
  let publicDir;

  return {
    name: 'vite-plugin-asset-cache',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    async generateBundle() {
      const template = await readFile(workerTemplate, 'utf8');
      const hash = createHash('sha256').update(template).update(JSON.stringify(assetDirectories));

      async function hashDirectory(relativePath) {
        const entries = await readdir(join(publicDir, relativePath), { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
        for (const entry of entries) {
          const path = `${relativePath}${entry.name}`;
          if (entry.isDirectory()) {
            await hashDirectory(`${path}/`);
          } else if (entry.isFile()) {
            // Hash each file separately so path/content boundaries are unambiguous.
            const contentHash = createHash('sha256').update(await readFile(join(publicDir, path))).digest('hex');
            hash.update(JSON.stringify([path, contentHash]));
          }
        }
      }

      for (const directory of assetDirectories) await hashDirectory(directory);

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace('__ASSET_CACHE_VERSION__', hash.digest('hex'))
          .replace('__ASSET_CACHE_DIRECTORIES__', JSON.stringify(assetDirectories)),
      });
    },
  };
}
