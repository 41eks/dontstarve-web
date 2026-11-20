import { SpriteState } from '@dontstarve-web/display';
import type { GetWatchWorldContent } from '@dontstarve-web/signals';
import { Burnable } from '../../componets/src/burnable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/inspectable';
import { Propagator, PROPAGATOR_CANT_TAGS } from '../../componets/src/propagator';
import { addComponent, removeComponent } from './components';
import { Pickable } from './components/pickable';
import { POPULATING, PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { TILE_SIZE } from './tile';

export const OCEANVINE_ID = 'oceanvine' as const;
/** tuning.lua OCEANVINE_REGROW_TIME: total_day_time * 2.5. */
export const OCEANVINE_REGROW_TIME = 480 * 2.5;
const BURN_DURATION = 2;
/** tuning.lua HAUNT_COOLDOWN_MEDIUM, from MakeHauntableIgnite. */
const HAUNT_COOLDOWN_MEDIUM = 5;

export interface OceanVineWorld {
  scheduler: GameTimeScheduler;
  getWatchWorldContent?: GetWatchWorldContent;
}

/** oceanvine.lua commonfn. */
export class OceanVineInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    inspectable?: Inspectable; pickable: Pickable; burnable: Burnable; propagator: Propagator; hauntable: Hauntable;
  };
}

/** pickable.makeemptyfn: the fig hidden, the bare loop, and no inspectable. */
function makeempty(inst: OceanVineInstance): void {
  inst.sprite.hideLayer('fig');
  inst.AnimState.PlayAnimation('idle_nofruit', true);
  if (inst.components.inspectable) { removeComponent(inst, 'inspectable'); }
}

/** pickable.makefullfn: the fig shown, settled while loading or grown, and inspectable again. */
function makefull(inst: OceanVineInstance): void {
  inst.sprite.showLayer('fig');
  if (POPULATING) {
    inst.AnimState.PlayAnimation('idle_fruit', true);
  } else {
    inst.AnimState.PlayAnimation('fruit_grow', false);
    inst.AnimState.PushAnimation('idle_fruit', true);
  }
  if (!inst.components.inspectable) { addComponent(inst, 'inspectable', Inspectable); }
}

function onloadpostpass(inst: OceanVineInstance): void {
  inst.sprite.setFrameAt(Math.random());
}

/**
 * oceanvine.lua commonfn, for loading, drawing and saving. Not ported: pickable.onpickedfn (alert_nearby_cocoons and
 * the harvest animation), burnable's ignite / burnt callbacks, AddBurnFX and its character_fire / SetFXOffset settings,
 * hauntable's SetOnHauntFn, fall_down_fn / fall / placegoffgrids, the DynamicShadow (SetSize(1.5, .75)), the
 * SoundEmitter and the oceanvine_patch Prefab.
 */
function commonfn(world: OceanVineWorld): OceanVineInstance {
  // SetBank / SetBuild("oceanvine"), PlayAnimation("idle_fruit", true).
  const inst = new OceanVineInstance(OCEANVINE_ID, new SpriteState({ name: 'idle_fruit', billboard: true }));
  inst.addTag('hangingvine');
  inst.addTag('flying');
  inst.addTag('NOBLOCK');
  inst.addTag('oceanvine');
  inst.addTag('high_dolongaction');
  addComponent(inst, 'inspectable', Inspectable);
  const pickable = addComponent(inst, 'pickable', Pickable, undefined, undefined, 1, undefined, undefined, undefined, {
    scheduler: world.scheduler, onEmpty: () => makeempty(inst),
  });
  pickable.picksound = 'dontstarve/wilson/harvest_berries';
  pickable.makefullfn = () => makefull(inst);
  pickable.SetUp('fig', OCEANVINE_REGROW_TIME);
  // max_cycles = nil; cycles_left = 1.
  pickable.cyclesLeft = 1;
  // MakeSmallBurnable(inst, nil, nil, nil, "swap_fire"), without its fx and callbacks, then SetBurnTime.
  const burnable = addComponent(inst, 'burnable', Burnable, world.scheduler);
  burnable.SetFXLevel(2);
  burnable.SetBurnTime(10);
  burnable.SetBurnTime(BURN_DURATION + 5);
  // MakeSmallPropagator(inst), without SetOnFlashPoint.
  addComponent(inst, 'propagator', Propagator, 'small', radius =>
    inst.TheSim.FindEntities(inst.position, radius, undefined, PROPAGATOR_CANT_TAGS), TILE_SIZE / 4, world.scheduler, world.getWatchWorldContent);
  // MakeHauntableIgnite(inst), without SetOnHauntFn.
  addComponent(inst, 'hauntable', Hauntable, world.scheduler).SetCooldown(HAUNT_COOLDOWN_MEDIUM);
  return inst;
}

/** The oceanvine Prefab oceanvine.lua returns; oceanvine_patch is not ported. */
export function oceanVinePrefabs(world: OceanVineWorld):
  Readonly<Record<typeof OCEANVINE_ID, PrefabEntityDefinition<OceanVineInstance>>> {
  return {
    [OCEANVINE_ID]: {
      fn: () => commonfn(world),
      assets: { animationArchive: 'oceanvine.zip', buildArchives: ['oceanvine.zip'], bank: 'oceanvine' },
      // The source loops idle_fruit / idle_nofruit; instanced, each vine keeps its own progress.
      assetOptions: { instancedAnimations: 'all' },
      minimapIcon: 'oceanvine.png',
      // inst.OnLoadPostPass: a random frame of the loop.
      onSpawned: onloadpostpass,
    },
  };
}
