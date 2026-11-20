import type { ReadonlyVector3 } from '../../animation/src/transformRoot';

/** TheWorld.Map as ocean_util.lua reads it. */
export interface OceanMap {
  /** Map:IsPassableAtPoint(x, 0, z, allow_water): land, and the ocean too when water is allowed. */
  isPassableAtPoint(point: ReadonlyVector3, allowWater: boolean): boolean;
  /** Map:IsOceanAtPoint(x, 0, z) and not Map:IsVisualGroundAtPoint(x, 0, z): open water. */
  isOceanAtPoint(point: ReadonlyVector3): boolean;
}

/** The entity ShouldEntitySink and SinkEntity read. */
export interface SinkingEntity {
  readonly position: ReadonlyVector3;
  readonly isRemoved: boolean;
  readonly inlimbo: boolean;
  readonly components: {
    readonly inventoryitem?: { IsHeld(): boolean };
    readonly inventory?: { DropEverything(): void };
    readonly container?: { DropEverything(position: { x: number; y: number; z: number }): void };
  };
  HasOneOfTags(tags: readonly string[]): boolean;
  remove(): unknown;
}

/**
 * ocean_util.lua ShouldEntitySink: an entity in the scene and not held is off the map's passable ground — the ocean
 * counts as passable unless it sinks in water. Without a map nothing sinks.
 */
export function ShouldEntitySink(entity: SinkingEntity, entity_sinks_in_water: boolean, map?: OceanMap): boolean {
  if (!map || entity.inlimbo || entity.components.inventoryitem?.IsHeld()) {
    return false;
  }
  return !map.isPassableAtPoint(entity.position, !entity_sinks_in_water);
}

/**
 * ocean_util.lua SinkEntity: whatever the entity carries is dropped where it sank, then the entity is removed. The
 * splash_sink / fallingswish FX are not ported. An irreplaceable or shoreonsink entity is meant to wash up on the
 * nearest shore (FindRandomPointOnShoreFromOcean), which is not ported either; it stays where it is instead of being
 * lost.
 */
export function SinkEntity(entity: SinkingEntity): void {
  if (entity.isRemoved) {
    return;
  }
  const { x, y, z } = entity.position;
  const position = { x, y, z };
  entity.components.inventory?.DropEverything();
  entity.components.container?.DropEverything(position);
  if (entity.HasOneOfTags(['irreplaceable', 'shoreonsink'])) {
    return;
  }
  entity.remove();
}
