import definitions from '@dontstarve-web/prefab/definitions.json' with { type: 'json' };
import { INVENTORY_RECIPES, INVENTORY_RECIPE_SKINS } from '@dontstarve-web/ui';
import { INVENTORY_ITEM_SPECS, INVENTORY_SKIN_SPECS } from '../inventoryItems';
import type { SaveCatalog } from './deserialize';

export const SAVE_CATALOG: SaveCatalog = {
  items: INVENTORY_ITEM_SPECS,
  skins: INVENTORY_SKIN_SPECS,
  recipes: INVENTORY_RECIPES,
  recipeSkins: INVENTORY_RECIPE_SKINS,
  buildings: definitions.animatedBuildings,
  walls: Object.keys(definitions.walls),
};
