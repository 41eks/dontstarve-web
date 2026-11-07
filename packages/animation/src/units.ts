/**
 * World units shared by sprites, physics and distances. Each value is derived from the source game's own ratios, so the
 * art, the bodies and every distance keep DST's proportions whatever size the project gives a tile.
 */

/** constants.lua TILE_SCALE: a terrain tile is 4 DST units wide. */
export const DST_TILE_SCALE = 4;

/** 一块地皮的边长（项目单位）。 */
export const TILE_SIZE = 12;

/** Project world units per DST unit. */
export const WORLD_SCALE = TILE_SIZE / DST_TILE_SCALE;

/**
 * Animation pixels per DST unit: consolecommands.lua c_showradius ("300: Game Unit to Pixel conversion" over the
 * 1900-pixel firefighter ring, i.e. 1900 px across a 1900 / 300 unit radius).
 */
export const ANIM_PIXELS_PER_UNIT = 150;

/** Project world units per animation pixel: the default scale of every sprite. */
export const SPRITE_SCALE = WORLD_SCALE / ANIM_PIXELS_PER_UNIT;
