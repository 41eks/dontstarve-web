import type { EntityQuery, PrefabInstance } from './prefabInstance';
import { WORLD_SCALE } from './tile';
import type { TurfMap } from './turfMap';
import type { ReadonlyVector3 } from './transform';

/** DEPLOYSPACING_RADIUS[DEPLOYSPACING.LARGE]. */
const DEPLOYSPACING_LARGE = 4 * WORLD_SCALE;

/** map.lua DEPLOY_IGNORE_TAGS. */
export const DEPLOY_IGNORE_TAGS: readonly string[] = [
  'NOBLOCK',
  'player',
  'FX',
  'INLIMBO',
  'DECOR',
  'walkableplatform',
  'walkableperipheral',
  'isdead',
];
const BLOCKED_ONEOF_TAGS = ['groundtargetblocker', 'groundhole'];

/**
 * TheWorld.Map's entity lookups: TheSim:FindEntities and Map:GetEntitiesOnTileAtPoint, both answered by the world's
 * PrefabEntityManager from the one spatial index its entities' transforms keep current.
 */
export interface MapEntities extends EntityQuery {
  GetEntitiesOnTileAtPoint(position: ReadonlyVector3): PrefabInstance[];
}

// map.lua's file locals: the largest registered spacing widens every placement query, as in the source.
let DEPLOY_EXTRA_SPACING = 0;
let MAX_GROUND_TARGET_BLOCKER_RADIUS = 0;

/** Map:RegisterDeploySmartRadius, from EntityScript:SetDeploySmartRadius; world units. */
export function RegisterDeploySmartRadius(radius: number): void {
  DEPLOY_EXTRA_SPACING = Math.max(radius + DEPLOYSPACING_LARGE / 2, DEPLOY_EXTRA_SPACING);
}

/** Map:RegisterGroundTargetBlocker, from EntityScript:SetGroundTargetBlockerRadius; world units. */
export function RegisterGroundTargetBlocker(radius: number): void {
  MAX_GROUND_TARGET_BLOCKER_RADIUS = Math.max(radius, MAX_GROUND_TARGET_BLOCKER_RADIUS);
}

/** Map:IsGroundTargetBlocked: only groundtargetblocker/groundhole entities block a ground target such as BLINK. */
export function IsGroundTargetBlocked(ents: EntityQuery, pt: ReadonlyVector3, range = 0.5 * WORLD_SCALE): boolean {
  const radius = Math.max(DEPLOY_EXTRA_SPACING, MAX_GROUND_TARGET_BLOCKER_RADIUS) + range;
  for (const blocker of ents.FindEntities(pt, radius, [], [], BLOCKED_ONEOF_TAGS)) {
    const reach =
      (blocker.ground_target_blocker_radius ?? blocker._groundhole_outerradius ?? blocker.getPhysicsRadius(0)) +
      (blocker._groundhole_rangeoverride ?? range);
    const distsq = blocker.getPosition().distanceToSquared(pt);
    if (distsq < reach * reach) {
      const inner = blocker._groundhole_innerradius;
      return inner === undefined || distsq >= inner * inner;
    }
  }
  return false;
}

/** Map:CanDeployRecipeAtPoint for the ported land recipes. Recipe min_spacing is in DST units. */
export function CanDeployRecipeAtPoint(
  ents: EntityQuery,
  turf: Pick<TurfMap, 'isPassableAtPoint'>,
  point: ReadonlyVector3,
  minSpacing = 3.2,
): boolean {
  return turf.isPassableAtPoint(point) && IsDeployPointClear(ents, point, undefined, minSpacing * WORLD_SCALE);
}

export type NearOther = (other: PrefabInstance, pt: ReadonlyVector3, minSpacing: number) => boolean;

/** map.lua IsNearOther with deploy_smart_radius and an inventoryitem's physics radius. */
export const IsNearOther: NearOther = (other, pt, minSpacing) => {
  let spacing = minSpacing;
  if (other.deploySmartRadius !== undefined) {
    spacing = other.deploySmartRadius + minSpacing / 2;
  } else if ((other.components as { inventoryitem?: unknown }).inventoryitem) {
    spacing = Math.min(other.getPhysicsRadius(0.5 * WORLD_SCALE) + minSpacing / 2, minSpacing);
  }
  return other.getPosition().distanceToSquared(pt) < spacing * spacing;
};

/**
 * Map:IsDeployPointClear(pt, inst, min_spacing, nil, near_other_fn, nil, custom_ignore_tags): nothing visible, not a
 * placer and not parented (unless a childdeployblocker) is near the point, apart from the inst being deployed.
 */
export function IsDeployPointClear(
  ents: EntityQuery,
  pt: ReadonlyVector3,
  inst: object | undefined,
  minSpacing: number,
  nearOther: NearOther = IsNearOther,
  ignoreTags: readonly string[] = DEPLOY_IGNORE_TAGS,
): boolean {
  for (const v of ents.FindEntities(pt, Math.max(DEPLOY_EXTRA_SPACING, minSpacing), [], ignoreTags)) {
    if (
      v !== inst &&
      v.IsVisible() &&
      !v.hasTag('placer') &&
      (v.entityParent === undefined || v.hasTag('childdeployblocker')) &&
      nearOther(v, pt, minSpacing)
    ) {
      return false;
    }
  }
  return true;
}
