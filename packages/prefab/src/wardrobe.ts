import definitions from './definitions.json' with { type: 'json' };
import type { AnimatedBuildingDefinition } from './animatedBuildingPlacement';

export const WARDROBE_ID = 'wardrobe' as const;

// wardrobe.lua: bank/build wardrobe, initially closed. Appearance only.
export const WARDROBE_DEFINITION: AnimatedBuildingDefinition = definitions.animatedBuildings.wardrobe;
