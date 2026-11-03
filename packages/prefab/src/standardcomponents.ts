import { COLLISION, type PhysicsState } from '../../componets/src/physicsState';
import { releaseBuildingContainer } from './containers';
import type { PrefabInstance } from './prefabInstance';
import type { PlacementSaveRecord } from './saveRecord';
import type { SpawnGroundItem } from './groundPrefab';
import type { ReadonlyVector3 } from './transform';
import catalog from './groundItems.json' with { type: 'json' };
import { getBoundWatchWorldContent, WorldContentKey, type GetWatchWorldContent } from '@dontstarve-web/signals';
import type { Pickable } from './components/pickable';

/** World units per DST unit. */
export { WORLD_SCALE } from './tile';

/** Cannon group of the world's ground body. */
export { GROUND_COLLISION_GROUP } from '../../componets/src/physicsBinding';

/** An entity with a declared inst.Physics; `PrefabInstance` is one. */
export interface PhysicsEntity { readonly physics: PhysicsState }

/** standardcomponents.lua defaults used by the non-structure burnable prefabs. */
export function DefaultBurnFn(inst: PrefabInstance): void {
    if (!inst.hasTag('tree') && !inst.hasTag('structure')) inst.persists = false;
}

export function DefaultExtinguishFn(inst: PrefabInstance): void {
    if (!inst.hasTag('tree') && !inst.hasTag('structure')) inst.persists = true;
}

export function DefaultBurntFn(inst: PrefabInstance, world: {
    spawnGroundItem: SpawnGroundItem;
    isOcean?(position: ReadonlyVector3): boolean;
}): void {
    inst.components.growable?.StopGrowing();
    if (inst.components.workable?.GetWorkAction() !== 'HAMMER') inst.components.workable?.SetWorkLeft(0);
    if (!world.isOcean?.(inst.position)) world.spawnGroundItem({ ...catalog.items.ash, itemId: 'ash', count: 1 }, inst.position);
    inst.remove();
}

/** standardcomponents.lua MakeNoGrowInWinter: the instance owns the world-state binding. */
export function MakeNoGrowInWinter(inst: PrefabInstance & { components: { pickable: Pickable } },
    watch: GetWatchWorldContent | undefined = getBoundWatchWorldContent()): void {
    const season = watch?.(WorldContentKey.Season, stop => inst.onRemove(stop));
    if (!season) return;
    const toggle = (winter: boolean) => {
        if (winter) inst.components.pickable.pause(); else inst.components.pickable.resume();
    };
    season.subscribe((current, previous) => {
        if ((current.season === 'winter') !== (previous.season === 'winter')) toggle(current.season === 'winter');
    });
    toggle(season.peek().season === 'winter');
}

/**
 * standardcomponents.lua DefaultBurntStructureFn, for the components structures here have. Its last step,
 * RemoveComponent("burnable"), belongs to the BurnableBinding's owner, which removes the propagator with it.
 */
export function DefaultBurntStructureFn(inst: PrefabInstance): void {
    inst.addTag('burnt');
    inst.components.burnable!.canlight = false;
    inst.sprite.start('burnt');
    inst.PushEvent('burntup', undefined);
    inst.components.workable?.SetWorkLeft(1);
    const container = inst.components.container;
    if (container) {
        container.DropEverything(inst.position);
        container.Close();
        releaseBuildingContainer(inst);
    }
    const stewer = inst.components.stewer;
    if (stewer) {
        stewer.StopCooking('fire');
        stewer.OnRemoveFromEntity();
        delete inst.components.stewer;
    }
    inst.components.prototyper?.OnRemoveFromEntity();
    delete inst.components.prototyper;
}

/** The onsave of a burnable structure's prefab: a burning structure saves as burnt. */
export function onsaveBurnt(inst: PrefabInstance, data: PlacementSaveRecord['components']): void {
    if (inst.hasTag('burnt') || inst.components.burnable?.IsBurning()) (data.building ??= {}).burnt = true;
}

/** The onload of a burnable structure's prefab: data.burnt runs the burnable's onburnt. */
export function onloadBurnt(inst: PrefabInstance, data: PlacementSaveRecord['components']): void {
    if (data.building?.burnt) inst.components.burnable!.onburnt?.(inst);
}

/**
 * standardcomponents.lua MakeObstaclePhysics(inst, rad, height): declares a static capsule; the entity's
 * `PhysicsBinding` builds and registers the body. `rad` and `height` are in DST units.
 */
export function MakeObstaclePhysics(inst: PhysicsEntity, rad: number, height = 2): PhysicsState {
  const phys = inst.physics;
  phys.SetMass(0);
  phys.SetCollisionGroup(COLLISION.OBSTACLES);
  phys.SetCollisionMask(COLLISION.ITEMS, COLLISION.CHARACTERS, COLLISION.GIANTS);
  phys.SetCapsule(rad, height);
  return phys;
}

/**
 * standardcomponents.lua MakeHeavyObstaclePhysics(inst, rad, height): the same static capsule as an obstacle, plus the
 * `blocker` tag. Friction, damping and restitution only matter once the heavyobstaclephysics component turns it into an item.
 */
export function MakeHeavyObstaclePhysics(inst: PhysicsEntity & { addTag(tag: string): void }, rad: number, height = 2): PhysicsState {
  inst.addTag('blocker');
  return MakeObstaclePhysics(inst, rad, height);
}

/** standardcomponents.lua MakeSmallObstaclePhysics(inst, rad, height): collides with characters but not giants. */
export function MakeSmallObstaclePhysics(inst: PhysicsEntity, rad: number, height = 2): PhysicsState {
  const phys = inst.physics;
  phys.SetMass(0);
  phys.SetCollisionGroup(COLLISION.SMALLOBSTACLES);
  phys.SetCollisionMask(COLLISION.ITEMS, COLLISION.CHARACTERS);
  phys.SetCapsule(rad, height);
  return phys;
}

/** standardcomponents.lua MakeFlyingGiantCharacterPhysics: a flying giant collides with world, characters and giants. */
export function MakeFlyingGiantCharacterPhysics(inst: PhysicsEntity, mass: number, rad: number): PhysicsState {
  const phys = inst.physics;
  phys.SetMass(mass);
  phys.SetFriction(0);
  phys.SetDamping(5);
  phys.SetCollisionGroup(COLLISION.GIANTS);
  phys.SetCollisionMask(COLLISION.WORLD, COLLISION.CHARACTERS, COLLISION.GIANTS);
  phys.SetCapsule(rad, 1);
  return phys;
}

/** COLLISION masks of a character: SGwilson ToggleOnPhysics and ChangeToCharacterPhysics share it. */
export const CHARACTER_COLLISION_MASK = [COLLISION.WORLD, COLLISION.OBSTACLES, COLLISION.SMALLOBSTACLES, COLLISION.CHARACTERS,
  COLLISION.GIANTS] as const;

/**
 * standardcomponents.lua MakeCharacterPhysics(inst, mass, rad): a moving capsule, a circle on the ground plane.
 * `PhysicsBinding` makes it one sphere and applies the zero friction and SetDamping(5) after each step.
 */
export function MakeCharacterPhysics(inst: PhysicsEntity, mass: number, rad: number): PhysicsState {
  const phys = inst.physics;
  phys.SetMass(mass);
  phys.SetFriction(0);
  phys.SetDamping(5);
  phys.SetCollisionGroup(COLLISION.CHARACTERS);
  phys.SetCollisionMask(...CHARACTER_COLLISION_MASK);
  phys.SetCapsule(rad, 1);
  return phys;
}

/**
 * standardcomponents.lua MakeGhostPhysics(inst, mass, rad), outside a world whose flyers cross barriers: the mask
 * leaves out obstacles, so the binding lets the ghost stand on the ground and pass through everything else.
 */
export function MakeGhostPhysics(inst: PhysicsEntity, mass: number, rad: number): PhysicsState {
  const phys = inst.physics;
  phys.SetMass(mass);
  phys.SetFriction(0);
  phys.SetDamping(5);
  phys.SetCollisionGroup(COLLISION.CHARACTERS);
  phys.SetCollisionMask(COLLISION.WORLD, COLLISION.CHARACTERS, COLLISION.GIANTS);
  phys.SetCapsule(rad, 1);
  return phys;
}

/** standardcomponents.lua MakePondPhysics(inst, rad, height). */
export function MakePondPhysics(inst: PhysicsEntity, rad: number, height = 2): PhysicsState {
  return MakeObstaclePhysics(inst, rad, height);
}

/** standardcomponents.lua RemovePhysicsColliders(inst): a static body keeps its radius but stops colliding. */
export function RemovePhysicsColliders(inst: PhysicsEntity): void {
  const phys = inst.physics;
  if (!phys.json.peek()) return;
  if (phys.GetMass() > 0) phys.SetCollisionMask(COLLISION.GROUND);
  else phys.ClearCollisionMask();
}
