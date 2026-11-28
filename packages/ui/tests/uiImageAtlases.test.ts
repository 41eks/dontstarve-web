import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { registerUiImageAtlases } from '../src/image-atlases';
import { disposeAtlasImages, getAtlasImage } from '../../animation/src/atlasImage';
import { atlasElementBounds, parseImageAtlasArchive } from '../../animation/src/imageAtlasParser';

afterEach(() => {
  disposeAtlasImages();
  vi.unstubAllGlobals();
});

it('loads a single PNG through the inventory alias and explicit page using the source UV bounds', async () => {
  const manifest = await readFile(new URL('../../../public/dst/data/ui/atlases/manifest.json', import.meta.url));
  const bytes = await readFile(new URL('../../../public/dst/data/databundles/images.zip', import.meta.url));
  const alias = 'images/inventoryimages.xml';
  const page = parseImageAtlasArchive(bytes, alias).pages[0];
  const element = page.elements.values().next().value!;
  const fetch = vi.fn(async () => new Response(manifest));
  const decode = vi.fn();
  vi.stubGlobal('document', { baseURI: 'https://example.test/game/' });
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      async decode() {
        decode(this.src);
      }
    },
  );
  registerUiImageAtlases([alias, page.path], './dst/data/ui/atlases/');
  expect(fetch).not.toHaveBeenCalled();
  const [fromAlias, fromPage] = await Promise.all([
    getAtlasImage(alias, element.name),
    getAtlasImage(page.path, element.name),
  ]);
  const imageUrl = 'https://example.test/game/dst/data/ui/atlases/inventoryimages1.png';
  expect(fromAlias).toEqual({
    ...atlasElementBounds(page, element),
    imageUrl,
    atlasWidth: page.width,
    atlasHeight: page.height,
  });
  expect(fromPage).toEqual(fromAlias);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(new URL('manifest.json', imageUrl));
  expect(decode).toHaveBeenCalledExactlyOnceWith(imageUrl);
});
