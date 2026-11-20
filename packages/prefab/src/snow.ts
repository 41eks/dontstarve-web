import type * as THREE from 'three';
import type { ReadonlySignal } from '@dontstarve-web/signals';
import { Snowfall, type GroundOverlayHost, type SnowfallJson } from '@dontstarve-web/display';
import { createEmptyEntity } from './prefabInstance';

/** prefabs/snow.lua's emitter (ordinary snow; Winter's Feast is a separate source branch). */
export const SNOW_FX: SnowfallJson = {
  texture: 'fx/snow.tex',
  maxParticles: 4800,
  minLifetime: 4.5,
  maxLifetime: 7.5,
  emitExtent: 20,
  drag: 0.8,
  gravity: 9.8,
  colourAlpha: 200 / 255,
  // weather.lua: particles_per_tick = 20 * precipitation rate.
  particlesPerTick: 20,
};

/** weather.lua: the ground overlay texture whose RGB are the three snow cover masks. */
const SNOW_GROUND_TEXTURE = 'levels/textures/snow.tex';

export interface SnowEffectOptions {
  scene: THREE.Scene;
  /** Mirrored DST data root, `${BASE_URL}dst/data`. */
  dataBaseUrl: string;
  getFocus: () => THREE.Vector3;
  camera: THREE.Camera;
  rate: ReadonlySignal<number>;
  /** weather.lua's snowlevel * 3, independent of whether it is still snowing. */
  cover: ReadonlySignal<number>;
  /** The world's ground display, where snow declares its ground overlay. */
  groundOverlay: GroundOverlayHost;
}

/** Player-following, nonpersistent `snow` FX and weather.lua's ground overlay.
 * Snow declares its emitter and overlay; the display draws them. Accumulation, melting and saves belong to Weather.
 */
export class SnowEffect {
  private readonly options: SnowEffectOptions;
  /** snow.lua: the FX emitter entity; its particles are drawn under the display's model. */
  private readonly entity = createEmptyEntity('snow');
  private readonly snowfall: Snowfall;
  private disposed = false;

  constructor(options: SnowEffectOptions) {
    this.options = options;
    this.entity.instance.persists = false;
    this.entity.instance.addTag('FX');
    this.snowfall = new Snowfall({ root: this.entity.display.model, scene: options.scene, dataBaseUrl: options.dataBaseUrl,
      fx: SNOW_FX, getFocus: options.getFocus, camera: options.camera, rate: options.rate });
    // weather.lua's overlay belongs to the ground map: above turf ([-1, -0.6)), below LAYER_BACKGROUND decor (ponds: -0.5).
    options.groundOverlay.declareOverlay('snow', { texture: SNOW_GROUND_TEXTURE, cover: options.cover, renderOrder: -0.55 });
  }

  /** weather.lua calls snow.lua PostInit on a snowy load to populate existing flakes. */
  PostInit(): void { this.snowfall.PostInit(); }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void { this.snowfall.update(dt, cameraQuaternion); }

  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    this.options.groundOverlay.declareOverlay('snow', undefined);
    this.snowfall.dispose();
    this.entity.instance.remove(); this.entity.display.dispose();
  }
}
