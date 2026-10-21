import * as THREE from 'three';
import { createMemo, createSignal, readonlySignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from './components/gameTimeScheduler';
import { ComponentTimer } from './components/timer';
import { ArchiveSpriteAssets, preloadSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { ResidentSprite } from './residentSprite';
import type { SpriteAnimationController } from '@dontstarve-web/animation/sprite';
import { setPrefabLocalLight, type PrefabLocalLight } from './localLight';
import { newEntityId } from './saveRecord';
import { TILE_SIZE } from './tile';
import { Pickable, type PickableSaveState } from './components/pickable';
import { actionEntity, disposeActionEntity } from './actionEntity';
import { watchTileActivity } from './tileActivity';
import { createEffect, WorldContentKey, type GetWatchWorldContent, type TileStateQuery, type WorldContentSignal } from '@dontstarve-web/signals';
import { PlaySound, PreloadSounds, type SoundHandle } from './sound';

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
export interface BulbPlantRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { bulbPlant: BulbPlantSaveState };
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

export interface BulbPlantWorld {
  /** LightWatcher level at the plant; the host samples ambient and other lights. */
  getLightLevel(model: THREE.Group): number;
  scheduler?: GameTimeScheduler;
  /** The world's tickingarea query; plants outside it neither watch light nor animate. */
  tickingarea?: TileStateQuery;
  /** Source of the camera rotation; without it the host passes the rotation to every `update`. */
  getWatchWorldContent?: GetWatchWorldContent;
}

/** flower_cave's light cycle and animation callbacks for its pickable component. */
export class BulbPlantController {
  private readonly lightMode;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly rechargeTimer: ComponentTimer;
  private readonly turnoffTimer: ComponentTimer;
  private readonly wakeTimer: ComponentTimer;
  private readonly sampleTimer: ComponentTimer;
  private readonly appearanceMemo;
  readonly state;
  private tweenStartedAt: number;
  private tweenDuration = 4;
  private lightOn: boolean;
  private awake = false;
  private inLight = false;
  private animationVersion = 0;
  private disposed = false;
  private active = false;
  private releaseArea: () => void = () => {};
  private pickSound?: SoundHandle;
  readonly pickable: Pickable;
  private readonly model: THREE.Group;
  private readonly animation: SpriteAnimationController & { setActive?(active: boolean): void };
  private readonly world: BulbPlantWorld;
  private readonly random: () => number;
  private readonly variant: BulbPlantVariant;

  constructor(model: THREE.Group, animation: SpriteAnimationController & { setActive?(active: boolean): void }, world: BulbPlantWorld, variant: BulbPlantVariant,
    saved?: BulbPlantSaveState, random = Math.random) {
    this.model = model;
    this.animation = animation;
    this.world = world;
    this.random = random;
    this.variant = variant;
    this.scheduler = world.scheduler ?? new GameTimeScheduler();
    this.ownsScheduler = !world.scheduler;
    this.lightMode = createSignal<BulbPlantLightState>(saved?.lightState ?? 'CHARGED');
    this.lightOn = this.lightState === 'ON';
    this.tweenStartedAt = this.scheduler.now - this.tweenDuration;
    this.rechargeTimer = new ComponentTimer(this.scheduler, () => {
      this.setState('CHARGED');
      this.sampleLight();
      if (this.inLight) this.turnOn();
    });
    this.turnoffTimer = new ComponentTimer(this.scheduler, () => this.turnOff());
    this.wakeTimer = new ComponentTimer(this.scheduler, () => {
      this.awake = true;
      this.sampleLight();
      if (this.inLight) this.turnOn();
    });
    this.sampleTimer = new ComponentTimer(this.scheduler, () => {
      this.checkLight();
      this.sampleTimer.start(BULB_PLANT_LIGHT_SAMPLE_INTERVAL);
    });
    Object.assign(model.userData, { tags: [...(model.userData.tags ?? []), 'plant'], bulbPlantController: this });
    this.pickable = new Pickable(model, 'lightbulb', bulbPlantRegrowTime(variant),
      variant === 'double' ? 2 : variant === 'triple' ? 3 : 1,
      () => this.onPicked(), () => {
        this.beginRecharge();
        this.playSequence('grow', 'idle', true);
      }, saved, { scheduler: this.scheduler });
    this.appearanceMemo = createMemo(() => ({ phase: this.pickable.state.phase.get(), lightState: this.lightMode.get(),
      regrowing: this.pickable.state.regrowing.get() }));
    this.state = Object.freeze({ lightState: readonlySignal(this.lightMode), appearance: readonlySignal(this.appearanceMemo),
      rechargeTimer: this.rechargeTimer.snapshot, turnoffTimer: this.turnoffTimer.snapshot, wakeTimer: this.wakeTimer.snapshot });
    if (saved?.remainingSeconds !== undefined) {
      if (this.lightState === 'ON') this.turnoffTimer.start(saved.remainingSeconds);
      else if (this.lightState === 'RECHARGING') this.rechargeTimer.start(saved.remainingSeconds);
    }
    this.wakeTimer.start(1);
    this.refreshLight();
    this.releaseArea = watchTileActivity(model, world.tickingarea, active => this.setActive(active));
  }

  get lightState(): BulbPlantLightState { return this.lightMode.peek(); }
  private onPicked(): void {
    this.pickSound?.stop();
    this.pickSound = PlaySound('dontstarve/wilson/pickup_lightbulb', this.model.position);
    if (this.lightState === 'ON') this.lightMode.set('RECHARGING');
    this.turnoffTimer.stop();
    this.rechargeTimer.stop();
    this.lightOn = false;
    this.tweenStartedAt = this.scheduler.now - this.tweenDuration;
    this.playSequence('picking', 'picked');
    this.refreshLight();
  }

  get isActive(): boolean { return this.active; }

  private setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    // OnEntitySleep/OnEntityWake: frames and instance entries exist only while the tile is active.
    this.animation.setActive?.(active);
    if (!active) { this.sampleTimer.stop(); return; }
    this.checkLight();
    this.sampleTimer.start(BULB_PLANT_LIGHT_SAMPLE_INTERVAL * (0.5 + this.random() * 0.5));
    this.refreshLight();
  }

  private checkLight(): void {
    const wasInLight = this.inLight;
    this.sampleLight();
    if (this.awake && !wasInLight && this.inLight) this.turnOn();
  }

  private sampleLight(): void {
    const level = this.world.getLightLevel(this.model);
    this.inLight = this.inLight ? level > 0.05 : level >= 0.075;
  }

  update(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt < 0) return;
    if (this.active) this.animation.update(dt);
    if (this.ownsScheduler) this.scheduler.advance(dt);
    if (this.active) this.refreshLight();
  }

  turnOn(): void {
    if (this.disposed || !this.pickable.canBePicked || this.lightState !== 'CHARGED') return;
    this.setState('ON');
    this.lightOn = true;
    this.tweenStartedAt = this.scheduler.now;
    this.tweenDuration = this.randomTween();
    this.turnoffTimer.start(90 + this.tweenDuration + this.random() * 10);
    this.refreshLight();
  }

  turnOff(): void {
    if (this.disposed || this.lightState !== 'ON') return;
    this.beginRecharge();
  }

  private beginRecharge(): void {
    this.setState('RECHARGING');
    this.lightOn = false;
    this.tweenStartedAt = this.scheduler.now;
    this.tweenDuration = this.randomTween();
    this.rechargeTimer.start(110 + this.tweenDuration);
    this.refreshLight();
  }

  exportState(variant: BulbPlantVariant): BulbPlantSaveState {
    const remainingSeconds = this.lightState === 'ON' ? this.turnoffTimer.remainingSeconds : this.rechargeTimer.remainingSeconds;
    return { variant, lightState: this.lightState, ...(remainingSeconds === undefined ? {} : { remainingSeconds }),
      ...this.pickable.exportState() };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.animationVersion++;
    this.releaseArea();
    this.wakeTimer.stop(); this.sampleTimer.stop(); this.rechargeTimer.stop(); this.turnoffTimer.stop();
    this.appearanceMemo.dispose();
    this.pickable.dispose();
    this.pickSound?.stop(); this.pickSound = undefined;
    if (this.ownsScheduler) this.scheduler.dispose();
    setPrefabLocalLight(this.model, null);
  }

  private randomTween(): number { return 4 + Math.min(4, Math.floor(this.random() * 5)); }

  private setState(state: BulbPlantLightState): void {
    this.lightMode.set(state);
    const clips = state === 'ON' ? ['recharge', 'idle'] : state === 'CHARGED' ? ['revive', 'off'] : ['drain', 'withered'];
    this.playSequence(clips[0], clips[1], state === 'ON');
  }

  private playSequence(first: string, last: string, loop = false): void {
    const version = ++this.animationVersion;
    this.animation.playOnce(first, () => {
      if (this.disposed || version !== this.animationVersion) return;
      if (loop) this.animation.start(last);
      else this.animation.playOnce(last);
    });
  }

  private refreshLight(): void {
    setPrefabLocalLight(this.model, bulbPlantLight(this.lightOn, (this.scheduler.now - this.tweenStartedAt) / this.tweenDuration, this.variant));
    this.model.userData.bulbPlantLightState = this.lightState;
    this.model.userData.bulbPlantPicked = !this.pickable.canBePicked;
  }
}

interface Plant {
  prefabId: BulbPlantPrefabId;
  model: THREE.Group;
  controller: BulbPlantController;
  variant: BulbPlantVariant;
  sprite: ResidentSprite;
}

/** Shared original single/springy assets, independent world lights and timers. */
export class BulbPlantManager {
  private readonly assets: ArchiveSpriteAssets;
  private readonly factories = new Map<BulbPlantVariant, Promise<Awaited<ReturnType<typeof preloadSharedArchiveSprite>>>>();
  private readonly plants = new Set<Plant>();
  private readonly scene: THREE.Scene;
  private readonly world: BulbPlantWorld;
  private readonly random: () => number;
  private readonly cameraRotation?: WorldContentSignal<THREE.Quaternion>;
  private readonly stops: (() => void)[] = [];
  private disposed = false;

  constructor(scene: THREE.Scene, assetBaseUrl: string, world: BulbPlantWorld, random = Math.random) {
    this.scene = scene;
    this.world = world;
    this.random = random;
    this.assets = new ArchiveSpriteAssets(BULB_PLANT_ID, assetBaseUrl);
    if (world.getWatchWorldContent) {
      // Billboards face the camera: re-orient them only when it turns.
      const rotation = this.cameraRotation = world.getWatchWorldContent(WorldContentKey.CameraRotation, stop => this.stops.push(stop));
      createEffect(() => { const quaternion = rotation.get(); for (const { sprite } of this.plants) sprite.faceCamera(quaternion); });
    }
  }

  async spawn(prefabId: BulbPlantPrefabId, position: THREE.Vector3, saved?: BulbPlantRecord): Promise<THREE.Group> {
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid bulb plant position');
    const state = saved?.components.bulbPlant;
    const variant = state?.variant ?? (prefabId === 'flower_cave_double' ? 'double'
      : prefabId === 'flower_cave_triple' ? 'triple' : BULB_PLANT_VARIANTS[Math.min(1, Math.floor(this.random() * 2))]);
    let request = this.factories.get(variant);
    if (!request) {
      request = Promise.all([
        preloadSharedArchiveSprite(this.assets, { animationArchive: `bulb_plant_${variant}.zip`,
          buildArchives: [`bulb_plant_${variant}.zip`], bank: `bulb_plant_${variant}` }, { instancedAnimations: ['idle'], staticBillboard: true }),
        PreloadSounds('dontstarve/wilson/pickup_lightbulb'),
      ]).then(([factory]) => factory);
      this.factories.set(variant, request);
      void request.catch(() => this.factories.delete(variant));
    }
    const create = await request;
    if (this.disposed) throw new Error('Bulb plant manager has been disposed');
    const initialAnimation = state?.picked ? 'picked' : state?.lightState === 'ON' ? 'idle' : state?.lightState === 'RECHARGING' ? 'withered' : 'off';
    const loop = initialAnimation === 'idle', created = create(initialAnimation, loop, prefabId);
    const sprite = new ResidentSprite(clip => create(clip.name, clip.loop, prefabId), { name: initialAnimation, loop }, created, prefabId);
    if (!loop) sprite.setFrame(created.frameCount - 1);
    const model = sprite.model;
    model.position.set(position.x, 0, position.z);
    if (this.cameraRotation) sprite.faceCamera(this.cameraRotation.peek());
    model.userData.entityId = saved?.id ?? newEntityId();
    model.userData.bulbPlantVariant = variant;
    model.userData.prefab = prefabId;
    const controller = new BulbPlantController(model, sprite, this.world, variant, state, this.random);
    actionEntity(model, prefabId);
    this.plants.add({ prefabId, model, controller, variant, sprite });
    this.scene.add(model);
    return model;
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    for (const plant of this.plants) {
      if (!this.cameraRotation) plant.sprite.faceCamera(cameraQuaternion);
      plant.controller.update(dt);
    }
  }

  get renderEntities() {
    return [...this.plants].map(({ model }) => ({ object: model, footPosition: model.position, cameraDepth: 0 }));
  }

  exportRecords(): { prefabId: BulbPlantPrefabId; record: BulbPlantRecord }[] {
    return [...this.plants].map(({ prefabId, model, variant, controller }) => ({ prefabId, record: {
      id: String(model.userData.entityId), transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
      components: { bulbPlant: controller.exportState(variant) },
    } }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const { model, controller, sprite } of this.plants) {
      controller.dispose();
      disposeActionEntity(model);
      sprite.dispose();
    }
    this.plants.clear();
    this.stops.splice(0).forEach(stop => stop());
    this.assets.dispose();
  }
}
