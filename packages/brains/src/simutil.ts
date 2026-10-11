import type { BrainWorld, Vec3 } from './types';

export const DEGREES = Math.PI / 180;
export const RADIANS = 180 / Math.PI;
export const PI2 = Math.PI * 2;

export interface FanResult { offset: Vec3; angle: number; deflected: boolean }

/** simutil.lua FindValidPositionByFan: candidate angles fan out from the start angle (radians). */
export function FindValidPositionByFan(startAngle: number, radius: number, attempts: number | undefined,
  test: (offset: Vec3) => boolean): FanResult | undefined {
  attempts ??= 8;
  const attemptAngle = PI2 / attempts;
  const tmp: number[] = [];
  for (let i = 0; i < attempts; i++) {
    const a = i * attemptAngle;
    tmp.push(a > Math.PI ? a - PI2 : a);
  }
  const angles: number[] = [];
  const iend = Math.floor(attempts / 2);
  for (let i = 1; i <= iend; i++) {
    angles.push(tmp[i - 1]);
    angles.push(tmp[attempts - i]);
  }
  if (iend * 2 < attempts) angles.push(tmp[iend]);
  for (const [index, deflection] of angles.entries()) {
    let angle = startAngle + deflection;
    if (angle > PI2) angle -= PI2;
    const offset = { x: radius * Math.cos(angle), y: 0, z: -radius * Math.sin(angle) };
    if (test(offset)) return { offset, angle, deflected: index > 0 };
  }
  return undefined;
}

/**
 * simutil.lua FindWalkableOffset. Only the map's ground test is available; line-of-sight against
 * walls (check_los) and teleport permission are not modelled.
 */
export function FindWalkableOffset(world: BrainWorld, position: Vec3, startAngle: number, radius: number,
  attempts?: number, customCheck?: (point: Vec3) => boolean): FanResult | undefined {
  return FindValidPositionByFan(startAngle, radius, attempts, offset => {
    const point = { x: position.x + offset.x, y: position.y + offset.y, z: position.z + offset.z };
    return world.isAboveGroundAtPoint(point.x, point.y, point.z) && (customCheck === undefined || customCheck(point));
  });
}

export const distsq = (a: Vec3, b: Vec3) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
export const FunctionOrValue = <T, A extends unknown[]>(value: T | ((...args: A) => T), ...args: A): T =>
  typeof value === 'function' ? (value as (...args: A) => T)(...args) : value;
