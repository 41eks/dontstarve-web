import type * as THREE from 'three';
import { createEffect, type ReadonlySignal } from '@dontstarve-web/signals';
import { Rainfall, SpriteResources, type LoadedSpriteSource, type PrefabDisplay, type RainfallJson, type SpriteState } from '@dontstarve-web/display';
import { createEmptyEntity, createPrefabEntity, type PrefabInstance } from './prefabInstance';
import { PlaySound, type SoundHandle } from './sound';
import { WORLD_SCALE } from './standardcomponents';

/** prefabs/rain.lua's emitter. */
export const RAIN_FX: RainfallJson = {
  texture: 'fx/rain.tex',
  maxParticles: 4800,
  lifetime: 2,
  emitHeight: 20,
  drag: 0.2,
  gravity: 9.8,
  colourAlpha: 200 / 255,
  scale: [0.1, 10],
  // weather.lua: particles_per_tick = 5 * precipitation rate.
  particlesPerTick: 5,
};

const SOUND = 'dontstarve/AMB/rain';
const TICK_TIME = 1 / 30;
const MAX_TICKS_PER_FRAME = 10;
/** weather.lua: `splashes_per_tick = 2 * preciprate`. */
const SPLASHES_PER_TICK = 2;
// rain.lua's CreateDiscEmitter(20) reaches far off screen; this tighter area keeps the brief 7-frame
// splashes dense enough to read at the default camera.
const SPLASH_HALF_EXTENT = 10 * WORLD_SCALE;

export interface RainEffectOptions {
  scene: THREE.Scene;
  /** Directory containing `fx/rain.tex`, i.e. `${BASE_URL}dst/data`. */
  dataBaseUrl: string;
  /** Directory containing `raindrop.zip`. */
  animationBaseUrl: string;
  /** The emitter's parent: weather.lua parents the fx to the activated player. */
  getFocus: () => THREE.Vector3;
  camera: THREE.Camera;
  /** weather.lua's `CalculatePrecipitationRate()`; 0 is dry, 1 is the heaviest rain. */
  rate: ReadonlySignal<number>;
}

/** A pooled raindrop fx entity. */
interface Splash {
  readonly instance: PrefabInstance;
  readonly display: PrefabDisplay;
  readonly model: THREE.Group;
  readonly animation: SpriteState;
}

const unitRand = () => Math.random() * 2 - 1;

/**
 * rain.lua + the rain-driving part of weather.lua's OnUpdate: a nonpersistent FX emitter parented to the player,
 * its pooled `raindrop` splashes, and the `dontstarve/AMB/rain` ambience whose `intensity` follows the rate.
 * Rain declares its emitter; the display draws it. The weather state machine itself is not ported; `rate` is its only input.
 */
export class RainEffect {
  private readonly options: RainEffectOptions;
  private readonly stopRate: () => void;
  /** rain.lua: the FX emitter entity; its particles are drawn under the display's model. */
  private readonly emitter = createEmptyEntity('rain');
  private readonly rainfall: Rainfall;
  /** raindrop.lua's assets, declared once for every pooled splash. */
  private readonly sprites: SpriteResources;
  private readonly raindrop: LoadedSpriteSource;
  private readonly splashes: Splash[] = [];
  private readonly pool: Splash[] = [];
  private sound?: SoundHandle;
  private disposed = false;
  private tickRemainder = 0;
  private splashesPerTick = 0;
  private numSplashesToEmit = 0;

  constructor(options: RainEffectOptions) {
    this.options = options;
    this.emitter.instance.persists = false;
    this.emitter.instance.addTag('FX');
    this.sprites = new SpriteResources(options.animationBaseUrl);
    this.raindrop = this.sprites.animated('raindrop.zip', {}, { name: 'raindrop' });
    this.rainfall = new Rainfall({ root: this.emitter.display.model, scene: options.scene, dataBaseUrl: options.dataBaseUrl,
      fx: RAIN_FX, getFocus: options.getFocus, camera: options.camera, rate: options.rate });
    this.stopRate = createEffect(() => this.setRate(options.rate.get()));
  }

  /** weather.lua OnUpdate: splash rate and ambient sound follow the precipitation rate. */
  private setRate(rate: number): void {
    this.splashesPerTick = SPLASHES_PER_TICK * rate;
    if (rate <= 0) {
      this.sound?.stop();
      this.sound = undefined;
      return;
    }
    // StartAmbientRainSound plays once, then only updates the `intensity` parameter.
    if (!this.sound?.isPlaying()) this.sound = PlaySound(SOUND);
    this.sound.setParameter?.('intensity', rate);
  }

  /** rain.lua's `SpawnRaindropAtXZ`, reusing pooled instances like `GetPooledFx`. */
  private spawnRaindrop(x: number, z: number): void {
    let splash = this.pool.pop();
    if (!splash) {
      const { instance, display } = createPrefabEntity('raindrop', this.raindrop, { name: 'anim', held: true, billboard: true }, 'raindrop');
      instance.persists = false;
      instance.addTag('FX');
      splash = { instance, display, model: display.model, animation: instance.sprite };
    }
    splash.instance.setPosition(x, 0, z);
    if (!splash.model.parent) this.options.scene.add(splash.model);
    this.splashes.push(splash);
    const shown = splash;
    splash.animation.playOnce('anim', () => this.recycle(shown));
  }

  /** raindrop.lua OnAnimOver: leave the scene and wait in the pool. */
  private recycle(splash: Splash): void {
    const index = this.splashes.indexOf(splash);
    if (index < 0) return;
    this.splashes.splice(index, 1);
    splash.model.removeFromParent();
    if (this.disposed) this.release(splash);
    else this.pool.push(splash);
  }

  private release({ instance, display }: Splash): void { instance.remove(); display.dispose(); }

  /** The splash half of rain.lua's 30 Hz `updateFunc`; ClearPoolEnts once the rain stops. */
  private tick(): void {
    const { x, z } = this.options.getFocus();
    while (this.numSplashesToEmit > 0) {
      this.spawnRaindrop(x + SPLASH_HALF_EXTENT * unitRand(), z + SPLASH_HALF_EXTENT * unitRand());
      this.numSplashesToEmit -= 1;
    }
    if (this.splashesPerTick > 0) this.numSplashesToEmit += this.splashesPerTick;
    else for (const splash of this.pool.splice(0)) this.release(splash);
  }

  /** Advance by `dt` game seconds; `cameraQuaternion` orients the billboards. */
  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    this.tickRemainder = Math.min(this.tickRemainder + dt, TICK_TIME * MAX_TICKS_PER_FRAME);
    while (this.tickRemainder >= TICK_TIME) {
      this.tickRemainder -= TICK_TIME;
      this.tick();
    }
    this.rainfall.update(dt, cameraQuaternion);
    for (const splash of [...this.splashes]) splash.display.update(dt);
  }

  /** Active splashes, so the shared renderer sorts them with other foot-sorted billboards. */
  get renderEntities() {
    return this.splashes.map(({ model }) => ({ object: model, footPosition: model.position, cameraDepth: 0 }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopRate();
    this.sound?.stop();
    this.sound = undefined;
    this.rainfall.dispose();
    this.emitter.instance.remove(); this.emitter.display.dispose();
    for (const splash of [...this.splashes, ...this.pool]) this.release(splash);
    this.splashes.length = 0;
    this.pool.length = 0;
    this.sprites.dispose();
  }
}
