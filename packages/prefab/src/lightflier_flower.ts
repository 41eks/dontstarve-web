import type { EntityEventData } from '../../componets/src/entityEvents';
import type * as THREE from 'three';
import { SpriteState, type SpriteResources } from '@dontstarve-web/display';
import { createEffect, watchSignal, type GetWatchWorldContent } from '@dontstarve-web/signals';
import { Timer } from '../../componets/src/timer';
import { ChildSpawner, type ChildSpawnerSave } from '../../componets/src/childspawner';
import { Burnable } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { addComponent } from './components';
import { Pickable, type PickableSaveState } from './components/pickable';
import { bulbPlantLight, BULB_PLANT_LIGHT_SAMPLE_INTERVAL, type BulbPlantLightState } from './bulb_plant';
import type { LightFlier, LightFlierHabitat } from './lightflier';
import { PrefabInstance, type EntityTask, type PrefabEntityDefinition } from './prefabInstance';
import type { EntityPersistData } from './saveRecord';
import { WORLD_SCALE } from './standardcomponents';

export const LIGHTFLIER_FLOWER_ID = 'lightflier_flower';
/** tuning.lua LIGHTFLIER_FLOWER_REGROW_TIME: twelve days. */
export const LIGHTFLIER_FLOWER_REGROW_TIME = 12 * 480;
export interface LightFlierFlowerSave extends PickableSaveState {
  /** onsave_single's plantname, without its leading underscore. */
  variant: 'single' | 'springy';
  lightState: BulbPlantLightState;
  /** The timer component's recharge and turnoff. */
  rechargeSeconds?: number;
  turnoffSeconds?: number;
  childspawner: ChildSpawnerSave;
}

/** STATE_ANIMS: the first clip once, then the second; only `idle` loops. */
const STATE_ANIMS: Readonly<Record<BulbPlantLightState, readonly [string, string]>> = {
  ON: ['recharge', 'idle'], CHARGED: ['revive', 'off'], RECHARGING: ['drain', 'withered'],
};
const LIGHT_MIN_TIME = 4, LIGHT_MAX_TIME = 8;
/** tuning.lua LIGHTFLIER_FLOWER_RECHARGE_TIME, _LIGHT_TIME, _LIGHT_TIME_VARIANCE, _RECALL_DELAY, _RECALL_DELAY_VARIANCE. */
const RECHARGE_TIME = 110, LIGHT_TIME = 140, LIGHT_TIME_VARIANCE = 50, RECALL_DELAY = 60, RECALL_DELAY_VARIANCE = 60;
/** tuning.lua LIGHTFLIER_FLOWER_TARGET_NUM_CHILDREN_OUTSIDE. */
const TARGET_NUM_CHILDREN_OUTSIDE = 1;
const RECALL_FREQUENCY = 8;
const FRAMES = 1 / 30;

export interface LightFlierFlowerWorld {
  scheduler: GameTimeScheduler;
  /** The lightfliers' world: SpawnPrefab("lightflier") and OnLoadPostPass's children. */
  habitat: LightFlierHabitat;
  /** LightWatcher level at the plant; the host samples ambient and other lights. */
  getLightLevel(model: THREE.Group): number;
  getWatchWorldContent?: GetWatchWorldContent;
  /** The burnt plant's ash. */
  dropLoot(prefab: string, count: number, position: THREE.Vector3): void;
  random?: () => number;
}

/** lightflier_flower.lua commonfn + single: the plant's own fields. */
export class LightFlierFlowerInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { pickable: Pickable; timer: Timer;
    childspawner: ChildSpawner<LightFlierFlowerInstance, LightFlier>; burnable: Burnable; propagator: Propagator; hauntable: Hauntable };
  readonly world: LightFlierFlowerWorld;
  plantname: LightFlierFlowerSave['variant'];
  light_state: BulbPlantLightState = 'CHARGED';
  _islighton = false;
  /** _lightframe / _lightmaxframe as game time: when the tween began and how long it lasts. */
  _lightstart: number;
  _lighttime = LIGHT_MIN_TIME;
  _lighttask?: EntityTask;
  _call_for_lightflier_task?: EntityTask;
  _lightflier_returning_home?: LightFlier;
  /** The LightWatcher's sampling while the entity is awake, and whether it last reported light. */
  _lightwatchtask?: EntityTask;
  _inlight = false;
  /** Saved children outside that OnLoadPostPass has not found yet. */
  _pendingchildren: string[] = [];
  constructor(world: LightFlierFlowerWorld, art: SpriteResources['archives']) {
    super(LIGHTFLIER_FLOWER_ID, new SpriteState({ name: 'off', held: true, billboard: true }));
    this.world = world;
    this.AnimState.DeclareAnimationAssets(LIGHTFLIER_FLOWER_ANIMATION_ARCHIVES, art);
    this.plantname = random(world) < .5 ? 'single' : 'springy';
    SetPlantArt(this);
    this._lightstart = world.scheduler.now - this._lighttime;
  }
}

const random = (world: LightFlierFlowerWorld) => (world.random ?? Math.random)();
/** lightflier_flower.lua assets: the two plantnames' ANIM archives. */
const LIGHTFLIER_FLOWER_ANIMATION_ARCHIVES = ['bulb_plant_single.zip', 'bulb_plant_springy.zip'];

/** single / onload_single: AnimState:SetBank / SetBuild("bulb_plant"..inst.plantname). */
function SetPlantArt(inst: LightFlierFlowerInstance): void {
  inst.AnimState.SetBank(`bulb_plant_${inst.plantname}`);
  inst.AnimState.SetBuild(`bulb_plant_${inst.plantname}.zip`);
}
/** math.random(LIGHT_MIN_TIME, LIGHT_MAX_TIME). */
const tweenTime = (inst: LightFlierFlowerInstance) => LIGHT_MIN_TIME + Math.min(LIGHT_MAX_TIME - LIGHT_MIN_TIME, Math.floor(random(inst.world) * 5));

/** OnLightDirty / OnUpdateLight, stepped every FRAMES by _lighttask until the tween ends. */
function OnUpdateLight(inst: LightFlierFlowerInstance): void {
  if (inst.isRemoved) { return; }
  const remaining = inst._lightstart + inst._lighttime - inst.world.scheduler.now, done = remaining <= 1e-9;
  inst.light.set(bulbPlantLight(inst._islighton, done ? 1 : 1 - remaining / inst._lighttime));
  if (!done && !inst._lighttask) {
    inst._lighttask = inst.DoTaskInTime(Math.min(FRAMES, remaining), () => { inst._lighttask = undefined; OnUpdateLight(inst); });
  }
}
function StartLight(inst: LightFlierFlowerInstance, tween: number): void {
  inst._lighttime = tween;
  inst._lightstart = inst.world.scheduler.now;
  OnUpdateLight(inst);
}
function EndLight(inst: LightFlierFlowerInstance): void {
  inst._lightstart = inst.world.scheduler.now - inst._lighttime;
  OnUpdateLight(inst);
}

function SetLightState(inst: LightFlierFlowerInstance, state: BulbPlantLightState): void {
  inst.sprite.playOnce(STATE_ANIMS[state][0]);
  inst.sprite.pushAnimation(STATE_ANIMS[state][1], state === 'ON');
  inst.light_state = state;
}

function SpawnLightflierFromStalk(inst: LightFlierFlowerInstance): void {
  const { childspawner } = inst.components;
  const lightflier = inst.world.habitat.spawn(inst.position.clone());
  childspawner.TakeOwnership(lightflier);
  lightflier.PushEvent('startled');
  childspawner.childreninside = Math.max(childspawner.childreninside - 1, 0);
}

function ForceOff(inst: LightFlierFlowerInstance): void {
  if (inst.light_state === 'ON') { SetLightState(inst, 'RECHARGING'); }
  inst._islighton = false;
  EndLight(inst);
}

function ForceOn(inst: LightFlierFlowerInstance): void {
  if (!inst.components.pickable.canBePicked) { return; }
  SetLightState(inst, 'ON');
  inst._islighton = true;
  EndLight(inst);
}

function TurnOff(inst: LightFlierFlowerInstance): void {
  const tween = tweenTime(inst);
  inst.components.timer.StartTimer('recharge', RECHARGE_TIME + tween);
  SetLightState(inst, 'RECHARGING');
  inst._islighton = false;
  StartLight(inst, tween);
}

function TurnOn(inst: LightFlierFlowerInstance): void {
  if (!inst.components.pickable.canBePicked || inst.light_state !== 'CHARGED') { return; }
  SetLightState(inst, 'ON');
  inst._islighton = true;
  StartLight(inst, tweenTime(inst));
  if (!inst.components.timer.TimerExists('turnoff')) {
    inst.components.timer.StartTimer('turnoff', LIGHT_TIME + inst._lighttime + random(inst.world) * LIGHT_TIME_VARIANCE);
  }
}

function Recharge(inst: LightFlierFlowerInstance): void {
  SetLightState(inst, 'CHARGED');
  if (IsInLight(inst)) { TurnOn(inst); }
}

function CancelCallForLightflierTask(inst: LightFlierFlowerInstance): void {
  inst._call_for_lightflier_task?.Cancel();
  inst._call_for_lightflier_task = undefined;
}

function CallForLightflier(inst: LightFlierFlowerInstance): void {
  const { pickable, childspawner } = inst.components;
  if (pickable.canBePicked || childspawner.numchildrenoutside < TARGET_NUM_CHILDREN_OUTSIDE) {
    CancelCallForLightflierTask(inst);
    return;
  }
  const returning = inst._lightflier_returning_home;
  if (returning?.isValid() && !returning.components.formationfollower.active) { return; }
  inst._lightflier_returning_home = [...childspawner.childrenoutside].find(fly => !fly.components.formationfollower.active);
}

function StartCallForLightflierTask(inst: LightFlierFlowerInstance): void {
  CancelCallForLightflierTask(inst);
  inst._call_for_lightflier_task = inst.DoPeriodicTask(RECALL_FREQUENCY, CallForLightflier,
    RECALL_DELAY + random(inst.world) * RECALL_DELAY_VARIANCE);
}

function ontimerdone(inst: LightFlierFlowerInstance, { name }: EntityEventData['timerdone']): void {
  if (name === 'recharge') { Recharge(inst); }
  else if (name === 'turnoff') {
    TurnOff(inst);
    if (inst.components.pickable.canBePicked) { inst.components.pickable.Pick(); }
  }
}

function onregenfn(inst: LightFlierFlowerInstance): void {
  TurnOff(inst);
  inst.sprite.playOnce('grow');
  inst.sprite.pushAnimation('idle', true);
}

function onpickedfn(inst: LightFlierFlowerInstance, picker: unknown): void {
  SpawnLightflierFromStalk(inst);
  ForceOff(inst);
  inst.components.timer.StopTimer('turnoff');
  inst.components.timer.StopTimer('recharge');
  if (picker) { inst.SoundEmitter!.PlaySound('dontstarve/wilson/pickup_lightbulb'); }
  inst.sprite.playOnce('picking');
  inst.sprite.pushAnimation(inst.components.pickable.IsBarren() ? 'idle_dead' : 'picked', false);
  // Do not regrow until the population is lower than max.
  inst.components.pickable.pause();
  StartCallForLightflierTask(inst);
}

function makeemptyfn(inst: LightFlierFlowerInstance): void {
  ForceOff(inst);
  inst.components.timer.StopTimer('turnoff');
  inst.components.timer.StopTimer('recharge');
  inst.sprite.playOnce('picked');
}

function OnIgnite(inst: LightFlierFlowerInstance): void {
  TurnOff(inst);
  if (inst.components.pickable.canBePicked) { inst.components.pickable.Pick(); }
  else if (inst.sprite.currentAnimation === 'picking') { inst.sprite.pushAnimation('picked', false); }
  else { inst.sprite.playOnce('picked'); }
}

/** LightWatcher:IsInLight with SetLightThresh(.075) / SetDarkThresh(.05). */
function IsInLight(inst: LightFlierFlowerInstance): boolean {
  const level = inst.world.getLightLevel(inst.transform.model);
  inst._inlight = inst._inlight ? level > .05 : level >= .075;
  return inst._inlight;
}

/** The LightWatcher's enterlight, sampled every BULB_PLANT_LIGHT_SAMPLE_INTERVAL while awake. */
function WatchLight(inst: LightFlierFlowerInstance): void {
  const wasInLight = inst._inlight;
  if (IsInLight(inst) && !wasInLight) { TurnOn(inst); }
}

/** OnEntityWake: the LightWatcher starts "in light", so TurnOnInLight waits a second; OnEntitySleep stops sampling. */
function OnEntityWake(inst: LightFlierFlowerInstance, awake: boolean): void {
  inst._lightwatchtask?.Cancel(); inst._lightwatchtask = undefined;
  if (!awake) { return; }
  inst._inlight = true;
  IsInLight(inst);
  inst._lightwatchtask = inst.DoPeriodicTask(BULB_PLANT_LIGHT_SAMPLE_INTERVAL, WatchLight,
    BULB_PLANT_LIGHT_SAMPLE_INTERVAL * (.5 + random(inst.world) * .5));
  inst.DoTaskInTime(1, flower => { if (IsInLight(flower)) { TurnOn(flower); } });
  OnUpdateLight(inst);
}

function OnSave(flower: LightFlierFlowerInstance, data: EntityPersistData): void {
  const { pickable, childspawner, timer } = flower.components;
  const children = childspawner.OnSave();
  children.childrenoutside.push(...flower._pendingchildren);
  const recharge = timer.GetTimeLeft('recharge'), turnoff = timer.GetTimeLeft('turnoff');
  data.lightflierFlower = { variant: flower.plantname, lightState: flower.light_state, ...pickable.exportState(), childspawner: children,
    ...recharge === undefined ? {} : { rechargeSeconds: recharge }, ...turnoff === undefined ? {} : { turnoffSeconds: turnoff } };
  // The record keeps these components' state inside lightflierFlower.
  delete data.pickable; delete data.childspawner; delete data.timer;
}

/** onload_single and OnLoadPostPass: the settled clip of the saved state, then the children outside as they load. */
function OnLoad(flower: LightFlierFlowerInstance, data: EntityPersistData): void {
  const saved = data.lightflierFlower;
  if (!saved) { return; }
  const { pickable, childspawner, timer } = flower.components;
  flower.plantname = saved.variant;
  SetPlantArt(flower);
  pickable.OnLoad(saved);
  flower.light_state = saved.lightState;
  childspawner.OnLoad(saved.childspawner);
  if (saved.rechargeSeconds !== undefined) { timer.StartTimer('recharge', saved.rechargeSeconds); }
  if (saved.turnoffSeconds !== undefined) { timer.StartTimer('turnoff', saved.turnoffSeconds); }
  flower._islighton = saved.lightState === 'ON' && pickable.canBePicked;
  if (!pickable.canBePicked) { flower.sprite.holdLastFrame('picked'); }
  else if (flower._islighton) { flower.sprite.start('idle'); }
  else { flower.sprite.holdLastFrame(STATE_ANIMS[flower.light_state][1]); }
  EndLight(flower);
  const outside = saved.childspawner.childrenoutside;
  flower._pendingchildren = [...outside];
  for (const id of outside) {
    const stop = flower.world.habitat.waitForFly(id, fly => {
      flower._pendingchildren = flower._pendingchildren.filter(pending => pending !== id);
      childspawner.LoadPostPass(() => fly, [id]);
    });
    flower.onRemove(stop);
  }
  if (!pickable.canBePicked && outside.length >= TARGET_NUM_CHILDREN_OUTSIDE) { StartCallForLightflierTask(flower); }
}

function single(world: LightFlierFlowerWorld, art: SpriteResources['archives']): LightFlierFlowerInstance {
  const inst = new LightFlierFlowerInstance(world, art);
  inst.BindScheduler(world.scheduler);
  inst.AddSoundEmitter();
  inst.addTag('plant');
  inst.addTag('lightflier_home');
  inst.sprite.playOnce('off');
  const colour = .75 + random(world) * .25;
  inst.sprite.setColour([colour, colour, colour]);
  addComponent(inst, 'timer', Timer, world.scheduler);
  const pickable = addComponent(inst, 'pickable', Pickable, undefined, LIGHTFLIER_FLOWER_REGROW_TIME, 1,
    (picker: unknown) => onpickedfn(inst, picker), () => onregenfn(inst), undefined,
    { scheduler: world.scheduler, onEmpty: () => makeemptyfn(inst) });
  pickable.picksound = 'dontstarve/wilson/pickup_reeds';
  addComponent(inst, 'inspectable', Inspectable);
  const childspawner = addComponent(inst, 'childspawner', ChildSpawner<LightFlierFlowerInstance, LightFlier>, world.scheduler, undefined, world.random);
  childspawner.onchildkilled = () => pickable.resume();
  childspawner.ongohome = () => {
    if (!pickable.canBePicked) { pickable.regen(); }
    ForceOn(inst);
  };
  // MakeMediumBurnable and MakeSmallPropagator.
  const burnable = addComponent(inst, 'burnable', Burnable, world.scheduler);
  burnable.SetBurnTime(20);
  burnable.SetOnIgniteFn(() => { inst.persists = false; OnIgnite(inst); });
  burnable.SetOnExtinguishFn(() => { inst.persists = true; });
  burnable.SetOnBurntFn(() => { world.dropLoot('ash', 1, inst.position.clone()); inst.remove(); });
  addComponent(inst, 'propagator', Propagator, 'small', () => [], WORLD_SCALE, world.scheduler, world.getWatchWorldContent);
  // MakeHauntableIgnite's ignite is disabled in the source.
  addComponent(inst, 'hauntable', Hauntable, world.scheduler).SetOnHauntFn(() => false);
  inst.ListenForEvent('timerdone', ontimerdone);
  const status = watchSignal(inst.status, stop => inst.onRemove(stop));
  createEffect(() => OnEntityWake(inst, status.get() === 'active'));
  inst.onRemove(() => { CancelCallForLightflierTask(inst); inst.light.set(null); });
  inst.OnSave = OnSave;
  inst.OnLoad = OnLoad;
  return inst;
}

/** The Prefab lightflier_flower.lua returns. */
export function lightflierFlowerPrefabs(world: LightFlierFlowerWorld): Readonly<Record<typeof LIGHTFLIER_FLOWER_ID, PrefabEntityDefinition<LightFlierFlowerInstance>>> {
  return {
    [LIGHTFLIER_FLOWER_ID]: {
      fn: (_position, sprites) => single(world, sprites.archives),
      // The single bank and build; the plantname's SetBank / SetBuild picks the drawn one.
      assets: { animationArchive: 'bulb_plant_single.zip', buildArchives: ['bulb_plant_single.zip'], bank: 'bulb_plant_single' },
      // Each plant owns its tint (SetMultColour), so its sprites are created with a colour.
      assetOptions: { instancedAnimations: ['idle'], staticBillboard: true, colour: [1, 1, 1] },
      minimapIcon: 'bulb_plant.png',
    },
  };
}
