import * as THREE from 'three';
import { addComponent, removeComponent } from './components';
import { Freezable } from '../../componets/src/freezable';
import { Floater, type FloaterInst, type FloaterSize, type FloaterSwapData } from '../../componets/src/floater';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { COLLISION, type PhysicsState } from '../../componets/src/physicsState';
import { releaseBuildingContainer } from './containers';
import type { PrefabInstance } from './prefabInstance';
import type { EntityPersistData } from './saveRecord';
import type { SpawnGroundItem } from './groundPrefab';
import type { ReadonlyVector3 } from './transform';
import catalog from './groundItems.json' with { type: 'json' };
import {
  createRenderEffect,
  getBoundWatchWorldContent,
  untrack,
  WorldContentKey,
  type GetWatchWorldContent,
} from '@dontstarve-web/signals';
import type { Pickable } from './components/pickable';
import type { LunarHailBuildup } from '../../componets/src/lunarhailbuildup';

/** World units per DST unit. */
export { WORLD_SCALE } from './tile';

/** Cannon group of the world's ground body. */
export { GROUND_COLLISION_GROUP } from '../../componets/src/physicsBinding';

/** An entity with a declared inst.Physics; `PrefabInstance` is one. */
export interface PhysicsEntity {
  readonly physics: PhysicsState;
}

/** standardcomponents.lua defaults used by the non-structure burnable prefabs. */
export function DefaultBurnFn(inst: PrefabInstance): void {
  if (!inst.hasTag('tree') && !inst.hasTag('structure')) {
    inst.persists = false;
  }
}

export function DefaultExtinguishFn(inst: PrefabInstance): void {
  if (!inst.hasTag('tree') && !inst.hasTag('structure')) {
    inst.persists = true;
  }
}

export function DefaultBurntFn(
  inst: PrefabInstance,
  world: {
    spawnGroundItem: SpawnGroundItem;
    isOcean?(position: ReadonlyVector3): boolean;
  },
): void {
  inst.components.growable?.StopGrowing();
  if (inst.components.workable?.GetWorkAction() !== 'HAMMER') {
    inst.components.workable?.SetWorkLeft(0);
  }
  if (!world.isOcean?.(inst.position)) {
    world.spawnGroundItem({ ...catalog.items.ash, itemId: 'ash', count: 1 }, inst.position);
  }
  inst.remove();
}

/** standardcomponents.lua MakeNoGrowInWinter: the instance owns the world-state binding. */
export function MakeNoGrowInWinter(
  inst: PrefabInstance & { components: { pickable: Pickable } },
  watch: GetWatchWorldContent | undefined = getBoundWatchWorldContent(),
): void {
  const season = watch?.(WorldContentKey.Season, stop => inst.onRemove(stop));
  if (!season) {
    return;
  }
  const toggle = (winter: boolean) => {
    if (winter) {
      inst.components.pickable.pause();
    } else {
      inst.components.pickable.resume();
    }
  };
  let winter: boolean | undefined;
  createRenderEffect(() => {
    const next = season.get().season === 'winter';
    if (next === winter) {
      return;
    }
    winter = next;
    untrack(() => toggle(next));
  });
}

/**
 * standardcomponents.lua MakeSnowCoveredPristine: the snow symbol override, the SnowCovered tag and the hidden snow layer.
 * The engine reads that tag (TheSim:HandleAllSnowSymbols), so the sprite declares it for the display, which then shows
 * the layer while the world is snow covered.
 */
export function MakeSnowCoveredPristine(inst: PrefabInstance): void {
  inst.sprite.setSymbolOverride('snow', 'snow.zip', 'snow');
  inst.addTag('SnowCovered');
  inst.sprite.setSnowCovered();
  inst.sprite.hideLayer('snow');
}

/**
 * standardcomponents.lua MakeSnowCovered: MakeSnowCoveredPristine unless the prefab already called it. Its Show/Hide by
 * TheWorld.state.issnowcovered, like every later change, is the display's HandleAllSnowSymbols. The caller adds
 * MakeLunarHailBuildup's lunarhailbuildup itself.
 */
export function MakeSnowCovered(inst: PrefabInstance): void {
  if (!inst.hasTag('SnowCovered')) {
    MakeSnowCoveredPristine(inst);
  }
}

/** The snow block a prefab schema records for MakeSnowCovered and UpdateLunarHailBuildup. */
export interface SnowBuildupSymbols {
  readonly build: string;
  readonly symbol: string;
  readonly source: string;
  readonly buildup: string;
  readonly snowyBuildup: string;
}

/**
 * standardcomponents.lua MakeLunarHailBuildup's look: UpdateLunarHailBuildup, run on lunarhailbuildupworkablestatechanged
 * and when issnowcovered changes, is the display's. The prefab declares the schema's symbols and the component's
 * read-only buildupWorkable at creation; accumulation, decay, knocking off and saving stay the component's.
 */
export function declareLunarHailBuildup(
  inst: PrefabInstance,
  snow: SnowBuildupSymbols,
  buildup: LunarHailBuildup,
): void {
  inst.sprite.setLunarHailBuildup({
    archive: `${snow.build}.zip`,
    symbol: snow.symbol,
    snow: snow.source,
    buildup: snow.buildup,
    snowyBuildup: snow.snowyBuildup,
    workable: buildup.buildupWorkable,
  });
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
  for (const name of ['idlesound', 'sound', 'loop', 'snd']) {
    inst.SoundEmitter?.KillSound(name);
  }
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
    removeComponent(inst, 'stewer');
  }
  removeComponent(inst, 'prototyper');
}

/** The onsave of a burnable structure's prefab: a burning structure saves as burnt. */
export function onsaveBurnt(inst: PrefabInstance, data: EntityPersistData): void {
  if (inst.hasTag('burnt') || inst.components.burnable?.IsBurning()) {
    (data.building ??= {}).burnt = true;
  }
}

/** The onload of a burnable structure's prefab: data.burnt runs the burnable's onburnt. */
export function onloadBurnt(inst: PrefabInstance, data: EntityPersistData): void {
  if (data.building?.burnt) {
    inst.components.burnable!.onburnt?.(inst);
  }
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
 * standardcomponents.lua MakeWaterObstaclePhysics(inst, rad, height, restitution), body only: an obstacle that also
 * collides with other obstacles. As with MakeObstaclePhysics, the prefab's fn adds the `blocker` tag and the
 * waterphysics component (with its restitution) where the source calls the helper.
 */
export function MakeWaterObstaclePhysics(inst: PhysicsEntity, rad: number, height = 2): PhysicsState {
  const phys = inst.physics;
  phys.SetMass(0);
  phys.SetCollisionGroup(COLLISION.OBSTACLES);
  phys.SetCollisionMask(COLLISION.ITEMS, COLLISION.CHARACTERS, COLLISION.GIANTS, COLLISION.OBSTACLES);
  phys.SetCapsule(rad, height);
  return phys;
}

/**
 * standardcomponents.lua MakeHeavyObstaclePhysics(inst, rad, height): the same static capsule as an obstacle, plus the
 * `blocker` tag. Friction, damping and restitution only matter once the heavyobstaclephysics component turns it into an item.
 */
export function MakeHeavyObstaclePhysics(
  inst: PhysicsEntity & { addTag(tag: string): void },
  rad: number,
  height = 2,
): PhysicsState {
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
export const CHARACTER_COLLISION_MASK = [
  COLLISION.WORLD,
  COLLISION.OBSTACLES,
  COLLISION.SMALLOBSTACLES,
  COLLISION.CHARACTERS,
  COLLISION.GIANTS,
] as const;

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
export function MakePondPhysics(
  inst: PhysicsEntity & { addTag(tag: string): void },
  rad: number,
  height = 2,
): PhysicsState {
  inst.addTag('blocker');
  return MakeObstaclePhysics(inst, rad, height);
}

/** standardcomponents.lua RemovePhysicsColliders(inst): a static body keeps its radius but stops colliding. */
export function RemovePhysicsColliders(inst: PhysicsEntity): void {
  const phys = inst.physics;
  if (!phys.json.value) {
    return;
  }
  if (phys.GetMass() > 0) {
    phys.SetCollisionMask(COLLISION.GROUND);
  } else {
    phys.ClearCollisionMask();
  }
}

/** standardcomponents.lua shatterfx.character. */
const SHATTER_FX_CHARACTER = 'shatter';

/** What a freezable character reaches in its world: game time and SpawnPrefab of its shatter fx. */
export interface FreezableWorld {
  readonly scheduler: GameTimeScheduler;
  readonly fx?: Pick<import('./world_fx').WorldFx, 'shatter'>;
}

/** An inst that takes freezable, as the Make*FreezableCharacter callers declare it. */
export type FreezableCharacter = PrefabInstance & {
  readonly components: PrefabInstance['components'] & { freezable?: Freezable };
};
type ShatterOffset = { readonly x: number; readonly y: number; readonly z: number };

/**
 * standardcomponents.lua Make{Tiny,Small,Medium,Large,Huge}FreezableCharacter: freezable with the size's shatter fx
 * level and resistance, and one `shatter` fx at `offset`. The fx is placed at the inst's position plus the offset; its
 * Follower on `sym` (a symbol of the inst's art) is not ported.
 */
function MakeFreezableCharacter(
  inst: FreezableCharacter,
  fxlevel: number,
  resistance: number | undefined,
  world: FreezableWorld,
  sym?: string,
  offset: ShatterOffset = { x: 0, y: 0, z: 0 },
): Freezable {
  const freezable = addComponent(inst, 'freezable', Freezable, world.scheduler, (fx, level) => {
    const { x, y, z } = inst.position;
    world.fx?.shatter(new THREE.Vector3(x + fx.x, y + fx.y, z + fx.z), level);
  });
  freezable.SetShatterFXLevel(fxlevel);
  if (resistance !== undefined) {
    freezable.SetResistance(resistance);
  }
  freezable.AddShatterFX(SHATTER_FX_CHARACTER, offset, sym);
  return freezable;
}
export const MakeTinyFreezableCharacter = (
  inst: FreezableCharacter,
  world: FreezableWorld,
  sym?: string,
  offset?: ShatterOffset,
) => MakeFreezableCharacter(inst, 1, undefined, world, sym, offset);
export const MakeSmallFreezableCharacter = (
  inst: FreezableCharacter,
  world: FreezableWorld,
  sym?: string,
  offset?: ShatterOffset,
) => MakeFreezableCharacter(inst, 2, undefined, world, sym, offset);
export const MakeMediumFreezableCharacter = (
  inst: FreezableCharacter,
  world: FreezableWorld,
  sym?: string,
  offset?: ShatterOffset,
) => MakeFreezableCharacter(inst, 3, 2, world, sym, offset);
export const MakeLargeFreezableCharacter = (
  inst: FreezableCharacter,
  world: FreezableWorld,
  sym?: string,
  offset?: ShatterOffset,
) => MakeFreezableCharacter(inst, 4, 3, world, sym, offset);
export const MakeHugeFreezableCharacter = (
  inst: FreezableCharacter,
  world: FreezableWorld,
  sym?: string,
  offset?: ShatterOffset,
) => MakeFreezableCharacter(inst, 5, 4, world, sym, offset);

/**
 * standardcomponents.lua MakeInventoryFloatable(inst, size, offset, scale, swap_bank, float_index, swap_data): the
 * floater, its size, vertical offset and scale, and the bank it swaps to while floating.
 */
export function MakeInventoryFloatable(
  inst: PrefabInstance & FloaterInst,
  size: FloaterSize = 'small',
  offset?: number,
  scale?: number | readonly [number, number, number],
  swap_bank?: boolean,
  float_index?: number,
  swap_data?: FloaterSwapData,
): Floater {
  const floater = addComponent(inst, 'floater', Floater);
  floater.SetSize(size);
  if (offset !== undefined) {
    floater.SetVerticalOffset(offset);
  }
  if (scale !== undefined) {
    floater.SetScale(scale);
  }
  if (swap_bank) {
    floater.SetBankSwapOnFloat(swap_bank, float_index, swap_data);
  } else if (swap_data) {
    floater.SetSwapData(swap_data);
  }
  return floater;
}
