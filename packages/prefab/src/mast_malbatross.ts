import { definePrefabIds } from './prefabRegistration';
import { SpriteState } from '@dontstarve-web/display';
import type { GetWatchWorldContent } from '@dontstarve-web/signals';
import { Burnable } from '../../componets/src/burnable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/inspectable';
import { LootDropper } from '../../componets/src/lootdropper';
import { Mast, MAST_MALBATROSS } from '../../componets/src/mast';
import { Propagator, PROPAGATOR_CANT_TAGS } from '../../componets/src/propagator';
import { Upgradeable, UPGRADETYPES } from '../../componets/src/upgradeable';
import { Workable } from '../../componets/src/workable';
import { addComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { EntityPersistData } from './saveRecord';
import { MakeObstaclePhysics } from './standardcomponents';
import { TILE_SIZE } from './tile';

export const MAST_MALBATROSS_ID = 'mast_malbatross' as const;
/**
 * malbatross_assets' Asset("ANIM", ...) of the placed mast: the mast_malbatross bank's clips are split over three
 * archives (closed / place / hits, the knots and the opens), and SetBuild("boat_mast_malbatross_build").
 */
export const MAST_MALBATROSS_ANIMATION_ARCHIVES = [
  'boat_mast_malbatross_wip.zip',
  'boat_mast_malbatross_knots_wip.zip',
  'boat_mast_malbatross_opens_wip.zip',
] as const;
export const MAST_MALBATROSS_BUILD_ARCHIVE = 'boat_mast_malbatross_build.zip';
/** skinprefabs.lua: mast_malbatross_init_fn's AnimState:SetSkin(build_name, "boat_mast_malbatross_build"). */
export const MAST_MALBATROSS_SKINS = ['mast_malbatross_tesla', 'mast_malbatross_wagstaff'] as const;
/** DEPLOYSPACING_RADIUS[DEPLOYSPACING.LESS] / 2, in DST units. */
const DEPLOY_SMART_RADIUS = 0.75 / 2;
/** MakeLargeBurnable's default burn time. */
const LARGE_BURN_TIME = 30;
/** tuning.lua HAUNT_TINY. */
const HAUNT_TINY = 1;
const UNIT = TILE_SIZE / 4;

/** onsave's fields, and the skin this project saves with them. */
export interface MastMalbatrossSaveState {
  burnt?: true;
  rotation?: number;
  is_sail_raised?: boolean;
}

export interface MastMalbatrossWorld {
  scheduler: GameTimeScheduler;
  getWatchWorldContent?: GetWatchWorldContent;
}

/** mast.lua malbatrossfn. */
export class MastMalbatrossInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    burnable: Burnable;
    propagator: Propagator;
    hauntable: Hauntable;
    inspectable: Inspectable;
    mast: Mast;
    lootdropper: LootDropper;
    workable: Workable;
    upgradeable: Upgradeable;
  };
}

/**
 * Transform:SetRotation / GetRotation. The eight-faced mast keeps the rotation on its sprite declaration, which the
 * display turns into a facing against the camera, as the fence does; the root's own rotation stays 0.
 */
function GetRotation(inst: MastMalbatrossInstance): number {
  return inst.sprite.sprite.value.facingRotation ?? 0;
}

/** onsave. The lamp and lightning rod upgrades are not ported, so neither of their branches saves. */
function onsave(inst: MastMalbatrossInstance, data: EntityPersistData): void {
  const saved: MastMalbatrossSaveState = {};
  if (inst.components.burnable.IsBurning() || inst.hasTag('burnt')) {
    saved.burnt = true;
  }
  // inst.components.mast.boat is always nil: SetBoat is not ported.
  saved.rotation = GetRotation(inst);
  saved.is_sail_raised = inst.components.mast.is_sail_raised;
  data.mastMalbatross = saved;
}

/**
 * onload. burnable.onburnt and the onburnt listener are not registered, so a burnt record runs neither; the lamp_fuel
 * and lightningrod branches are not ported, and the save importer rejects those records.
 */
function onload(inst: MastMalbatrossInstance, data: EntityPersistData): void {
  const saved = data.mastMalbatross;
  if (!saved) {
    return;
  }
  if (saved.burnt) {
    inst.components.burnable.onburnt?.(inst);
    inst.PushEvent('onburnt', undefined);
  }
  if (saved.rotation !== undefined) {
    inst.sprite.setFacingRotation(saved.rotation);
  }
  const mast = inst.components.mast;
  if (saved.is_sail_raised === !mast.inverted) {
    if (mast.inverted) {
      mast.SailFurled();
    } else {
      mast.SailUnfurled();
    }
  }
}

/**
 * mast.lua malbatrossfn (fn_pre, fn_pst), for loading, drawing and saving. Not ported: the light the lamp upgrade
 * enables (Light:Enable(false) leaves it off; its colour and falloff are not declared), the SoundEmitter, the
 * onburnt / onbuilt / ondeconstructstructure listeners, MakeLargeBurnable's AddBurnFX and ignite / extinguish /
 * DefaultBurntStructureFn callbacks, MakeLargePropagator's SetOnFlashPoint, lootdropper's SetLootSetupFn, workable's
 * on_hammered / on_hit, upgradeable's OnUpgrade with the lamp and lightning rod, and the mast component's rudder,
 * boat and sail furling.
 */
function fn(world: MastMalbatrossWorld): MastMalbatrossInstance {
  // SetBank("mast_malbatross"), SetBuild("boat_mast_malbatross_build"), PlayAnimation("closed") without looping.
  const inst = new MastMalbatrossInstance(
    MAST_MALBATROSS_ID,
    new SpriteState({ name: 'closed', held: true, billboard: true }),
  );
  inst.BindScheduler(world.scheduler);
  inst.deploySmartRadius = DEPLOY_SMART_RADIUS * UNIT;
  // MakeObstaclePhysics(inst, .2): the tag here, the body from the definition's physics.
  inst.addTag('blocker');
  // Transform:SetEightFaced, at rotation 0.
  inst.sprite.setFacingRotation(0);
  inst.addTag('structure');
  inst.addTag('mast');
  inst.addTag('rotatableobject');

  // MakeLargeBurnable(inst, nil, nil, true), without its fx and callbacks.
  const burnable = addComponent(inst, 'burnable', Burnable, world.scheduler);
  burnable.SetFXLevel(4);
  burnable.SetBurnTime(LARGE_BURN_TIME);
  burnable.ignorefuel = true;
  // MakeLargePropagator(inst), without SetOnFlashPoint.
  addComponent(
    inst,
    'propagator',
    Propagator,
    'large',
    radius => inst.TheSim.FindEntities(inst.position, radius, undefined, PROPAGATOR_CANT_TAGS),
    UNIT,
    world.scheduler,
    world.getWatchWorldContent,
  );

  addComponent(inst, 'hauntable', Hauntable, world.scheduler);
  addComponent(inst, 'inspectable', Inspectable);
  inst.components.hauntable.SetHauntValue(HAUNT_TINY);

  addComponent(inst, 'mast', Mast);

  // The loot comes from the uncraftable recipe through SetLootSetupFn, which is not ported.
  addComponent(inst, 'lootdropper', LootDropper, () => undefined);

  const workable = addComponent(inst, 'workable', Workable);
  workable.SetWorkAction('HAMMER');
  workable.SetWorkLeft(3);

  addComponent(inst, 'upgradeable', Upgradeable).upgradetype = UPGRADETYPES.MAST;

  inst.OnSave = onsave;
  inst.OnLoad = onload;

  const mast = inst.components.mast;
  mast.sail_force = MAST_MALBATROSS.SAIL_FORCE;
  mast.rudder_turn_drag = MAST_MALBATROSS.RUDDER_TURN_DRAG;
  mast.max_velocity = MAST_MALBATROSS.MAX_VELOCITY;
  mast.SetReveseDeploy(true);
  mast.sink_fx = 'boat_malbatross_mast_sink_fx';
  return inst;
}

/** The mast_malbatross Prefab mast.lua returns, with its PREFAB_SKINS; mast, mast_yotd, the items and placers are not ported. */
export function mastMalbatrossPrefabs(
  world: MastMalbatrossWorld,
): Readonly<Record<typeof MAST_MALBATROSS_ID, PrefabEntityDefinition<MastMalbatrossInstance>>> {
  return {
    [MAST_MALBATROSS_ID]: {
      fn: () => fn(world),
      assets: {
        animationArchive: MAST_MALBATROSS_ANIMATION_ARCHIVES[0],
        extraAnimationArchives: MAST_MALBATROSS_ANIMATION_ARCHIVES.slice(1),
        buildArchives: [MAST_MALBATROSS_BUILD_ARCHIVE],
        bank: 'mast_malbatross',
      },
      skins: Object.fromEntries(MAST_MALBATROSS_SKINS.map(id => [id, `dynamic/${id}.zip`])),
      physics: { make: MakeObstaclePhysics, radius: 0.2 },
      minimapIcon: 'mast_malbatross.png',
    },
  };
}

export const mastMalbatrossRegistration = {
  create: mastMalbatrossPrefabs,
  families: { mastMalbatross: definePrefabIds([MAST_MALBATROSS_ID], true) },
};
