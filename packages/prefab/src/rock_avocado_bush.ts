import { addComponent } from './components';
import { POPULATING, type PrefabEntityDefinition } from './prefabInstance';
import { SpriteState } from '@dontstarve-web/display';
import { Pickable } from './components/pickable';
import { Workable } from '../../componets/src/workable';
import { Witherable } from '../../componets/src/witherable';
import { LootDropper } from '../../componets/src/lootdropper';
import { Growable, type GrowthStage } from '../../componets/src/growable';
import { SimpleMagicGrower } from '../../componets/src/simplemagicgrower';
import { BurnableBinding } from './treeFire';
import { DefaultExtinguishFn, DefaultBurntFn, MakeSmallObstaclePhysics, MakeSnowCovered } from './standardcomponents';
import { PickablePlantInstance, plantLootSpawner, SpringGrowthMod, type PickablePlantRecord, type PickablePlantWorld } from './pickablePlant';

export const ROCK_AVOCADO_BUSH_ID = 'rock_avocado_bush' as const;
export const ROCK_AVOCADO_FRUIT_ID = 'rock_avocado_fruit' as const;
// tuning.lua day_time is the ten daytime segments (300s), not total_day_time (480s).
export const ROCK_AVOCADO_STAGE_TIMES = [600, 180, 900, 300] as const;
const BUSH_ANIMS = [
  { idle: 'idle1', grow: 'crumble' },
  { idle: 'idle2', grow: 'grow1' },
  { idle: 'idle3', grow: 'grow2' },
  { idle: 'idle4', grow: 'grow3' },
] as const;

/** rock_avocado_bush.lua's inst, with the components its fn adds. */
export interface RockAvocadoBushInstance extends PickablePlantInstance {
  readonly components: PickablePlantInstance['components'] & { growable: Growable; simplemagicgrower: SimpleMagicGrower; lootdropper: LootDropper };
}

function play_idle(inst: RockAvocadoBushInstance, stage: number): void {
  inst.AnimState.PlayAnimation(BUSH_ANIMS[stage - 1].idle);
}

function play_grow(inst: RockAvocadoBushInstance, stage: number): void {
  inst.AnimState.PlayAnimation(BUSH_ANIMS[stage - 1].grow);
  inst.AnimState.PushAnimation(BUSH_ANIMS[stage - 1].idle, false);
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
  if (!inst.components.pickable.canBePicked) inst.components.pickable.regen();
  play_idle(inst, 4);
}

/** growth_stages: GetRandomWithVariance(TUNING.ROCK_FRUIT_REGROW.*.BASE, 60). */
function growth_stages(inst: RockAvocadoBushInstance): GrowthStage[] {
  return [set_stage1, set_stage2, set_stage3, set_stage4].map((fn, index) => ({
    time: () => ROCK_AVOCADO_STAGE_TIMES[index] + (Math.random() * 2 - 1) * 60,
    fn: () => fn(inst),
    growfn: () => play_grow(inst, index + 1),
  }));
}

function onregenfn(inst: RockAvocadoBushInstance): void {
  if (inst.components.growable.GetStage() < 3) inst.components.growable.SetStage(3);
}

function on_bush_burnt(inst: RockAvocadoBushInstance, world: PickablePlantWorld): void {
  if (inst.components.growable.GetStage() === 3) for (let i = 0; i < 3; i++) inst.components.lootdropper.SpawnLootPrefab(ROCK_AVOCADO_FRUIT_ID);
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
    if (growable.GetStage() === 3) for (let i = 0; i < 3; i++) lootdropper.SpawnLootPrefab(ROCK_AVOCADO_FRUIT_ID, inst.position);
    lootdropper.SpawnLootPrefab('dug_rock_avocado_bush', inst.position);
  }
  inst.remove();
}

function onpickedfn(inst: RockAvocadoBushInstance): void {
  const picked_anim = inst.components.growable.GetStage() === 3 ? 'picked' : 'crumble';
  inst.components.growable.SetStage(1);
  inst.AnimState.PlayAnimation(picked_anim);
  if (inst.components.pickable.IsBarren()) {
    inst.AnimState.PushAnimation('idle1_to_dead1', false);
    inst.AnimState.PushAnimation('dead1', false);
    inst.components.growable.StopGrowing();
    inst.components.growable.magicgrowable = false;
  } else inst.AnimState.PushAnimation('idle1', false);
}

function makeemptyfn(inst: RockAvocadoBushInstance): void {
  if (POPULATING) return;
  // SetStage(1) will change the animation, so store whether we came into this function dead first.
  const emptying_dead = inst.sprite.currentAnimation === 'dead1';
  inst.components.growable.SetStage(1);
  inst.components.growable.StartGrowing();
  inst.components.growable.magicgrowable = true;
  if (!(inst.hasTag('withered') || emptying_dead)) inst.AnimState.PlayAnimation('idle1', false);
  else {
    inst.AnimState.PlayAnimation('dead1_to_idle1');
    inst.AnimState.PushAnimation('idle1', false);
  }
}

function makebarrenfn(inst: RockAvocadoBushInstance): void {
  inst.components.growable.SetStage(1);
  inst.components.growable.StopGrowing();
  inst.components.growable.magicgrowable = false;
  if (!POPULATING && inst.hasTag('withered')) {
    inst.AnimState.PlayAnimation('idle1_to_dead1');
    inst.AnimState.PushAnimation('dead1', false);
  } else inst.AnimState.PlayAnimation('dead1');
}

function ontransplantfn(inst: RockAvocadoBushInstance): void {
  inst.components.pickable.MakeBarren();
}

function on_save(inst: RockAvocadoBushInstance, data: PickablePlantRecord['components']): void {
  if (inst.components.burnable?.IsBurning()) data.burning = true;
}

/**
 * The saved growable always has its stage, so on_load's SetStage(1) for a nil stage never applies. The components load
 * in the record's order (Lua's is pairs order), so growable's SetStage may replace the barren pose that pickable's
 * makebarrenfn set; a barren bush settles into it again here.
 */
function on_load(inst: RockAvocadoBushInstance, data: PickablePlantRecord['components'], world: PickablePlantWorld): void {
  if (data.burning) on_bush_burnt(inst, world);
  else if (inst.components.witherable?.IsWithered()) inst.components.witherable.ForceWither();
  else if (inst.components.pickable.IsBarren()) makebarrenfn(inst);
}

/**
 * rock_avocado_bush.lua rock_avocado_bush(): Growable owns the stage deadlines; Pickable has no regeneration task.
 * Not ported: MakeHauntableIgnite, MakeWaxablePlant and the lunar hail buildup.
 */
function rock_avocado_bush(world: PickablePlantWorld): RockAvocadoBushInstance {
  const inst = new PickablePlantInstance(ROCK_AVOCADO_BUSH_ID, new SpriteState({ name: 'idle1', billboard: true })) as RockAvocadoBushInstance;
  inst.BindScheduler(world.scheduler);
  inst.AnimState.PlayAnimation('idle1');
  inst.deploySmartRadius = 3;
  // MakeSmallObstaclePhysics(inst, .1) is the prefab's `physics`; it adds the blocker tag.
  inst.addTag('blocker');
  inst.addTag('plant');
  inst.addTag('renewable');
  inst.addTag('slurtlepickable');

  // MakeMediumBurnable + MakeMediumPropagator, with on_bush_burnt and on_ignite.
  const burn = new BurnableBinding(inst, { propagator: 'medium', burnTime: 20, fxLevel: 3,
    onIgnite: on_ignite, onExtinguish: () => DefaultExtinguishFn(inst), onBurnt: () => on_bush_burnt(inst, world) }, world);
  inst.onRemove(() => burn.dispose());

  addComponent(inst, 'lootdropper', LootDropper, plantLootSpawner(world));
  const workable = addComponent(inst, 'workable', Workable);
  workable.SetWorkAction('DIG');
  workable.SetWorkLeft(1);
  workable.SetOnFinishCallback(on_dug_up);

  const growthDuration = SpringGrowthMod(inst, world.getWatchWorldContent);
  // numtoharvest = 3; ChangeProduct sets the product per stage. TUNING.ROCK_FRUIT_PICKABLE_CYCLES = 3.
  const pickable = addComponent(inst, 'pickable', Pickable, ROCK_AVOCADO_FRUIT_ID, undefined, 3, () => onpickedfn(inst), () => onregenfn(inst), undefined, {
    scheduler: world.scheduler, growthDuration, maxCycles: 3,
    onEmpty: () => makeemptyfn(inst), onBarren: () => makebarrenfn(inst), onTransplant: () => ontransplantfn(inst),
  });
  pickable.picksound = 'dontstarve/wilson/harvest_berries';

  addComponent(inst, 'witherable', Witherable, pickable, world.scheduler, () => world.getLocalTemperature?.(inst.position) ?? 20, world.rain);

  const growable = addComponent(inst, 'growable', Growable, world.scheduler, growth_stages(inst), growthDuration);
  growable.loopstages = true;
  growable.springgrowth = true;
  growable.magicgrowable = true;
  growable.SetStage(1 + Math.floor(Math.random() * 4));
  growable.StartGrowing();

  addComponent(inst, 'simplemagicgrower', SimpleMagicGrower, growable, world.scheduler).SetLastStage(3);

  inst.OnSave = (_inst, data) => on_save(inst, data);
  inst.OnLoad = (_inst, data) => on_load(inst, data, world);

  MakeSnowCovered(inst, world.getWatchWorldContent);
  return inst;
}

/** rock_avocado_bush.lua's Prefab("rock_avocado_bush", rock_avocado_bush, assets). */
export function rockAvocadoBushPrefabs(world: PickablePlantWorld): Readonly<Record<typeof ROCK_AVOCADO_BUSH_ID, PrefabEntityDefinition<PickablePlantInstance>>> {
  return {
    [ROCK_AVOCADO_BUSH_ID]: {
      fn: () => rock_avocado_bush(world),
      assets: { animationArchive: 'rock_avocado.zip', buildArchives: ['rock_avocado_build.zip', 'snow.zip'], bank: 'rock_avocado', hiddenLayers: ['snow'] },
      assetOptions: { instancedAnimations: 'all', staticBillboard: true },
      physics: { make: MakeSmallObstaclePhysics, radius: .1 },
    },
  };
}
