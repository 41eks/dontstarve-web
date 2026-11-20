import { SpriteState, type SpriteResources } from '@dontstarve-web/display';
import { createEffect, type GetWatchWorldContent } from '@dontstarve-web/signals';
import { Burnable } from '../../componets/src/burnable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Growable } from '../../componets/src/growable';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/inspectable';
import { LootDropper, type LootSpawn } from '../../componets/src/lootdropper';
import { LunarHailBuildup, WaterPhysics, Waxable } from '../../componets/src/oceantreeSignatures';
import { Propagator, PROPAGATOR_CANT_TAGS } from '../../componets/src/propagator';
import { SimpleMagicGrower } from '../../componets/src/simplemagicgrower';
import { Timer } from '../../componets/src/timer';
import { Workable } from '../../componets/src/workable';
import { addComponent, removeComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { EntityPersistData } from './saveRecord';
import { MakeSnowCovered, MakeWaterObstaclePhysics } from './standardcomponents';
import { TILE_SIZE } from './tile';
import { TREE_BURN_TIME } from './treeFire';

export const OCEANTREE_ID = 'oceantree' as const;
/** Asset("ANIM", ...): one bank and build per growth stage, and MakeEnriched's build. */
export const OCEANTREE_ARCHIVES = [
  'oceantree_short.zip',
  'oceantree_normal.zip',
  'oceantree_tall.zip',
  'oceantree_tall_jammed_build.zip',
];
/** The archives that hold the stage banks SetShort / SetNormal / SetTall pick. */
const ANIMATION_ARCHIVES = ['oceantree_short.zip', 'oceantree_normal.zip', 'oceantree_tall.zip'];

/** tuning.lua EVERGREEN_GROW_TIME[1..3] (day_time 300) and EVERGREEN_CHOPS_SMALL / _NORMAL / _TALL. */
const EVERGREEN_GROW_TIME = [
  { base: 450, random: 150 },
  { base: 1500, random: 600 },
  { base: 1500, random: 600 },
] as const;
const EVERGREEN_CHOPS_SMALL = 5,
  EVERGREEN_CHOPS_NORMAL = 10,
  EVERGREEN_CHOPS_TALL = 15;
/** TUNING.OCEANTREE_STAGES_TO_SUPERTALL. */
export const STAGES_TO_SUPERTALL = 4;

const tree_data = {
  normal_loot: ['log', 'log'],
  short_loot: ['log'],
  tall_loot: ['log', 'log', 'log'],
  oceantreenut_chance_short: undefined,
  oceantreenut_chance_medium: 0.25,
  oceantreenut_chance_tall: 1,
} as const;

const anims = {
  idle: 'idle',
  sway1: 'sway1_loop',
  sway2: 'sway2_loop',
  chop: 'chop',
  fallleft: 'fallleft',
  fallright: 'fallright',
  stump: 'stump',
  burning: 'burning_loop',
  burnt: 'burnt',
  chop_burnt: 'chop_burnt',
  idle_chop_burnt: 'idle_chop_burnt',
} as const;

/** onsave's fields. `burnt` and `stump` are written as the source does, but loading them is not ported. */
export interface OceanTreeSaveState {
  burnt?: true;
  stump?: true;
  no_grow?: boolean;
  buds?: number[];
  buds_used?: number[];
  supertall_growth_progress: number;
}

export interface OceanTreeWorld {
  scheduler: GameTimeScheduler;
  getWatchWorldContent?: GetWatchWorldContent;
  /** growable.springgrowth's spring modifier. */
  growthDuration?(seconds: number): number;
  /** LootDropper:SpawnLootPrefab. */
  spawnLoot: LootSpawn;
}

/** oceantree.lua tree("oceantree", 0): the fields fn sets on inst. */
export class OceanTreeInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    waterphysics: WaterPhysics;
    burnable: Burnable;
    propagator: Propagator;
    inspectable: Inspectable;
    workable?: Workable;
    lootdropper: LootDropper;
    growable?: Growable;
    simplemagicgrower: SimpleMagicGrower;
    timer: Timer;
    hauntable: Hauntable;
    lunarhailbuildup: LunarHailBuildup;
    waxable: Waxable;
  };
  declare anims: typeof anims;
  declare supertall_growth_progress: number;
  declare no_grow?: boolean;
  declare drop_oceantreenut_chance?: number;
  declare buds: number[];
  declare buds_used: number[];
}

const GetRandomWithVariance = (base: number, variance: number) => base + (Math.random() * 2 - 1) * variance;

function Sway(inst: OceanTreeInstance): void {
  inst.AnimState.PlayAnimation(Math.random() > 0.5 ? inst.anims.sway1 : inst.anims.sway2, true);
}

/**
 * SetShort / SetNormal / SetTall share this: the stage's bank and build, work, loot, shelter and sway. Their
 * SetLunarHailBuildupAmount* call is skipped (lunarhailbuildup is a signature), and update_ripples_roots's children are
 * not ported.
 */
function SetStageArt(
  inst: OceanTreeInstance,
  name: 'short' | 'normal' | 'tall',
  chops: number,
  loot: readonly string[],
): void {
  inst.AnimState.SetBank(`oceantree_${name}`);
  inst.AnimState.SetBuild(`oceantree_${name}.zip`);
  inst.components.workable?.SetWorkLeft(chops);
  inst.components.lootdropper.SetLoot(loot);
  inst.addTag('shelter');
  Sway(inst);
}
function SetShort(inst: OceanTreeInstance): void {
  inst.drop_oceantreenut_chance = tree_data.oceantreenut_chance_short;
  SetStageArt(inst, 'short', EVERGREEN_CHOPS_SMALL, tree_data.short_loot);
}
function SetNormal(inst: OceanTreeInstance): void {
  inst.drop_oceantreenut_chance = tree_data.oceantreenut_chance_medium;
  SetStageArt(inst, 'normal', EVERGREEN_CHOPS_NORMAL, tree_data.normal_loot);
}
function SetTall(inst: OceanTreeInstance): void {
  inst.drop_oceantreenut_chance = tree_data.oceantreenut_chance_tall;
  SetStageArt(inst, 'tall', EVERGREEN_CHOPS_TALL, tree_data.tall_loot);
}

/** The stage whose Set* fn last chose the bank: growable's, or SetTall's for a no_grow tree that has none. */
function showbuds(inst: OceanTreeInstance): void {
  for (const num of inst.buds_used) {
    inst.sprite.showLayer(`tree_bud${num}`);
  }
}

function onsave(inst: OceanTreeInstance, data: EntityPersistData): void {
  const state: OceanTreeSaveState = { supertall_growth_progress: inst.supertall_growth_progress };
  if (inst.hasTag('burnt') || inst.components.burnable.IsBurning()) {
    state.burnt = true;
  }
  if (inst.hasTag('stump')) {
    state.stump = true;
  }
  if (inst.no_grow !== undefined) {
    state.no_grow = inst.no_grow;
  }
  state.buds = [...inst.buds];
  state.buds_used = [...inst.buds_used];
  data.oceantree = state;
}

/** onload, without its stump and burnt branches (make_stump / OnBurnt are not ported; the save reader rejects them). */
function onload(inst: OceanTreeInstance, data: EntityPersistData): void {
  const saved = data.oceantree;
  if (!saved) {
    return;
  }
  inst.no_grow = saved.no_grow;
  if (inst.no_grow) {
    SetTall(inst);
    if (inst.components.growable) {
      removeComponent(inst, 'growable');
    }
  }
  if (saved.buds) {
    inst.buds = [...saved.buds];
  }
  if (saved.buds_used) {
    inst.buds_used = [...saved.buds_used];
  }
  inst.supertall_growth_progress = saved.supertall_growth_progress;
}

/**
 * onloadpostpass. Its MakeEnriched branch needs the enriched_cooldown timer and its SpawnOceanTreePillar branch a
 * supertall_growth_progress of STAGES_TO_SUPERTALL; the save reader rejects both, as neither is ported.
 */
function onloadpostpass(inst: OceanTreeInstance): void {
  if (inst.isRemoved) {
    return;
  }
  showbuds(inst);
}

/**
 * oceantree.lua tree("oceantree", 0) fn, for loading, drawing and saving. Not ported: the ripples / roots children
 * (update_ripples_roots), OnEntitySleep / OnEntityWake, the on_collide and timerdone listeners, workable's chop
 * callbacks, burnable's AddBurnFX and its ignite / extinguish / burnt callbacks, propagator's SetOnFlashPoint,
 * inspectable.getstatus, growable's growfn transitions, sproutfn, override_treegrowthsolution_fn, the DoTaskInTime(0)
 * that gives a tree on land MakeObstaclePhysics(.25), MakeLunarHailBuildup's listener and task, and the SoundEmitter.
 */
function fn(world: OceanTreeWorld, sprites: SpriteResources): OceanTreeInstance {
  const inst = new OceanTreeInstance(OCEANTREE_ID, new SpriteState({ name: anims.sway1, billboard: true }));
  inst.minimap.SetPriority(-1);
  inst.physicsRadiusOverride = 2.35;
  // MakeWaterObstaclePhysics(inst, 0.80, 2, 0.75): the tag and component here, the body from the definition's physics.
  inst.addTag('blocker');
  addComponent(inst, 'waterphysics', WaterPhysics);
  inst.addTag('ignorewalkableplatforms');
  inst.addTag('shelter');
  inst.addTag('plant');
  inst.addTag('event_trigger');
  inst.addTag('tree');
  inst.setScale(1.1);
  // MakeSnowCoveredPristine: the snow override, the SnowCovered tag and the hidden layer; MakeSnowCovered below finds
  // the tag and only follows the snow level, which this one call already does.
  MakeSnowCovered(inst, world.getWatchWorldContent);

  const stage = 1 + Math.floor(Math.random() * 3);
  inst.AnimState.DeclareAnimationAssets(ANIMATION_ARCHIVES, sprites.archives);
  inst.AnimState.SetBank(`oceantree_${['short', 'normal', 'tall'][stage - 1]}`);
  inst.AnimState.SetBuild(`oceantree_${['short', 'normal', 'tall'][stage - 1]}.zip`);
  inst.supertall_growth_progress = 0;
  inst.anims = anims;
  const color = 0.5 + Math.random() * 0.5;
  inst.sprite.setColour([color, color, color, 1]);

  // MakeLargeBurnable(inst, TUNING.TREE_BURN_TIME) and MakeMediumPropagator(inst), without their callbacks and fx.
  const burnable = addComponent(inst, 'burnable', Burnable, world.scheduler);
  burnable.SetFXLevel(4);
  burnable.SetBurnTime(TREE_BURN_TIME);
  addComponent(
    inst,
    'propagator',
    Propagator,
    'medium',
    radius => inst.TheSim.FindEntities(inst.position, radius, undefined, PROPAGATOR_CANT_TAGS),
    TILE_SIZE / 4,
    world.scheduler,
    world.getWatchWorldContent,
  );
  burnable.SetFXLevel(5);
  addComponent(inst, 'inspectable', Inspectable);
  const workable = addComponent(inst, 'workable', Workable);
  workable.SetWorkAction('CHOP');
  addComponent(inst, 'lootdropper', LootDropper, world.spawnLoot);
  const growable = addComponent(
    inst,
    'growable',
    Growable,
    world.scheduler,
    [
      {
        time: () => GetRandomWithVariance(EVERGREEN_GROW_TIME[0].base, EVERGREEN_GROW_TIME[0].random),
        fn: () => SetShort(inst),
      },
      {
        time: () => GetRandomWithVariance(EVERGREEN_GROW_TIME[1].base, EVERGREEN_GROW_TIME[1].random),
        fn: () => SetNormal(inst),
      },
      {
        time: () => GetRandomWithVariance(EVERGREEN_GROW_TIME[2].base, EVERGREEN_GROW_TIME[2].random),
        fn: () => SetTall(inst),
      },
    ],
    seconds => world.growthDuration?.(seconds) ?? seconds,
  );
  growable.SetStage(stage);
  growable.loopstages = true;
  growable.springgrowth = true;
  growable.magicgrowable = true;
  growable.StartGrowing();
  addComponent(inst, 'simplemagicgrower', SimpleMagicGrower, growable, world.scheduler).SetLastStage(
    growable.stages.length,
  );
  addComponent(inst, 'timer', Timer, world.scheduler);
  addComponent(inst, 'hauntable', Hauntable, world.scheduler);
  inst.OnSave = onsave;
  inst.OnLoad = onload;
  // MakeSnowCovered -> MakeLunarHailBuildup, then MakeWaxablePlant.
  addComponent(inst, 'lunarhailbuildup', LunarHailBuildup);
  addComponent(inst, 'waxable', Waxable);
  // Neither stump nor burnt: a random frame of the sway.
  inst.sprite.setFrameAt(Math.random());
  inst.buds = [1, 2, 3, 5, 6, 7];
  inst.buds_used = [];
  for (let i = 1; i <= 7; i++) {
    inst.sprite.hideLayer(`tree_bud${i}`);
  }
  // The engine's component OnEntitySleep / OnEntityWake: growable pauses asleep and catches up on waking. The entity
  // starts asleep, as a loaded entity does, so its tile's first activation is the wake that settles a saved sleeptime.
  inst.setActive(false);
  inst.onRemove(
    createEffect(() => {
      const status = inst.status.get();
      if (status === 'asleep') {
        inst.components.growable?.OnEntitySleep();
      } else if (status === 'active') {
        inst.components.growable?.OnEntityWake();
      }
    }),
  );
  return inst;
}

/** The oceantree Prefab oceantree.lua returns; its sized, burnt, stump, ripples, roots and falling prefabs are not ported. */
export function oceanTreePrefabs(
  world: OceanTreeWorld,
): Readonly<Record<typeof OCEANTREE_ID, PrefabEntityDefinition<OceanTreeInstance>>> {
  return {
    [OCEANTREE_ID]: {
      fn: (_position, sprites) => fn(world, sprites),
      // The bank and build come from SetShort / SetNormal / SetTall's AnimState SetBank / SetBuild, which fn and the
      // growable's OnLoad declare before the display starts; a later stage reaches the drawn sprite the same way.
      assets: {
        animationArchive: 'oceantree_tall.zip',
        buildArchives: ['oceantree_tall.zip', 'snow.zip'],
        bank: 'oceantree_tall',
        hiddenLayers: ['snow'],
      },
      // Every stage's sways share one batch per bank; the random tint is per instance.
      assetOptions: { instancedAnimations: [anims.sway1, anims.sway2], staticBillboard: true, colour: [1, 1, 1] },
      physics: { make: MakeWaterObstaclePhysics, radius: 0.8, height: 2 },
      minimapIcon: 'oceantree_tall.png',
      onSpawned: onloadpostpass,
    },
  };
}
