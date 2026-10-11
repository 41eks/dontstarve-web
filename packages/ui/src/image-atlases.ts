import { loadImageAtlas } from '@dontstarve-web/animation/imageAtlas';
import { registerImageAtlases } from '@dontstarve-web/animation/atlasImage';
import { categories } from './categories';
import { INVENTORY_SKIN_SPECS } from './categories/shared';
import { INVENTORY_ITEM_DISPLAY_SPECS } from './inventory-items';

/** One archive for the entire UI; register metadata in a batch without eagerly decoding it. */
export function initializeUiImageAtlases(): void {
  const baseUrl = (import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL;
  const archive = new URL(`${baseUrl}dst/data/databundles/images.zip`, document.baseURI).href;
  const paths = new Set([
    'images/crafting_menu.xml', 'images/crafting_menu_icons.xml',
    'images/hud.xml', 'images/hud2.xml', 'images/textboxes.xml',
    'images/inventoryimages.xml',
  ]);
  for (const category of categories) {
    if ('iconAtlas' in category && category.iconAtlas) paths.add(category.iconAtlas);
    for (const recipe of category.recipes) {
      if (recipe.inventoryAtlas) paths.add(recipe.inventoryAtlas);
      for (const item of [...recipe.ingredients, ...recipe.skins]) {
        if (item.inventoryAtlas) paths.add(item.inventoryAtlas);
      }
    }
  }
  for (const item of [...Object.values(INVENTORY_ITEM_DISPLAY_SPECS), ...Object.values(INVENTORY_SKIN_SPECS)]) {
    if (item.atlas) paths.add(item.atlas);
  }
  registerImageAtlases(Object.fromEntries([...paths].map((path) => [path, () => loadImageAtlas(archive, path)])));
}
