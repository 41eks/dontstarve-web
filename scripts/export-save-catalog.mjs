// Prints the item and skin catalog that save validation uses, for Python importers.
import { createServer } from 'vite';

const server = await createServer({
  root: new URL('..', import.meta.url).pathname, logLevel: 'error', appType: 'custom',
  server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true },
});
try {
  const { SAVE_CATALOG } = await server.ssrLoadModule('/src/save/catalog.ts');
  const fields = ['maxStack', 'maxUses', 'useStep', 'maxFuel', 'perishTime', 'equippable', 'canGoInContainer'];
  const items = Object.fromEntries(Object.entries(SAVE_CATALOG.items).map(([itemId, spec]) =>
    [itemId, Object.fromEntries(fields.filter(field => spec[field] !== undefined).map(field => [field, spec[field]]))]));
  const skins = Object.fromEntries(Object.entries(SAVE_CATALOG.skins).map(([skinId, skin]) => [skinId, skin.itemId ?? null]));
  process.stdout.write(JSON.stringify({ items, skins }));
} finally {
  await server.close();
}
