/** constants.lua FACING_* as animation `facing` bits (1 << FACING). */
export const FACING = {
  RIGHT: 1 << 0, UP: 1 << 1, LEFT: 1 << 2, DOWN: 1 << 3,
  UPRIGHT: 1 << 4, UPLEFT: 1 << 5, DOWNRIGHT: 1 << 6, DOWNLEFT: 1 << 7,
} as const;
/** Animations authored for RIGHT/UP/LEFT/DOWN, e.g. the front art of `wall.zip`. */
export const FACING_CARDINAL = FACING.RIGHT | FACING.UP | FACING.LEFT | FACING.DOWN;
/** Facings drawn mirrored from their right-hand counterpart when an animation lists both. */
const LEFT_TO_RIGHT: ReadonlyMap<number, number> = new Map([
  [FACING.LEFT, FACING.RIGHT], [FACING.UPLEFT, FACING.UPRIGHT], [FACING.DOWNLEFT, FACING.DOWNRIGHT],
]);

// Steps of a = rotation + camera heading in 45-degree sectors. A rotation-0 inst looks along +x and an inst with
// rotation R looks along (cos R, -sin R); with followcamera.lua's right vector (-sin h, cos h) and screen-up
// (-cos h, -sin h) its screen direction is (-sin a, -cos a): a = 0 faces the camera (DOWN), a = 90 faces LEFT.
const FACING_BY_STEP = [FACING.DOWN, FACING.DOWNLEFT, FACING.LEFT, FACING.UPLEFT,
  FACING.UP, FACING.UPRIGHT, FACING.RIGHT, FACING.DOWNRIGHT];

/**
 * The eight-faced facing of an inst with `rotation` seen from a camera at `heading` (both degrees), as
 * Transform:SetEightFaced does with rotation + TheCamera:GetHeading().
 */
export function facingFromRotation(rotation: number, heading: number): number {
  const steps = Math.round((rotation + heading) / 45);
  return FACING_BY_STEP[((steps % 8) + 8) % 8];
}

/** The facing an inst with rotation 0 shows to a camera at `heading`, e.g. walls. */
export function facingFromHeading(heading: number): number {
  return facingFromRotation(0, heading);
}

/**
 * Whether `facing` is drawn from a clip authored with `mask`. A clip listing a right-hand facing together with its
 * left-hand mirror (e.g. `fence.zip` idle 5 = RIGHT | LEFT) is authored right-handed and flipped horizontally
 * for the left-hand one.
 */
export function selectsFacing(mask: number, facing: number): { matches: boolean; flipped: boolean } {
  if ((mask & facing) === 0) return { matches: false, flipped: false };
  const right = LEFT_TO_RIGHT.get(facing);
  return { matches: true, flipped: right !== undefined && (mask & right) !== 0 };
}

const FOUR_FACING_BY_STEP = [FACING.DOWN, FACING.LEFT, FACING.UP, FACING.RIGHT];
/** Transform:SetFourFaced: rotation + camera heading snapped to the nearest cardinal facing. */
export function fourFacingFromRotation(rotation: number, heading: number): number {
  const steps = Math.round((rotation + heading) / 90);
  return FOUR_FACING_BY_STEP[((steps % 4) + 4) % 4];
}
