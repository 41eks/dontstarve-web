import { definePrefabIds } from './prefabRegistration';
import { addComponent } from './components';
import { PrefabInstance, POPULATING, type PrefabEntityDefinition } from './prefabInstance';
import { SpriteState } from '@dontstarve-web/display';
import { Pickable } from './components/pickable';
import { Workable } from '../../componets/src/workable';
import { Witherable } from '../../componets/src/witherable';
import { LootDropper } from '../../componets/src/lootdropper';
import { Growable, type GrowthStage } from '../../componets/src/growable';
import { SimpleMagicGrower } from '../../componets/src/simplemagicgrower';
import { BurnableBinding } from './treeFire';
import { DefaultExtinguishFn, DefaultBurntFn, MakeSmallObstaclePhysics, MakeSnowCovered } from './standardcomponents';
import { groundLootSpawner } from './groundPrefab';
import { SpringGrowthMod } from './simutil';
import type { PlantPrefabWorld } from './worldContext';
import type { Propagator } from '../../componets/src/propagator';
import type { Burnable } from '../../componets/src/burnable';
import type { EntityPersistData } from './saveRecord';
import { WORLD_SCALE } from './tile';
import { ROCK_AVOCADO_BUSH_CONFIG as CONFIG } from './generated/rock_avocado_bush.schema';

export const ROCK_AVOCADO_BUSH_ID = CONFIG.prefab;
export const ROCK_AVOCADO_FRUIT_ID = 'rock_avocado_fruit' as const;
const { clips } = CONFIG;
/** rock_avocado_bush.lua BUSH_ANIMS: each stage's idle clip and its grow clip, from the bank's clip table. */
const BUSH_ANIMS = [
  { idle: clips.idle1, grow: clips.crumble },
  { idle: clips.idle2, grow: clips.grow1 },
  { idle: clips.idle3, grow: clips.grow2 },
  { idle: clips.idle4, grow: clips.grow3 },
] as const;

/** rock_avocado_bush.lua's inst, with the components its fn adds. */
export class RockAvocadoBushInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    pickable: Pickable;
    burnable: Burnable;
    propagator: Propagator;
    lootdropper: LootDropper;
    witherable: Witherable;
    growable: Growable;
    simplemagicgrower: SimpleMagicGrower;
  };
}

function play_idle(inst: RockAvocadoBushInstance, stage: number): void {
  inst.AnimState.PlayAnimation(BUSH_ANIMS[stage - 1].idle.name);
}

function play_grow(inst: RockAvocadoBushInstance, stage: number): void {
  inst.AnimState.PlayAnimation(BUSH_ANIMS[stage - 1].grow.name);
  inst.AnimState.PushAnimation(BUSH_ANIMS[stage - 1].idle.name, false);
}

function set_stage1(inst: RockAvocadoBushInstance): void {
  inst.components.pickable.ChangeProduct(undefined);
  inst.components.pickable.canBePicked = false;
  play_idle(inst, 1);
}

function set_stage2(inst: RockAvocadoBushInstance): void {
  inst.components.pickable.ChangeProduct(undefined);
  inst.components.pickable.canBePicked = false;
  play_idle(inst, 2);
}

function set_stage3(inst: RockAvocadoBushInstance): void {
  inst.components.pickable.ChangeProduct(ROCK_AVOCADO_FRUIT_ID);
  inst.components.pickable.regen();
  play_idle(inst, 3);
}

function set_stage4(inst: RockAvocadoBushInstance): void {
  inst.components.pickable.ChangeProduct(undefined);
  // If we got set here directly, instead of going through stage 3, we still need to be pickable.
  if (!inst.components.pickable.canBePicked) {
    inst.components.pickable.regen();
  }
  play_idle(inst, 4);
}

/** growth_stages: GetRandomWithVariance(TUNING.ROCK_FRUIT_REGROW.*.BASE, VAR), recorded into CONFIG.stages. */
function growth_stages(inst: RockAvocadoBushInstance): GrowthStage[] {
  return [set_stage1, set_stage2, set_stage3, set_stage4].map((fn, index) => ({
    time: () => CONFIG.stages[index].base + (Math.random() * 2 - 1) * CONFIG.stages[index].var,
    fn: () => fn(inst),
    growfn: () => play_grow(inst, index + 1),
  }));
}

function onregenfn(inst: RockAvocadoBushInstance): void {
  if (inst.components.growable.GetStage() < 3) {
    inst.components.growable.SetStage(3);
  }
}

function on_bush_burnt(inst: RockAvocadoBushInstance, world: PlantPrefabWorld): void {
  if (inst.components.growable.GetStage() === 3) {
    for (let i = 0; i < 3; i++) {
      inst.components.lootdropper.SpawnLootPrefab(ROCK_AVOCADO_FRUIT_ID);
    }
  }
  inst.components.growable.StopGrowing();
  DefaultBurntFn(inst, world);
}

/** Empty: it bypasses DefaultBurnFn's persists = false. */
function on_ignite(): void {}

function on_dug_up(inst: RockAvocadoBushInstance): void {
  const { pickable, witherable, lootdropper, growable } = inst.components;
  if (witherable?.IsWithered() || pickable.IsBarren()) {
    lootdropper.SpawnLootPrefab('twigs', inst.position);
    lootdropper.SpawnLootPrefab('twigs', inst.position);
  } else {
    if (growable.GetStage() === 3) {
      for (let i = 0; i < 3; i++) {
        lootdropper.SpawnLootPrefab(ROCK_AVOCADO_FRUIT_ID, inst.position);
      }
    }
    lootdropper.SpawnLootPrefab('dug_rock_avocado_bush', inst.position);
  }
  inst.remove();
}

function onpickedfn(inst: RockAvocadoBushInstance): void {
  const picked_anim = inst.components.growable.GetStage() === 3 ? clips.picked.name : clips.crumble.name;
  inst.components.growable.SetStage(1);
  inst.AnimState.PlayAnimation(picked_anim);
  if (inst.components.pickable.IsBarren()) {
    inst.AnimState.PushAnimation(clips.idle1_to_dead1.name, false);
    inst.AnimState.PushAnimation(clips.dead1.name, false);
    inst.components.growable.StopGrowing();
    inst.components.growable.magicgrowable = false;
  } else {
    inst.AnimState.PushAnimation(clips.idle1.name, false);
  }
}

function makeemptyfn(inst: RockAvocadoBushInstance): void {
  if (POPULATING) {
    return;
  }
  // SetStage(1) will change the animation, so store whether we came into this function dead first.
  const emptying_dead = inst.sprite.currentAnimation === clips.dead1.name;
  inst.components.growable.SetStage(1);
  inst.components.growable.StartGrowing();
  inst.components.growable.magicgrowable = true;
  if (!(inst.hasTag('withered') || emptying_dead)) {
    inst.AnimState.PlayAnimation(clips.idle1.name, false);
  } else {
    inst.AnimState.PlayAnimation(clips.dead1_to_idle1.name);
    inst.AnimState.PushAnimation(clips.idle1.name, false);
  }
}

function makebarrenfn(inst: RockAvocadoBushInstance): void {
  inst.components.growable.SetStage(1);
  inst.components.growable.StopGrowing();
  inst.components.growable.magicgrowable = false;
  if (!POPULATING && inst.hasTag('withered')) {
    inst.AnimState.PlayAnimation(clips.idle1_to_dead1.name);
    inst.AnimState.PushAnimation(clips.dead1.name, false);
  } else {
    inst.AnimState.PlayAnimation(clips.dead1.name);
  }
}

function ontransplantfn(inst: RockAvocadoBushInstance): void {
  inst.components.pickable.MakeBarren();
}

function on_save(inst: RockAvocadoBushInstance, data: EntityPersistData): void {
  if (inst.components.burnable?.IsBurning()) {
    data.burning = true;
  }
}

/**
 * The saved growable always has its stage, so on_load's SetStage(1) for a nil stage never applies. The components load
 * in the record's order (Lua's is pairs order), so growable's SetStage may replace the barren pose that pickable's
 * makebarrenfn set; a barren bush settles into it again here.
 */
function on_load(inst: RockAvocadoBushInstance, data: EntityPersistData, world: PlantPrefabWorld): void {
  if (data.burning) {
    on_bush_burnt(inst, world);
  } else if (inst.components.witherable?.IsWithered()) {
    inst.components.witherable.ForceWither();
  } else if (inst.components.pickable.IsBarren()) {
    makebarrenfn(inst);
  }
}

/**
 * rock_avocado_bush.lua rock_avocado_bush(): Growable owns the stage deadlines; Pickable has no regeneration task.
 * Not ported: MakeHauntableIgnite, MakeWaxablePlant (the waxable component and the diseased build) and the lunar hail
 * buildup.
 */
function rock_avocado_bush(world: PlantPrefabWorld): RockAvocadoBushInstance {
  const inst = new RockAvocadoBushInstance(
    ROCK_AVOCADO_BUSH_ID,
    new SpriteState({ name: clips[CONFIG.initialClip].name, billboard: true }),
  );
  inst.BindScheduler(world.scheduler);
  inst.AnimState.PlayAnimation(clips[CONFIG.initialClip].name);
  inst.deploySmartRadius = CONFIG.deployRadius * WORLD_SCALE;
  // MakeSmallObstaclePhysics(inst, .1) is the prefab's `physics`; it adds the blocker tag.
  inst.addTag('blocker');
  for (const tag of CONFIG.tags) {
    inst.addTag(tag);
  }

  // MakeMediumBurnable + MakeMediumPropagator, with on_bush_burnt and on_ignite.
  const burn = new BurnableBinding(
    inst,
    {
      propagator: CONFIG.propagator,
      burnTime: CONFIG.burnable.burnTime,
      fxLevel: CONFIG.burnable.fxLevel,
      onIgnite: on_ignite,
      onExtinguish: () => DefaultExtinguishFn(inst),
      onBurnt: () => on_bush_burnt(inst, world),
    },
    world,
  );
  inst.onRemove(() => burn.dispose());

  addComponent(inst, 'lootdropper', LootDropper, groundLootSpawner(world));
  const workable = addComponent(inst, 'workable', Workable);
  workable.SetWorkAction('DIG');
  workable.SetWorkLeft(1);
  workable.SetOnFinishCallback(on_dug_up);

  const growthDuration = SpringGrowthMod(inst, world.getWatchWorldContent);
  // numtoharvest = 3; ChangeProduct sets the product per stage. TUNING.ROCK_FRUIT_PICKABLE_CYCLES = 3.
  const pickable = addComponent(
    inst,
    'pickable',
    Pickable,
    ROCK_AVOCADO_FRUIT_ID,
    undefined,
    CONFIG.pickable.numToHarvest,
    () => onpickedfn(inst),
    () => onregenfn(inst),
    undefined,
    {
      scheduler: world.scheduler,
      growthDuration,
      maxCycles: CONFIG.pickable.maxCycles,
      onEmpty: () => makeemptyfn(inst),
      onBarren: () => makebarrenfn(inst),
      onTransplant: () => ontransplantfn(inst),
    },
  );
  pickable.picksound = 'dontstarve/wilson/harvest_berries';

  addComponent(
    inst,
    'witherable',
    Witherable,
    pickable,
    world.scheduler,
    () => world.getLocalTemperature?.(inst.position) ?? 20,
    world.rain,
  );

  const growable = addComponent(inst, 'growable', Growable, world.scheduler, growth_stages(inst), growthDuration);
  growable.loopstages = true;
  growable.springgrowth = true;
  growable.magicgrowable = true;
  growable.SetStage(1 + Math.floor(Math.random() * 4));
  growable.StartGrowing();

  addComponent(inst, 'simplemagicgrower', SimpleMagicGrower, growable, world.scheduler).SetLastStage(
    CONFIG.grower.lastStage,
  );

  inst.OnSave = (_inst, data) => on_save(inst, data);
  inst.OnLoad = (_inst, data) => on_load(inst, data, world);

  MakeSnowCovered(inst);
  return inst;
}

/** rock_avocado_bush.lua's Prefab("rock_avocado_bush", rock_avocado_bush, assets). */
export function rockAvocadoBushPrefabs(
  world: PlantPrefabWorld,
): Readonly<Record<typeof ROCK_AVOCADO_BUSH_ID, PrefabEntityDefinition<RockAvocadoBushInstance>>> {
  return {
    [ROCK_AVOCADO_BUSH_ID]: {
      fn: () => rock_avocado_bush(world),
      assets: {
        animationArchive: CONFIG.archive,
        buildArchives: [CONFIG.buildArchive, `${CONFIG.snow.build}.zip`],
        bank: CONFIG.bank,
        hiddenLayers: [CONFIG.snow.layer],
      },
      assetOptions: { instancedAnimations: 'all', staticBillboard: true },
      physics: { make: MakeSmallObstaclePhysics, radius: CONFIG.physics.radius },
      minimapIcon: CONFIG.minimapIcon,
    },
  };
}

export const rockAvocadoBushRegistration = {
  create: rockAvocadoBushPrefabs,
  families: { rockAvocadoBushes: definePrefabIds([ROCK_AVOCADO_BUSH_ID], true) },
};
