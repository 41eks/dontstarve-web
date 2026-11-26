import type { ImageAtlasElement } from '@dontstarve-web/animation/imageAtlas';
import { registerImageAtlases, type StaticAtlasImagePage } from '@dontstarve-web/animation/atlasImage';
import { categories } from './categories';
import { INVENTORY_SKIN_SPECS } from './categories/shared';
import { UI_IMAGE_ATLAS_PATHS } from './image-atlas-paths';
import { INVENTORY_ITEM_DISPLAY_SPECS } from './inventory-items';

interface AtlasManifest {
  atlases: Record<string, readonly string[]>;
  pages: Record<string, { name: string; width: number; height: number; elements: readonly ImageAtlasElement[] }>;
}

const manifests = new Map<
  string,
  Promise<{ atlases: AtlasManifest['atlases']; pages: Map<string, StaticAtlasImagePage> }>
>();

function loadAtlasManifest(base: URL) {
  let loaded = manifests.get(base.href);
  if (!loaded) {
    const url = new URL('manifest.json', base);
    loaded = (async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Unable to load UI atlas manifest ${url}: HTTP ${response.status}`);
      }
      const { atlases, pages } = (await response.json()) as AtlasManifest;
      return {
        atlases,
        pages: new Map(
          Object.entries(pages).map(([key, { name, width, height, elements }]) => [
            key,
            {
              imageUrl: new URL(name, base).href,
              width,
              height,
              elements: new Map(elements.map(element => [element.name.toLowerCase(), element])),
            },
          ]),
        ),
      };
    })();
    manifests.set(base.href, loaded);
    void loaded.catch(() => manifests.delete(base.href));
  }
  return loaded;
}

/** Register first; the manifest and requested PNG pages are fetched lazily. */
export function registerUiImageAtlases(paths: Iterable<string>, atlasBase: string): void {
  const base = new URL(atlasBase, document.baseURI);
  registerImageAtlases(
    Object.fromEntries(
      [...paths].map(path => [
        path,
        async () => {
          const { atlases, pages } = await loadAtlasManifest(base);
          const members = atlases[path.toLowerCase()];
          if (!members) {
            throw new Error(`No generated UI atlas for ${path}`);
          }
          return {
            pages: members.map(key => {
              const page = pages.get(key);
              if (!page) {
                throw new Error(`No generated UI atlas page for ${key}`);
              }
              return page;
            }),
          };
        },
      ]),
    ),
  );
}

export function initializeUiImageAtlases(): void {
  const paths = new Set<string>(UI_IMAGE_ATLAS_PATHS);
  for (const category of categories) {
    if ('iconAtlas' in category && category.iconAtlas) {
      paths.add(category.iconAtlas);
    }
    for (const recipe of category.recipes) {
      if (recipe.inventoryAtlas) {
        paths.add(recipe.inventoryAtlas);
      }
      for (const item of [...recipe.ingredients, ...recipe.skins]) {
        if (item.inventoryAtlas) {
          paths.add(item.inventoryAtlas);
        }
      }
    }
  }
  for (const item of [...Object.values(INVENTORY_ITEM_DISPLAY_SPECS), ...Object.values(INVENTORY_SKIN_SPECS)]) {
    if (item.atlas) {
      paths.add(item.atlas);
    }
  }
  registerUiImageAtlases(paths, `${import.meta.env.BASE_URL}dst/data/ui/atlases/`);
}
