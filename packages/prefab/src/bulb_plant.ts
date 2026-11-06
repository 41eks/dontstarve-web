import * as THREE from 'three';
import { SpriteState } from '@dontstarve-web/display';
import type { GameTimeScheduler } from './components/gameTimeScheduler';
import { ComponentTimer } from './components/timer';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { type PrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';
import { Pickable, type PickableSaveState } from './components/pickable';
import { Transform } from './transform';
import { PlaySound, type SoundHandle } from './sound';

export const BULB_PLANT_ID = 'flower_cave';
export const BULB_PLANT_PREFABS = ['flower_cave', 'flower_cave_double', 'flower_cave_triple'] as const;
export type BulbPlantPrefabId = typeof BULB_PLANT_PREFABS[number];
export function isBulbPlantPrefab(value: string): value is BulbPlantPrefabId {
  return (BULB_PLANT_PREFABS as readonly string[]).includes(value);
}
export const BULB_PLANT_VARIANTS = ['single', 'springy', 'double', 'triple'] as const;
export const BULB_PLANT_LIGHT_STATES = ['ON', 'CHARGED', 'RECHARGING'] as const;
export type BulbPlantVariant = typeof BULB_PLANT_VARIANTS[number];
export type BulbPlantLightState = typeof BULB_PLANT_LIGHT_STATES[number];
export interface BulbPlantSaveState extends PickableSaveState {
  variant: BulbPlantVariant;
  lightState: BulbPlantLightState;
  remainingSeconds?: number;
}
export const BULB_PLANT_LIGHT: PrefabLocalLight = {
  radius: 3 * (TILE_SIZE / 4), intensity: 0.8, falloff: 0.5,
  colour: [237 / 255, 237 / 255, 209 / 255],
};
export const BULB_PLANT_MAX_ON_TIME = 108; // 90 + random integer 4–8 + random 0–10.
export const BULB_PLANT_MAX_RECHARGE_TIME = 118; // 110 + random integer 4–8.
export function bulbPlantRegrowTime(variant: BulbPlantVariant): number {
  return 3 * 480 * (variant === 'double' ? 1.5 : variant === 'triple' ? 2 : 1);
}

const BASE_LIGHTS = Object.freeze({
  small: Object.freeze({ ...BULB_PLANT_LIGHT, radius: 3 * (TILE_SIZE / 4) }),
  large: Object.freeze({ ...BULB_PLANT_LIGHT, radius: 4.5 * (TILE_SIZE / 4) }),
});

/** Shared OnUpdateLight curve from flower_cave.lua and lightflier_flower.lua. */
export function bulbPlantLight(on: boolean, progress: number, variant: BulbPlantVariant = 'single'): PrefabLocalLight | null {
  const k = THREE.MathUtils.clamp(progress, 0, 1);
  const base = BASE_LIGHTS[variant === 'double' || variant === 'triple' ? 'large' : 'small'];
  if (!on && k >= 1 || on && k <= 0) return null;
  // The tween has settled: reuse the shared steady-state light rather than allocating one per frame.
  if (on && k >= 1) return base;
  if (!on) return { ...base,
    radius: base.radius * (1 - k), intensity: base.intensity * (1 - k),
    falloff: k + base.falloff * (1 - k) };
  if (k < 0.33) {
    const t = k / 0.33;
    return { ...base, radius: base.radius * 1.33 * t,
      intensity: base.intensity * t, falloff: base.falloff * 0.8 * t + 1 - t };
  }
  const t = (k - 0.33) / 0.67;
  return { ...base, radius: base.radius * (t + 1.33 * (1 - t)),
    falloff: base.falloff * (t + 0.8 * (1 - t)) };
}

/** LightWatcher sampling period in game seconds; samples are timer-driven rather than per frame. */
export const BULB_PLANT_LIGHT_SAMPLE_INTERVAL = 0.5;
const FRAMES = 1 / 30;

export interface BulbPlantWorld {
  /** LightWatcher level at the plant; the host samples ambient and other lights. */
  getLightLevel(model: THREE.Group): number;
  scheduler: Pick<GameTimeScheduler, 'now' | 'schedule'>;
}

/** STATE_ANIMS: the first clip plays once, then the second; only `idle` loops. */
const STATE_ANIMS: Readonly<Record<BulbPlantLightState, readonly [string, string]>> = {
  ON: ['recharge', 'idle'], CHARGED: ['revive', 'off'], RECHARGING: ['drain', 'withered'],
};

/**
 * flower_cave.lua commonfn plus single / double / triple: a pickable whose LightWatcher turns its light on in light,
 * drains it on the turnoff timer and recharges. The withered variants, burnable, lootdropper, halloweenmoonmutable and
 * hauntable are not ported. The record keeps the pickable state and the light timer inside `bulbPlant`.
 */
export class BulbPlantInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { pickable: Pickable };
  /** plantname: flower_cave rolls single or springy; double and triple are fixed. SetBank / SetBuild follow it. */
  variant: BulbPlantVariant;
  light_state: BulbPlantLightState = 'CHARGED';
  private readonly world: BulbPlantWorld;
  private readonly rechargeTimer: ComponentTimer;
  private readonly turnoffTimer: ComponentTimer;
  private readonly wakeTimer: ComponentTimer;
  private readonly sampleTimer: ComponentTimer;
  private lightOn = false;
  private tweenStartedAt: number;
  private tweenDuration = 4;
  private lightTask?: () => void;
  private inLight = false;
  private awake = false;
  private entityAwake = false;
  private animationVersion = 0;
  private pickSound?: SoundHandle;

  constructor(prefab: BulbPlantPrefabId, world: BulbPlantWorld) {
    // PlayAnimation("off"): shown on its last frame, as a plant that has been off for a while.
    super(prefab, new SpriteState({ name: 'off', held: true, billboard: true }), Transform.stationary());
    this.world = world;
    this.variant = prefab === 'flower_cave_double' ? 'double' : prefab === 'flower_cave_triple' ? 'triple'
      : BULB_PLANT_VARIANTS[Math.min(1, Math.floor(Math.random() * 2))];
    this.addTag('plant');
    const scheduler = world.scheduler;
    this.tweenStartedAt = scheduler.now - this.tweenDuration;
    this.rechargeTimer = new ComponentTimer(scheduler as GameTimeScheduler, () => this.Recharge());
    this.turnoffTimer = new ComponentTimer(scheduler as GameTimeScheduler, () => this.TurnOff());
    // OnWake: DoTaskInTime(1, TurnOnInLight); the LightWatcher only reports enterlight after it.
    this.wakeTimer = new ComponentTimer(scheduler as GameTimeScheduler, () => {
      this.awake = true;
      this.sampleLight();
      if (this.inLight) this.TurnOn();
    });
    this.sampleTimer = new ComponentTimer(scheduler as GameTimeScheduler, () => {
      this.checkLight();
      this.sampleTimer.start(BULB_PLANT_LIGHT_SAMPLE_INTERVAL);
    });
    new Pickable(this, 'lightbulb', bulbPlantRegrowTime(this.variant), this.variant === 'double' ? 2 : this.variant === 'triple' ? 3 : 1,
      () => this.onpickedfn(), () => this.onregenfn(), undefined, { scheduler: scheduler as GameTimeScheduler });
    this.wakeTimer.start(1);
    this.onRemove(() => {
      this.animationVersion++;
      this.wakeTimer.stop(); this.sampleTimer.stop(); this.rechargeTimer.stop(); this.turnoffTimer.stop();
      this.lightTask?.(); this.lightTask = undefined;
      this.components.pickable.dispose();
      this.pickSound?.stop(); this.pickSound = undefined;
      this.light.set(null);
    });

    this.OnSave = (_inst, data) => {
      const remainingSeconds = this.light_state === 'ON' ? this.turnoffTimer.remainingSeconds : this.rechargeTimer.remainingSeconds;
      data.bulbPlant = { variant: this.variant, lightState: this.light_state,
        ...(remainingSeconds === undefined ? {} : { remainingSeconds }), ...this.components.pickable.exportState() };
      delete data.pickable;
    };
    this.OnLoad = (_inst, data) => {
      const saved = data.bulbPlant;
      if (!saved) return;
      this.variant = saved.variant;
      this.light_state = saved.lightState;
      this.components.pickable.OnLoad(saved);
      this.lightOn = this.light_state === 'ON' && this.components.pickable.canBePicked;
      if (saved.remainingSeconds !== undefined) {
        if (this.light_state === 'ON') this.turnoffTimer.start(saved.remainingSeconds);
        else if (this.light_state === 'RECHARGING') this.rechargeTimer.start(saved.remainingSeconds);
      }
      // ForceOn / ForceOff(on_load): the state's settled clip, without replaying its transition.
      if (!this.components.pickable.canBePicked) this.sprite.holdLastFrame('picked');
      else if (this.lightOn) this.sprite.start('idle');
      else this.sprite.holdLastFrame(STATE_ANIMS[this.light_state][1]);
      this.refreshLight();
    };
  }

  /** OnEntitySleep / OnEntityWake: the LightWatcher samples only while the entity is awake; game-time timers keep running. */
  setActive(active: boolean): void {
    if (active !== this.entityAwake && !this.isRemoved) {
      this.entityAwake = active;
      if (!active) this.sampleTimer.stop();
      else {
        this.checkLight();
        this.sampleTimer.start(BULB_PLANT_LIGHT_SAMPLE_INTERVAL * (0.5 + Math.random() * 0.5));
        this.refreshLight();
      }
    }
    super.setActive(active);
  }

  /** TurnOn: only a pickable, CHARGED plant. */
  TurnOn(): void {
    if (this.isRemoved || !this.components.pickable.canBePicked || this.light_state !== 'CHARGED') return;
    this.SetLightState('ON');
    this.lightOn = true;
    this.startTween();
    this.turnoffTimer.start(90 + this.tweenDuration + Math.random() * 10);
  }

  /** TurnOff: the turnoff timer, or a regrowth, starts recharging. */
  TurnOff(): void {
    if (this.isRemoved) return;
    this.SetLightState('RECHARGING');
    this.lightOn = false;
    this.startTween();
    this.rechargeTimer.start(110 + this.tweenDuration);
  }

  private Recharge(): void {
    this.SetLightState('CHARGED');
    this.sampleLight();
    if (this.inLight) this.TurnOn();
  }

  private onpickedfn(): void {
    // ForceOff, then StopTimer turnoff / recharge.
    if (this.light_state === 'ON') this.SetLightState('RECHARGING');
    this.lightOn = false;
    this.endTween();
    this.turnoffTimer.stop();
    this.rechargeTimer.stop();
    this.pickSound?.stop();
    this.pickSound = PlaySound('dontstarve/wilson/pickup_lightbulb', this.position);
    this.play('picking', 'picked');
  }

  private onregenfn(): void {
    this.TurnOff();
    this.play('grow', 'idle', true);
  }

  private SetLightState(state: BulbPlantLightState): void {
    this.light_state = state;
    this.play(STATE_ANIMS[state][0], STATE_ANIMS[state][1], state === 'ON');
  }

  private play(first: string, next: string, loop = false): void {
    const version = ++this.animationVersion;
    this.sprite.playOnce(first, () => {
      if (this.isRemoved || version !== this.animationVersion) return;
      if (loop) this.sprite.start(next); else this.sprite.playOnce(next);
    });
  }

  private checkLight(): void {
    const wasInLight = this.inLight;
    this.sampleLight();
    if (this.awake && !wasInLight && this.inLight) this.TurnOn();
  }

  /** LightWatcher SetLightThresh(.075) / SetDarkThresh(.05). */
  private sampleLight(): void {
    const level = this.world.getLightLevel(this.transform.model);
    this.inLight = this.inLight ? level > 0.05 : level >= 0.075;
  }

  /** math.random(LIGHT_MIN_TIME, LIGHT_MAX_TIME), then OnLightDirty from frame 0. */
  private startTween(): void {
    this.tweenDuration = 4 + Math.min(4, Math.floor(Math.random() * 5));
    this.tweenStartedAt = this.world.scheduler.now;
    this.refreshLight();
  }

  /** EndLight: the tween jumps to its last frame. */
  private endTween(): void {
    this.tweenStartedAt = this.world.scheduler.now - this.tweenDuration;
    this.refreshLight();
  }

  /** OnUpdateLight, repeated every FRAMES by OnLightDirty's periodic task until the tween ends. */
  private refreshLight(): void {
    if (this.isRemoved) return;
    // The last step lands on the tween's end, as OnUpdateLight clamps _lightframe to _lightmaxframe.
    const remaining = this.tweenStartedAt + this.tweenDuration - this.world.scheduler.now;
    const done = remaining <= 1e-9;
    this.light.set(bulbPlantLight(this.lightOn, done ? 1 : 1 - remaining / this.tweenDuration, this.variant));
    if (!done && !this.lightTask) {
      this.lightTask = this.world.scheduler.schedule(Math.min(FRAMES, remaining), () => { this.lightTask = undefined; this.refreshLight(); });
    }
  }
}

/** The Prefabs flower_cave.lua returns, without the withered ones. */
export function bulbPlantPrefabs(world: BulbPlantWorld): Readonly<Record<BulbPlantPrefabId, PrefabEntityDefinition<BulbPlantInstance>>> {
  const define = (prefab: BulbPlantPrefabId): PrefabEntityDefinition<BulbPlantInstance> => ({
    fn: () => new BulbPlantInstance(prefab, world),
    instanceAssets: ({ variant }) => ({ animationArchive: `bulb_plant_${variant}.zip`, buildArchives: [`bulb_plant_${variant}.zip`], bank: `bulb_plant_${variant}` }),
    assetOptions: { instancedAnimations: ['idle'], staticBillboard: true },
    minimapIcon: 'bulb_plant.png',
  });
  return { flower_cave: define('flower_cave'), flower_cave_double: define('flower_cave_double'), flower_cave_triple: define('flower_cave_triple') };
}
