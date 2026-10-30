import * as THREE from 'three';
import { createEffect, type ReadonlySignal } from '@dontstarve-web/signals';
import { parseKtex } from '@dontstarve-web/animation/parseKtex';
import { createAnimatedSpriteFactory, type AnimatedSpriteFactory } from '@dontstarve-web/animation/sprite';
import type { PrefabDisplay, SpriteState } from '@dontstarve-web/display';
import { createEmptyEntity, createPrefabEntity, type PrefabInstance } from './prefabInstance';
import { PlaySound, type SoundHandle } from './sound';
import { WORLD_SCALE } from './standardcomponents';

const TEXTURE = 'fx/rain.tex';
const SOUND = 'dontstarve/AMB/rain';

// rain.lua constants, in DST units; `S` converts them to this scene.
const S = WORLD_SCALE;
const MAX_PARTICLES = 4800;
const LIFETIME = 2;
const TICK_TIME = 1 / 30;
const EMIT_HEIGHT = 20;
// rain.lua spreads over +-20 units, but only about a quarter of that lies on screen. These tighter areas
// keep the streaks and the brief 7-frame splashes dense enough to read at the default camera.
const EMIT_HALF_EXTENT = 7;
const SPLASH_HALF_EXTENT = 10;
const DRAG = 0.2;
// rain.lua falls along world -y with a small (1, 1) drift. Perspective makes world-vertical paths converge
// toward the nadir on screen, while DST rain stays vertical on screen at every heading and zoom. Particles
// therefore move along the camera's -up direction (screen x never changes), keeping rain.lua's speeds.
const GRAVITY = 9.8;
const COLOUR_ALPHA = 200 / 255;
const SCALE = [0.1, 10] as const;
/**
 * The engine's particle scale unit is not world units: taking `{0.1, 10}` literally gives streaks about
 * 5 px wide and 500 px long at the default camera, covering the view. These factors are calibrated by eye.
 */
const SCALE_FACTOR = [0.12, 0.4] as const;
/** Extra transparency on top of the source's 200/255 colour alpha, calibrated by eye. */
const OPACITY_FACTOR = 0.5;
/** weather.lua: `particles_per_tick = 5 * preciprate`, `splashes_per_tick = 2 * preciprate`. */
const PARTICLES_PER_TICK = 5;
const SPLASHES_PER_TICK = 2;
const MAX_TICKS_PER_FRAME = 10;
// vfx sort order 3 draws after the world's foot-sorted billboards.
const RENDER_ORDER = 1_000_000;

export interface RainEffectOptions {
  scene: THREE.Scene;
  /** Directory containing `fx/rain.tex`, i.e. `${BASE_URL}dst/data`. */
  dataBaseUrl: string;
  /** Directory containing `raindrop.zip`. */
  animationBaseUrl: string;
  /** The emitter's parent: weather.lua parents the fx to the activated player. */
  getFocus: () => THREE.Vector3;
  /** Particles nearer than the focus are not drawn larger than they would be at its depth. */
  camera: THREE.Camera;
  /** weather.lua's `CalculatePrecipitationRate()`; 0 is dry, 1 is the heaviest rain. */
  rate: ReadonlySignal<number>;
}

/** One-shot `raindrop` splash from rain.lua's pool: it hides itself when its animation ends. */
/** A pooled raindrop fx entity. */
interface Splash {
  readonly instance: PrefabInstance;
  readonly display: PrefabDisplay;
  readonly model: THREE.Group;
  readonly animation: SpriteState;
  active: boolean;
}

const unitRand = () => Math.random() * 2 - 1;

/**
 * rain.lua + the rain-driving part of weather.lua's OnUpdate: a pooled VFX emitter parented to
 * the player, and the `dontstarve/AMB/rain` ambience whose `intensity` follows the rate.
 * The weather state machine itself is not ported; `rate` is its only input.
 */
export class RainEffect {
  private readonly options: RainEffectOptions;
  private readonly stopRate: () => void;
  private readonly splashes: Splash[] = [];
  private readonly pool: Splash[] = [];
  private mesh?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** rain.lua: the FX emitter entity; its particles are drawn under the display's model. */
  private emitter?: ReturnType<typeof createEmptyEntity>;
  private factory?: AnimatedSpriteFactory;
  private sound?: SoundHandle;
  private disposed = false;
  private tickRemainder = 0;
  private particlesPerTick = 0;
  private splashesPerTick = 0;
  private numParticlesToEmit = 0;
  private numSplashesToEmit = 0;
  private count = 0;
  // Particle state; positions and velocities are world-space scene units.
  private readonly position = new Float32Array(MAX_PARTICLES * 3);
  private readonly velocity = new Float32Array(MAX_PARTICLES * 3);
  private readonly age = new Float32Array(MAX_PARTICLES);
  /** Unit direction of screen-down, in world space. */
  private readonly fall = new THREE.Vector3(0, -1, 0);
  private readonly cameraPosition = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(options: RainEffectOptions) {
    this.options = options;

    void this.load().catch((error: unknown) => {
      if (!this.disposed) console.error('Unable to load rain effects', error);
    });
    this.stopRate = createEffect(() => this.setRate(options.rate.get()));
  }

  /** weather.lua OnUpdate: emitter rates and ambient sound follow the precipitation rate. */
  private setRate(rate: number): void {
    this.particlesPerTick = PARTICLES_PER_TICK * rate;
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

  private async load(): Promise<void> {
    const [texture, factory] = await Promise.all([
      this.loadTexture(),
      createAnimatedSpriteFactory(this.options.animationBaseUrl, 'raindrop.zip'),
    ]);
    if (this.disposed) {
      texture.dispose();
      factory.dispose();
      return;
    }
    this.factory = factory;
    const geometry = new THREE.BufferGeometry();
    const uv = new Float32Array(MAX_PARTICLES * 8);
    const index = new Uint16Array(MAX_PARTICLES * 6);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      uv.set([0, 1, 1, 1, 1, 0, 0, 0], i * 8);
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 12), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.setDrawRange(0, 0);
    // BLENDMODE.Premultiplied with a (1, 1, 1, 200/255) colour envelope: opacity scales the white texture.
    const material = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, opacity: COLOUR_ALPHA * OPACITY_FACTOR, side: THREE.DoubleSide,
      depthTest: true, depthWrite: false, toneMapped: false,
    });
    const mesh = this.mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'rain';
    mesh.frustumCulled = false;
    mesh.renderOrder = RENDER_ORDER;
    const emitter = this.emitter = createEmptyEntity('rain');
    emitter.instance.persists = false;
    emitter.instance.addTag('FX');
    emitter.display.model.add(mesh);
    this.options.scene.add(emitter.display.model);
    if (this.options.rate.peek() > 0) this.fastForward();
  }

  private async loadTexture(): Promise<THREE.DataTexture> {
    const url = `${this.options.dataBaseUrl.replace(/\/$/, '')}/${TEXTURE}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load ${url}: ${response.status}`);
    const decoded = parseKtex(new Uint8Array(await response.arrayBuffer()), TEXTURE);
    const texture = new THREE.DataTexture(decoded.pixels, decoded.width, decoded.height, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  /** rain.lua's emit_fn: a particle in the 40 x 40 box 20 units over the emitter (CreateBoxEmitter + UnitRand). */
  private emitParticle(x: number, z: number): void {
    if (this.count >= MAX_PARTICLES) return;
    const i = this.count++;
    this.position.set([x + EMIT_HALF_EXTENT * S * unitRand(), EMIT_HEIGHT * S, z + EMIT_HALF_EXTENT * S * unitRand()], i * 3);
    this.velocity.set(this.fall.clone().multiplyScalar((2 + 8 * unitRand()) * S).toArray(), i * 3);
    this.age[i] = 0;
  }

  /** rain.lua's `SpawnRaindropAtXZ`, reusing pooled instances like `GetPooledFx`. */
  private spawnRaindrop(x: number, z: number): void {
    if (!this.factory) return;
    let splash = this.pool.pop();
    if (!splash) {
      const factory = this.factory;
      const { instance, display } = createPrefabEntity('raindrop', { create: initialAnimation => factory.create({ initialAnimation, name: 'raindrop' }),
        release: sprite => factory.disposeSprite(sprite) }, { name: 'anim', held: true, billboard: true }, 'raindrop');
      instance.persists = false;
      instance.addTag('FX');
      splash = { instance, display, model: display.model, animation: instance.sprite, active: false };
    }
    splash.instance.position.set(x, 0, z);
    if (!splash.model.parent) this.options.scene.add(splash.model);
    splash.active = true;
    this.splashes.push(splash);
    const shown = splash;
    splash.animation.playOnce('anim', () => this.recycle(shown));
  }

  /** raindrop.lua OnAnimOver: leave the scene and wait in the pool. */
  private recycle(splash: Splash): void {
    const index = this.splashes.indexOf(splash);
    if (index < 0) return;
    this.splashes.splice(index, 1);
    splash.active = false;
    splash.model.removeFromParent();
    if (this.disposed) this.release(splash);
    else this.pool.push(splash);
  }

  private release({ instance, display }: Splash): void { instance.remove(); display.dispose(); }

  private clearPool(): void {
    for (const splash of this.pool.splice(0)) this.release(splash);
  }

  /** rain.lua's 30 Hz `updateFunc`. */
  private tick(splashes = true): void {
    const { x, z } = this.options.getFocus();
    while (this.numParticlesToEmit > 0) {
      this.emitParticle(x, z);
      this.numParticlesToEmit -= 1;
    }
    while (this.numSplashesToEmit > 0) {
      if (splashes) this.spawnRaindrop(x + SPLASH_HALF_EXTENT * S * unitRand(), z + SPLASH_HALF_EXTENT * S * unitRand());
      this.numSplashesToEmit -= 1;
    }
    this.numParticlesToEmit += this.particlesPerTick;
    if (this.splashesPerTick > 0) this.numSplashesToEmit += this.splashesPerTick;
    else this.clearPool();
  }

  private simulate(dt: number): void {
    const drag = Math.exp(-DRAG * dt);
    for (let i = 0; i < this.count;) {
      if ((this.age[i] += dt) >= LIFETIME) {
        // Swap in the last live particle.
        const last = --this.count;
        if (i !== last) {
          this.position.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.velocity.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.age[i] = this.age[last];
        }
        continue;
      }
      for (let axis = 0; axis < 3; axis++) {
        const v = (this.velocity[i * 3 + axis] + this.fall.getComponent(axis) * GRAVITY * S * dt) * drag;
        this.velocity[i * 3 + axis] = v;
        this.position[i * 3 + axis] += v * dt;
      }
      i++;
    }
  }

  /** Stretched, screen-facing quads of SCALE units; the part under the ground is clipped away. */
  private writeGeometry(): void {
    if (!this.mesh) return;
    const attribute = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = this.mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const fullWidth = SCALE[0] * SCALE_FACTOR[0] * S / 2;
    const fullHeight = SCALE[1] * SCALE_FACTOR[1] * S / 2;
    const { right, up, cameraPosition } = this;
    cameraPosition.setFromMatrixPosition(this.options.camera.matrixWorld);
    const focus = this.options.getFocus();
    const focusDistance = Math.hypot(cameraPosition.x - focus.x, cameraPosition.y - focus.y, cameraPosition.z - focus.z);
    let quads = 0;
    for (let i = 0; i < this.count; i++) {
      const cx = this.position[i * 3], cy = this.position[i * 3 + 1], cz = this.position[i * 3 + 2];
      const nearness = Math.min(1, Math.hypot(cameraPosition.x - cx, cameraPosition.y - cy, cameraPosition.z - cz) / focusDistance);
      const halfWidth = fullWidth * nearness, halfHeight = fullHeight * nearness;
      // EnableDepthTest against the terrain: keep only the part of the streak at or above y = 0.
      const bottom = up.y > 1e-4 ? Math.max(-halfHeight, -cy / up.y) : -halfHeight;
      if (bottom >= halfHeight) continue;
      const v = (halfHeight - bottom) / (2 * halfHeight);
      const base = quads * 12;
      const out = attribute.array as Float32Array;
      const points = [[-halfWidth, bottom], [halfWidth, bottom], [halfWidth, halfHeight], [-halfWidth, halfHeight]] as const;
      for (let k = 0; k < 4; k++) {
        out[base + k * 3] = cx + right.x * points[k][0] + up.x * points[k][1];
        out[base + k * 3 + 1] = cy + right.y * points[k][0] + up.y * points[k][1];
        out[base + k * 3 + 2] = cz + right.z * points[k][0] + up.z * points[k][1];
      }
      // Texture rows run top-down; the clipped bottom edge samples the matching row.
      const uvOut = uv.array as Float32Array;
      uvOut.set([0, v, 1, v, 1, 0, 0, 0], quads * 8);
      quads++;
    }
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, quads * 12);
    attribute.needsUpdate = true;
    uv.clearUpdateRanges();
    uv.addUpdateRange(0, quads * 8);
    uv.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, quads * 6);
  }

  private orient(cameraQuaternion: THREE.Quaternion): void {
    this.right.set(1, 0, 0).applyQuaternion(cameraQuaternion);
    this.up.set(0, 1, 0).applyQuaternion(cameraQuaternion);
    this.fall.copy(this.up).negate();
  }

  /** rain.lua PostInit: weather.lua calls it on load while raining so the screen is already full of rain. */
  private fastForward(): void {
    this.orient(this.options.camera.getWorldQuaternion(new THREE.Quaternion()));
    for (let t = LIFETIME; t > 0; t -= TICK_TIME) {
      this.tick(false);
      this.simulate(TICK_TIME);
    }
  }

  /** Advance by `dt` game seconds; `cameraQuaternion` orients the billboards. */
  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    this.orient(cameraQuaternion);
    this.tickRemainder = Math.min(this.tickRemainder + dt, TICK_TIME * MAX_TICKS_PER_FRAME);
    while (this.tickRemainder >= TICK_TIME) {
      this.tickRemainder -= TICK_TIME;
      this.tick();
    }
    this.simulate(dt);
    this.writeGeometry();
    for (const splash of [...this.splashes]) splash.animation.update(dt);
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
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.material.map?.dispose();
      this.mesh.material.dispose();
      this.mesh.geometry.dispose();
      this.mesh = undefined;
    }
    if (this.emitter) { this.emitter.instance.remove(); this.emitter.display.dispose(); this.emitter = undefined; }
    for (const splash of [...this.splashes, ...this.pool]) this.release(splash);
    this.splashes.length = 0;
    this.pool.length = 0;
    this.factory?.dispose();
    this.factory = undefined;
  }
}
