import definitions from './definitions.json' with { type: 'json' };
import type { AnimatedBuildingDefinition } from './animatedBuildingPlacement';

export const MOONBASE_ID = 'moonbase' as const;

// moonbase.lua spawns the damaged stone with bank/build moonbase and animation med.
export const MOONBASE_DEFINITION: AnimatedBuildingDefinition = definitions.animatedBuildings.moonbase;
