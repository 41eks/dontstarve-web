/** Cooking predicates and presentation metadata from scripts/preparedfoods.lua.
 * Eating, perish and inventory callbacks remain owned by their gameplay prefabs.
 */
export type IngredientNames = Readonly<Record<string, number | undefined>>;
export type IngredientTags = Record<string, number | undefined>;

export interface PreparedFoodRecipe {
  readonly name: string;
  readonly test: (cooker: string, names: IngredientNames, tags: Readonly<IngredientTags>) => boolean;
  readonly priority: number;
  readonly weight: number;
  /** Multiplier of TUNING.BASE_COOK_TIME, not seconds. */
  readonly cooktime: number;
  readonly cookbook_category: 'cookpot';
  readonly foodtype?: string;
  readonly secondaryfoodtype?: string;
  readonly overridebuild?: string;
  readonly overridesymbolname?: string;
  readonly potlevel?: 'low' | 'high';
  readonly tags?: readonly string[];
  readonly card_def?: { readonly ingredients: readonly (readonly [string, number])[] };
}

type PreparedFoodDefinition = Omit<PreparedFoodRecipe, 'name' | 'cookbook_category' | 'priority' | 'weight' | 'cooktime'>
  & Partial<Pick<PreparedFoodRecipe, 'priority' | 'weight' | 'cooktime'>>;

// Lua treats 0 as true. Missing name/tag entries remain undefined, not zero.
function present<T extends number | boolean | undefined>(value: T): value is Exclude<T, undefined | false> {
  return value !== undefined && value !== false;
}

const definitions = {
  butterflymuffin: {
    test: (_cooker, names, tags) =>
      (present(names.butterflywings) || present(names.moonbutterflywings))
      && !present(tags.meat)
      && present(tags.veggie)
      && (tags.veggie >= 0.5),
    priority: 1,
    weight: 1,
    cooktime: 2,
    foodtype: 'VEGGIE',
    card_def: { ingredients: [['butterflywings', 1], ['carrot', 2], ['berries', 1]] },
  },
  frogglebunwich: {
    test: (_cooker, names, tags) => (present(names.froglegs) || present(names.froglegs_cooked)) && present(tags.veggie) && (tags.veggie >= 0.5),
    priority: 1,
    cooktime: 2,
    foodtype: 'MEAT',
    potlevel: 'high',
    card_def: { ingredients: [['froglegs', 1], ['red_cap', 2], ['carrot', 1]] },
  },
  taffy: {
    test: (_cooker, _names, tags) => present(tags.sweetener) && (tags.sweetener >= 3) && !present(tags.meat),
    priority: 10,
    cooktime: 2,
    foodtype: 'GOODIES',
    tags: ['honeyed'],
    card_def: { ingredients: [['honey', 3], ['berries', 1]] },
  },
  pumpkincookie: {
    test: (_cooker, names, tags) => (present(names.pumpkin) || present(names.pumpkin_cooked)) && present(tags.sweetener) && (tags.sweetener >= 2),
    priority: 10,
    cooktime: 2,
    foodtype: 'VEGGIE',
    tags: ['honeyed'],
    card_def: { ingredients: [['pumpkin', 1], ['honey', 2], ['berries', 1]] },
  },
  stuffedeggplant: {
    test: (_cooker, names, tags) => (present(names.eggplant) || present(names.eggplant_cooked)) && present(tags.veggie) && (tags.veggie > 1),
    priority: 1,
    cooktime: 2,
    foodtype: 'VEGGIE',
    card_def: { ingredients: [['eggplant', 1], ['potato', 1], ['onion', 1], ['garlic', 1]] },
  },
  fishsticks: {
    test: (_cooker, names, tags) => present(tags.fish) && present(names.twigs) && present(tags.inedible) && (tags.inedible <= 1),
    priority: 10,
    cooktime: 2,
    foodtype: 'MEAT',
    potlevel: 'high',
    tags: ['catfood'],
    card_def: { ingredients: [['fishmeat_small', 3], ['twigs', 1]] },
  },
  honeynuggets: {
    test: (_cooker, names, tags) => present(names.honey) && present(tags.meat) && (tags.meat <= 1.5) && !present(tags.inedible),
    priority: 2,
    cooktime: 2,
    foodtype: 'MEAT',
    potlevel: 'high',
    tags: ['honeyed'],
    card_def: { ingredients: [['honey', 2], ['smallmeat', 2]] },
  },
  honeyham: {
    test: (_cooker, names, tags) => present(names.honey) && present(tags.meat) && (tags.meat > 1.5) && !present(tags.inedible),
    priority: 2,
    cooktime: 2,
    foodtype: 'MEAT',
    tags: ['honeyed'],
    card_def: { ingredients: [['honey', 2], ['meat', 2]] },
  },
  dragonpie: {
    test: (_cooker, names, tags) => (present(names.dragonfruit) || present(names.dragonfruit_cooked)) && !present(tags.meat),
    priority: 1,
    cooktime: 2,
    foodtype: 'VEGGIE',
    card_def: { ingredients: [['dragonfruit', 2], ['potato', 1], ['pepper', 1]] },
  },
  kabobs: {
    test: (_cooker, names, tags) =>
      present(tags.meat)
      && present(names.twigs)
      && (!present(tags.monster) || (tags.monster <= 1))
      && present(tags.inedible)
      && (tags.inedible <= 1),
    priority: 5,
    cooktime: 2,
    foodtype: 'MEAT',
    potlevel: 'high',
    card_def: { ingredients: [['meat', 1], ['onion', 1], ['eggplant', 1], ['twigs', 1]] },
  },
  mandrakesoup: {
    test: (_cooker, names, _tags) => present(names.mandrake),
    priority: 10,
    cooktime: 3,
    foodtype: 'VEGGIE',
    potlevel: 'low',
  },
  baconeggs: {
    test: (_cooker, _names, tags) => present(tags.egg) && (tags.egg > 1) && present(tags.meat) && (tags.meat > 1) && !present(tags.veggie),
    priority: 10,
    cooktime: 2,
    foodtype: 'MEAT',
    potlevel: 'high',
  },
  meatballs: {
    test: (_cooker, _names, tags) => present(tags.meat) && !present(tags.inedible),
    priority: -1,
    cooktime: .75,
    foodtype: 'MEAT',
    potlevel: 'high',
  },
  bonestew: {
    test: (_cooker, _names, tags) => present(tags.meat) && (tags.meat >= 3) && !present(tags.inedible),
    priority: 0,
    cooktime: .75,
    foodtype: 'MEAT',
    potlevel: 'low',
  },
  perogies: {
    test: (_cooker, _names, tags) => present(tags.egg) && present(tags.meat) && present(tags.veggie) && (tags.veggie >= 0.5) && !present(tags.inedible),
    priority: 5,
    cooktime: 1,
    foodtype: 'MEAT',
    potlevel: 'high',
  },
  turkeydinner: {
    test: (_cooker, names, tags) =>
      present(names.drumstick)
      && (names.drumstick > 1)
      && present(tags.meat)
      && (tags.meat > 1)
      && (present(tags.veggie)
      && (tags.veggie >= 0.5) || present(tags.fruit)),
    priority: 10,
    cooktime: 3,
    foodtype: 'MEAT',
    potlevel: 'high',
    card_def: { ingredients: [['drumstick', 2], ['meat', 1], ['berries', 1]] },
  },
  ratatouille: {
    test: (_cooker, _names, tags) => !present(tags.meat) && present(tags.veggie) && (tags.veggie >= 0.5) && !present(tags.inedible),
    priority: 0,
    cooktime: 1,
    foodtype: 'VEGGIE',
  },
  jammypreserves: {
    test: (_cooker, _names, tags) => present(tags.fruit) && !present(tags.meat) && !present(tags.veggie) && !present(tags.inedible),
    priority: 0,
    cooktime: .5,
    foodtype: 'VEGGIE',
  },
  fruitmedley: {
    test: (_cooker, _names, tags) => present(tags.fruit) && (tags.fruit >= 3) && !present(tags.meat) && !present(tags.veggie),
    priority: 0,
    cooktime: .5,
    foodtype: 'VEGGIE',
    potlevel: 'low',
  },
  fishtacos: {
    test: (_cooker, names, tags) =>
      present(tags.fish)
      && (present(names.corn) || present(names.corn_cooked) || present(names.oceanfish_small_5_inv) || present(names.oceanfish_medium_5_inv)),
    priority: 10,
    cooktime: .5,
    foodtype: 'MEAT',
    potlevel: 'high',
    card_def: { ingredients: [['fishmeat_small', 2], ['corn', 1], ['onion', 1]] },
  },
  waffles: {
    test: (_cooker, names, tags) =>
      present(names.butter)
      && (present(names.berries) || present(names.berries_cooked) || present(names.berries_juicy) || present(names.berries_juicy_cooked))
      && present(tags.egg),
    priority: 10,
    cooktime: .5,
    foodtype: 'VEGGIE',
    potlevel: 'high',
  },
  monsterlasagna: {
    test: (_cooker, _names, tags) => present(tags.monster) && (tags.monster >= 2) && !present(tags.inedible),
    priority: 10,
    cooktime: .5,
    foodtype: 'MEAT',
    secondaryfoodtype: 'MONSTER',
    tags: ['monstermeat'],
  },
  powcake: {
    test: (_cooker, names, _tags) =>
      present(names.twigs)
      && present(names.honey)
      && (present(names.corn) || present(names.corn_cooked) || present(names.oceanfish_small_5_inv) || present(names.oceanfish_medium_5_inv)),
    priority: 10,
    cooktime: 0.5,
    foodtype: 'VEGGIE',
    potlevel: 'low',
    tags: ['honeyed', 'donotautopick'],
    card_def: { ingredients: [['honey', 1], ['corn', 1], ['twigs', 2]] },
  },
  unagi: {
    test: (_cooker, names, _tags) =>
      (present(names.cutlichen) || present(names.kelp) || present(names.kelp_cooked) || present(names.kelp_dried))
      && (present(names.eel) || present(names.eel_cooked) || present(names.pondeel)),
    priority: 20,
    cooktime: 0.5,
    foodtype: 'MEAT',
  },
  wetgoop: {
    test: (_cooker, _names, _tags) => true,
    priority: -10,
    cooktime: .25,
  },
  flowersalad: {
    test: (_cooker, names, tags) =>
      present(names.cactus_flower)
      && present(tags.veggie)
      && (tags.veggie >= 2)
      && !present(tags.meat)
      && !present(tags.inedible)
      && !present(tags.egg)
      && !present(tags.sweetener)
      && !present(tags.fruit),
    priority: 10,
    cooktime: .5,
    foodtype: 'VEGGIE',
    potlevel: 'low',
  },
  icecream: {
    test: (_cooker, _names, tags) =>
      present(tags.frozen)
      && present(tags.dairy)
      && present(tags.sweetener)
      && !present(tags.meat)
      && !present(tags.veggie)
      && !present(tags.inedible)
      && !present(tags.egg),
    priority: 10,
    cooktime: .5,
    foodtype: 'GOODIES',
    potlevel: 'low',
  },
  watermelonicle: {
    test: (_cooker, names, tags) =>
      present(names.watermelon)
      && present(tags.frozen)
      && present(names.twigs)
      && !present(tags.meat)
      && !present(tags.veggie)
      && !present(tags.egg),
    priority: 10,
    cooktime: .5,
    foodtype: 'VEGGIE',
    potlevel: 'low',
  },
  trailmix: {
    test: (_cooker, names, tags) =>
      (present(names.acorn) || present(names.acorn_cooked))
      && present(tags.seed)
      && (tags.seed >= 1)
      && (present(names.berries) || present(names.berries_cooked) || present(names.berries_juicy) || present(names.berries_juicy_cooked))
      && present(tags.fruit)
      && (tags.fruit >= 1)
      && !present(tags.meat)
      && !present(tags.veggie)
      && !present(tags.egg)
      && !present(tags.dairy),
    priority: 10,
    cooktime: .5,
    foodtype: 'VEGGIE',
    card_def: { ingredients: [['acorn_cooked', 2], ['berries', 2]] },
  },
  hotchili: {
    test: (_cooker, _names, tags) => present(tags.meat) && present(tags.veggie) && (tags.meat >= 1.5) && (tags.veggie >= 1.5),
    priority: 10,
    cooktime: .5,
    foodtype: 'MEAT',
    potlevel: 'low',
    card_def: { ingredients: [['meat', 2], ['tomato', 1], ['pepper', 1]] },
  },
  guacamole: {
    test: (_cooker, names, tags) => present(names.mole) && (present(names.rock_avocado_fruit_ripe) || present(names.cactus_meat)) && !present(tags.fruit),
    priority: 10,
    cooktime: .5,
    foodtype: 'MEAT',
    potlevel: 'low',
    card_def: { ingredients: [['mole', 1], ['rock_avocado_fruit_ripe', 2], ['corn', 1]] },
  },
  jellybean: {
    test: (_cooker, names, tags) => present(names.royal_jelly) && !present(tags.inedible) && !present(tags.monster),
    priority: 12,
    cooktime: 2.5,
    foodtype: 'GOODIES',
    potlevel: 'low',
    tags: ['honeyed'],
  },
  potatotornado: {
    test: (_cooker, names, tags) =>
      (present(names.potato) || present(names.potato_cooked))
      && present(names.twigs)
      && (!present(tags.monster) || (tags.monster <= 1))
      && !present(tags.meat)
      && present(tags.inedible)
      && (tags.inedible <= 2),
    priority: 10,
    cooktime: .75,
    foodtype: 'VEGGIE',
  },
  mashedpotatoes: {
    test: (_cooker, names, tags) =>
      (present(names.potato)
      && (names.potato > 1) || present(names.potato_cooked)
      && (names.potato_cooked > 1) || present(names.potato)
      && present(names.potato_cooked))
      && (present(names.garlic) || present(names.garlic_cooked))
      && !present(tags.meat)
      && !present(tags.inedible),
    priority: 20,
    cooktime: 1,
    foodtype: 'VEGGIE',
    potlevel: 'low',
  },
  asparagussoup: {
    test: (_cooker, names, tags) =>
      (present(names.asparagus) || present(names.asparagus_cooked))
      && present(tags.veggie)
      && (tags.veggie > 2)
      && !present(tags.meat)
      && !present(tags.inedible),
    priority: 10,
    cooktime: 0.5,
    foodtype: 'VEGGIE',
    potlevel: 'low',
    card_def: { ingredients: [['asparagus', 2], ['potato', 1], ['onion', 1]] },
  },
  vegstinger: {
    test: (_cooker, names, tags) =>
      (present(names.asparagus) || present(names.asparagus_cooked) || present(names.tomato) || present(names.tomato_cooked))
      && present(tags.veggie)
      && (tags.veggie > 2)
      && present(tags.frozen)
      && !present(tags.meat)
      && !present(tags.inedible)
      && !present(tags.egg),
    priority: 15,
    cooktime: 0.5,
    foodtype: 'VEGGIE',
    potlevel: 'low',
    tags: ['fooddrink'],
  },
  bananapop: {
    test: (_cooker, names, tags) =>
      (present(names.cave_banana) || present(names.cave_banana_cooked))
      && present(tags.frozen)
      && present(names.twigs)
      && !present(tags.meat)
      && !present(tags.fish),
    priority: 20,
    cooktime: 0.5,
    foodtype: 'VEGGIE',
    potlevel: 'low',
    card_def: { ingredients: [['cave_banana', 1], ['ice', 2], ['twigs', 1]] },
  },
  frozenbananadaiquiri: {
    test: (_cooker, names, tags) =>
      (present(names.cave_banana) || present(names.cave_banana_cooked))
      && present(tags.frozen)
      && (tags.frozen >= 1)
      && !present(tags.meat)
      && !present(tags.fish),
    priority: 2,
    cooktime: 1,
    foodtype: 'GOODIES',
    overridebuild: 'cook_pot_food9',
    tags: ['fooddrink'],
  },
  bananajuice: {
    test: (_cooker, names, tags) =>
      (((names.cave_banana ?? 0) + (names.cave_banana_cooked ?? 0)) >= 2)
      && !present(tags.meat)
      && !present(tags.fish)
      && !present(tags.monster),
    priority: 1,
    cooktime: 0.5,
    foodtype: 'VEGGIE',
    overridebuild: 'cook_pot_food10',
    tags: ['fooddrink'],
  },
  ceviche: {
    test: (_cooker, _names, tags) => present(tags.fish) && (tags.fish >= 2) && present(tags.frozen) && !present(tags.inedible) && !present(tags.egg),
    priority: 20,
    cooktime: 0.5,
    foodtype: 'MEAT',
  },
  salsa: {
    test: (_cooker, names, tags) =>
      (present(names.tomato) || present(names.tomato_cooked))
      && (present(names.onion) || present(names.onion_cooked))
      && !present(tags.meat)
      && !present(tags.inedible)
      && !present(tags.egg),
    priority: 20,
    cooktime: 0.5,
    foodtype: 'VEGGIE',
    potlevel: 'low',
  },
  pepperpopper: {
    test: (_cooker, names, tags) =>
      (present(names.pepper) || present(names.pepper_cooked))
      && present(tags.meat)
      && (tags.meat <= 1.5)
      && !present(tags.inedible),
    priority: 20,
    cooktime: 2,
    foodtype: 'MEAT',
    card_def: { ingredients: [['pepper', 1], ['smallmeat', 2], ['potato', 1]] },
  },
  californiaroll: {
    test: (_cooker, names, tags) =>
      ((((names.kelp ?? 0) + (names.kelp_cooked ?? 0)) + (names.kelp_dried ?? 0)) === 2)
      && present(tags.fish)
      && (tags.fish >= 1),
    priority: 20,
    cooktime: .5,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food2',
    potlevel: 'high',
    card_def: { ingredients: [['kelp', 2], ['fishmeat_small', 2]] },
  },
  seafoodgumbo: {
    test: (_cooker, _names, tags) => present(tags.fish) && (tags.fish > 2),
    priority: 10,
    cooktime: 1,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food2',
  },
  surfnturf: {
    test: (_cooker, _names, tags) => present(tags.meat) && (tags.meat >= 2.5) && present(tags.fish) && (tags.fish >= 1.5) && !present(tags.frozen),
    priority: 30,
    cooktime: 1,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food2',
    potlevel: 'high',
  },
  lobsterbisque: {
    test: (_cooker, names, tags) => present(names.wobster_sheller_land) && present(tags.frozen),
    priority: 30,
    cooktime: 0.5,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food3',
    potlevel: 'high',
  },
  lobsterdinner: {
    test: (_cooker, names, tags) =>
      present(names.wobster_sheller_land)
      && present(names.butter)
      && present(tags.meat)
      && (tags.meat >= 1.0)
      && present(tags.fish)
      && (tags.fish >= 1.0)
      && !present(tags.frozen),
    priority: 25,
    cooktime: 1,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food3',
    potlevel: 'high',
  },
  barnaclepita: {
    test: (_cooker, names, tags) => (present(names.barnacle) || present(names.barnacle_cooked)) && present(tags.veggie) && (tags.veggie >= 0.5),
    priority: 25,
    cooktime: 2,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food5',
  },
  barnaclesushi: {
    test: (_cooker, names, tags) =>
      (present(names.barnacle) || present(names.barnacle_cooked))
      && (present(names.kelp) || present(names.kelp_cooked))
      && present(tags.egg)
      && (tags.egg >= 1),
    priority: 30,
    cooktime: 0.5,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food5',
    card_def: { ingredients: [['barnacle', 1], ['kelp', 2], ['bird_egg', 1]] },
  },
  barnaclinguine: {
    test: (_cooker, names, tags) => (((names.barnacle ?? 0) + (names.barnacle_cooked ?? 0)) >= 2) && present(tags.veggie) && (tags.veggie >= 2),
    priority: 30,
    cooktime: 2,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food5',
  },
  barnaclestuffedfishhead: {
    test: (_cooker, names, tags) => (present(names.barnacle) || present(names.barnacle_cooked)) && present(tags.fish) && (tags.fish >= 1.25),
    priority: 26,
    cooktime: 2,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food5',
    card_def: { ingredients: [['barnacle', 1], ['fishmeat_small', 2], ['potato', 1]] },
  },
  leafloaf: {
    test: (_cooker, names, _tags) => (((names.plantmeat ?? 0) + (names.plantmeat_cooked ?? 0)) >= 2),
    priority: 25,
    cooktime: 2,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food4',
  },
  leafymeatburger: {
    test: (_cooker, names, tags) =>
      (present(names.plantmeat) || present(names.plantmeat_cooked))
      && (present(names.onion) || present(names.onion_cooked))
      && present(tags.veggie)
      && (tags.veggie >= 2),
    priority: 26,
    cooktime: 2,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food4',
  },
  leafymeatsouffle: {
    test: (_cooker, names, tags) => (((names.plantmeat ?? 0) + (names.plantmeat_cooked ?? 0)) >= 2) && present(tags.sweetener) && (tags.sweetener >= 2),
    priority: 50,
    cooktime: 2,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food4',
  },
  meatysalad: {
    test: (_cooker, names, tags) => (present(names.plantmeat) || present(names.plantmeat_cooked)) && present(tags.veggie) && (tags.veggie >= 3),
    priority: 25,
    cooktime: 2,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food4',
    card_def: { ingredients: [['plantmeat', 1], ['tomato', 2], ['carrot', 1]] },
  },
  shroomcake: {
    test: (_cooker, names, _tags) => present(names.moon_cap) && present(names.red_cap) && present(names.blue_cap) && present(names.green_cap),
    priority: 30,
    cooktime: 1,
    foodtype: 'GOODIES',
    overridebuild: 'cook_pot_food6',
  },
  sweettea: {
    test: (_cooker, names, tags) =>
      (present(names.forgetmelots) || present(names.forgetmelots_dried))
      && present(tags.sweetener)
      && present(tags.frozen)
      && !present(tags.monster)
      && !present(tags.veggie)
      && !present(tags.meat)
      && !present(tags.fish)
      && !present(tags.egg)
      && !present(tags.fat)
      && !present(tags.dairy)
      && !present(tags.inedible),
    priority: 1,
    cooktime: 1,
    foodtype: 'VEGGIE',
    overridebuild: 'cook_pot_food7',
    potlevel: 'low',
    tags: ['honeyed', 'fooddrink'],
    card_def: { ingredients: [['forgetmelots', 1], ['honey', 1], ['ice', 2]] },
  },
  koalefig_trunk: {
    test: (_cooker, names, _tags) =>
      (present(names.trunk_summer) || present(names.trunk_cooked) || present(names.trunk_winter))
      && (present(names.fig) || present(names.fig_cooked)),
    priority: 40,
    cooktime: 2,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food8',
    potlevel: 'high',
  },
  figatoni: {
    test: (_cooker, names, tags) => (present(names.fig) || present(names.fig_cooked)) && present(tags.veggie) && (tags.veggie >= 2) && !present(tags.meat),
    priority: 30,
    cooktime: 2,
    foodtype: 'VEGGIE',
    overridebuild: 'cook_pot_food8',
    potlevel: 'high',
  },
  figkabab: {
    test: (_cooker, names, tags) =>
      (present(names.fig) || present(names.fig_cooked))
      && present(names.twigs)
      && present(tags.meat)
      && (tags.meat >= 1)
      && (!present(tags.monster) || (tags.monster <= 1)),
    priority: 30,
    cooktime: 1,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food8',
    potlevel: 'high',
    card_def: { ingredients: [['fig', 1], ['twigs', 1], ['smallmeat', 2]] },
  },
  frognewton: {
    test: (_cooker, names, _tags) => (present(names.fig) || present(names.fig_cooked)) && (present(names.froglegs) || present(names.froglegs_cooked)),
    priority: 1,
    cooktime: 1,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food8',
    potlevel: 'high',
  },
  bunnystew: {
    test: (_cooker, _names, tags) => present(tags.meat) && (tags.meat < 1) && present(tags.frozen) && (tags.frozen >= 2) && !present(tags.inedible),
    priority: 1,
    cooktime: 0.5,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food9',
    card_def: { ingredients: [['smallmeat', 1], ['ice', 2], ['tomato', 1]] },
  },
  justeggs: {
    test: (_cooker, _names, tags) => present(tags.egg) && (tags.egg >= 3),
    priority: 0,
    cooktime: 0.5,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food11',
    potlevel: 'high',
  },
  veggieomlet: {
    test: (_cooker, _names, tags) =>
      present(tags.egg)
      && (tags.egg >= 1)
      && present(tags.veggie)
      && (tags.veggie >= 1)
      && !present(tags.meat)
      && !present(tags.dairy),
    priority: 1,
    cooktime: 1,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food11',
    potlevel: 'high',
  },
  talleggs: {
    test: (_cooker, names, tags) => present(names.tallbirdegg) && present(tags.veggie) && (tags.veggie >= 1),
    priority: 10,
    cooktime: 2,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food11',
  },
  beefalofeed: {
    test: (_cooker, _names, tags) =>
      present(tags.inedible)
      && !present(tags.monster)
      && !present(tags.meat)
      && !present(tags.fish)
      && !present(tags.egg)
      && !present(tags.fat)
      && !present(tags.dairy)
      && !present(tags.magic),
    priority: -5,
    cooktime: 0.5,
    foodtype: 'ROUGHAGE',
    secondaryfoodtype: 'WOOD',
    overridebuild: 'cook_pot_food11',
    card_def: { ingredients: [['twigs', 3], ['acorn', 1]] },
  },
  beefalotreat: {
    test: (_cooker, names, tags) =>
      present(tags.inedible)
      && present(tags.seed)
      && (present(names.forgetmelots) || present(names.forgetmelots_dried))
      && !present(tags.monster)
      && !present(tags.meat)
      && !present(tags.fish)
      && !present(tags.egg)
      && !present(tags.fat)
      && !present(tags.dairy)
      && !present(tags.magic),
    priority: -4,
    cooktime: 2,
    foodtype: 'ROUGHAGE',
    overridebuild: 'cook_pot_food11',
    potlevel: 'high',
  },
  shroombait: {
    test: (_cooker, names, _tags) => ((names.moon_cap ?? 0) >= 2) && present(names.monstermeat),
    priority: 30,
    cooktime: 1,
    foodtype: 'MEAT',
    overridebuild: 'cook_pot_food11',
  },
} satisfies Record<string, PreparedFoodDefinition>;

export const foods = Object.fromEntries(Object.entries(definitions).map(([name, definition]) => [name, Object.freeze({
  ...definition, name, cookbook_category: 'cookpot' as const,
  priority: definition.priority ?? 0,
  weight: ('weight' in definition ? definition.weight : undefined) ?? 1,
  cooktime: definition.cooktime ?? 1,
})])) as { readonly [Name in keyof typeof definitions]: PreparedFoodRecipe & { readonly name: Name } };

export type PreparedFoodId = keyof typeof foods;
export default foods;
