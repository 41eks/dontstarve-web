import armour from './armour';
import containers from './containers';
import cooking from './cooking';
import cosmetic from './cosmetic';
import craftingStation from './crafting-station';
import character from './character';
import favorites from './favorites';
import fire from './fire';
import fishing from './fishing';
import gardening from './gardening';
import health from './health';
import none from './none';
import rain from './rain';
import refine from './refine';
import riding from './riding';
import sailing from './sailing';
import science from './science';
import skull from './skull';
import specialEvent from './special-event';
import structure from './structure';
import summer from './summer';
import tool from './tool';
import warable from './warable';
import weapon from './weapon';
import winter from './winter';

export type { CategoryConfig, Recipe, RecipeIngredient } from './types';

export const categories = [
  favorites, craftingStation, specialEvent, character,
  tool, fire, science, refine, weapon, armour, warable, health, skull, cosmetic,
  structure, containers, cooking, gardening, fishing, sailing, riding, winter, summer, rain, none,
] as const;
