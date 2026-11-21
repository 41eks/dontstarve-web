// constants.lua
const RESOLUTION_X = 1280;
const RESOLUTION_Y = 720;
const MAX_HUD_SCALE = 1.25;

/** A SCALEMODE_PROPORTIONAL root with SetMaxPropUpscale(MAX_HUD_SCALE): UI units to CSS pixels for a screen size. */
export function proportionalHudScale(width: number, height: number): number {
  return Math.min(width / RESOLUTION_X, height / RESOLUTION_Y, MAX_HUD_SCALE);
}
