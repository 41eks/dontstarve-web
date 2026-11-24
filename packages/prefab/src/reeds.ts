import { definePrefabIds } from './prefabRegistration';
import { SpriteState } from '@dontstarve-web/display';
import type { GetWatchWorldContent } from '@dontstarve-web/signals';
import { Burnable } from '../../componets/src/burnable';
import { Fuel } from '../../componets/src/fuel';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/inspectable';
import { Propagator, PROPAGATOR_CANT_TAGS } from '../../componets/src/propagator';
import { addComponent } from './components';
import { Pickable } from './components/pickable';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { TILE_SIZE } from './tile';

export const REEDS_ID = 'reeds' as const;
/** Asset("ANIM", ...): SetBank("grass")'s archive and SetBuild("reeds")'s. */
export const REEDS_ANIM_ARCHIVE = 'grass.zip';
export const REEDS_BUILD_ARCHIVE = 'reeds.zip';
/** tuning.lua REEDS_REGROW_TIME: total_day_time * 3. */
export const REEDS_REGROW_TIME = 480 * 3;
/** tuning.lua SMALL_FUEL: seg_time * .5. */
const SMALL_FUEL = 30 * 0.5;
/** tuning.lua HAUNT_COOLDOWN_MEDIUM, from MakeHauntableIgnite. */
const HAUNT_COOLDOWN_MEDIUM = 5;

export interface ReedsWorld {
  scheduler: GameTimeScheduler;
  getWatchWorldContent?: GetWatchWorldContent;
}

/** reeds.lua MakeReeds fn. */
export class ReedsInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    pickable: Pickable;
    inspectable: Inspectable;
    fuel: Fuel;
    burnable: Burnable;
    propagator: Propagator;
    hauntable: Hauntable;
  };
}

/** pickable.makeemptyfn: what a picked reed loads (and empties) into. */
function makeemptyfn(inst: ReedsInstance): void {
  inst.AnimState.PlayAnimation('picked');
}

/**
 * reeds.lua MakeReeds("reeds", "reeds", "reeds.png") fn, for loading, drawing and saving. Not ported: pickable's
 * onpickedfn (pickup sound, picking -> picked) and onregenfn (grow -> idle loop), MakeSmallBurnable's AddBurnFX and
 * ignite / extinguish / burnt callbacks, MakeSmallPropagator's SetOnFlashPoint, AddToRegrowthManager's onremove /
 * despawnedfromhaunt listeners, MakeNoGrowInWinter's iswinter watch, MakeHauntableIgnite's SetOnHauntFn and the
 * SoundEmitter.
 */
function fn(world: ReedsWorld): ReedsInstance {
  // SetBank("grass"), SetBuild("reeds"), PlayAnimation("idle", true).
  const inst = new ReedsInstance(REEDS_ID, new SpriteState({ name: 'idle', billboard: true }));
  inst.addTag('plant');
  inst.addTag('silviculture');

  inst.sprite.setFrameAt(Math.random());
  const color = 0.75 + Math.random() * 0.25;
  inst.AnimState.SetMultColour(color, color, color, 1);

  const pickable = addComponent(inst, 'pickable', Pickable, undefined, undefined, 1, undefined, undefined, undefined, {
    scheduler: world.scheduler,
    onEmpty: () => makeemptyfn(inst),
  });
  pickable.picksound = 'dontstarve/wilson/pickup_reeds';
  pickable.SetUp('cutreeds', REEDS_REGROW_TIME);

  addComponent(inst, 'inspectable', Inspectable);

  addComponent(inst, 'fuel', Fuel).fuelvalue = SMALL_FUEL;

  // MakeSmallBurnable(inst, TUNING.SMALL_FUEL), without its fx and callbacks.
  const burnable = addComponent(inst, 'burnable', Burnable, world.scheduler);
  burnable.SetFXLevel(2);
  burnable.SetBurnTime(SMALL_FUEL);
  // MakeSmallPropagator(inst), without SetOnFlashPoint.
  addComponent(
    inst,
    'propagator',
    Propagator,
    'small',
    radius => inst.TheSim.FindEntities(inst.position, radius, undefined, PROPAGATOR_CANT_TAGS),
    TILE_SIZE / 4,
    world.scheduler,
    world.getWatchWorldContent,
  );
  // MakeHauntableIgnite(inst), without SetOnHauntFn.
  addComponent(inst, 'hauntable', Hauntable, world.scheduler).SetCooldown(HAUNT_COOLDOWN_MEDIUM);
  return inst;
}

/** The reeds Prefab reeds.lua returns. */
export function reedsPrefabs(
  world: ReedsWorld,
): Readonly<Record<typeof REEDS_ID, PrefabEntityDefinition<ReedsInstance>>> {
  return {
    [REEDS_ID]: {
      fn: () => fn(world),
      assets: { animationArchive: REEDS_ANIM_ARCHIVE, buildArchives: [REEDS_BUILD_ARCHIVE], bank: 'grass' },
      // The idle loop instanced, each reed keeping its own frame; SetMultColour needs the batch's colour attribute.
      assetOptions: { instancedAnimations: 'all', staticBillboard: true, colour: [1, 1, 1] },
      minimapIcon: 'reeds.png',
    },
  };
}

export const reedsRegistration = {
  create: reedsPrefabs,
  families: { reeds: definePrefabIds([REEDS_ID], true) },
};
