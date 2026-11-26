import * as THREE from 'three';
import { createEffect, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import { WORLD_SCALE } from '@dontstarve-web/animation/units';
import { loadGroundTexture } from './groundAssets';

/** A rainfall emitter as a prefab declares it in Lua (VFXEffect settings plus its emit_fn and EmitterManager tick).
 * Lengths are in DST units. */
export interface RainfallJson {
  /** SetRenderResources texture, below `dst/data`. */
  readonly texture: string;
  readonly maxParticles: number;
  /** MIN_LIFETIME = MAX_LIFETIME. */
  readonly lifetime: number;
  /** CreateBoxEmitter height above the focus. */
  readonly emitHeight: number;
  readonly drag: number;
  /** SetAcceleration's downward component. */
  readonly gravity: number;
  /** The colour envelope's alpha. */
  readonly colourAlpha: number;
  /** The scale envelope: streak width and length. */
  readonly scale: readonly [number, number];
  /** particles_per_tick at a precipitation rate of 1. */
  readonly particlesPerTick: number;
}

export interface RainfallOptions {
  /** The emitter entity's transform root; the display mounts it in `scene` once the art loads. */
  root: THREE.Object3D;
  scene: THREE.Object3D;
  /** Mirrored DST data root, `${BASE_URL}dst/data`. */
  dataBaseUrl: string;
  fx: RainfallJson;
  getFocus: () => THREE.Vector3;
  /** Particles nearer than the focus are not drawn larger than they would be at its depth. */
  camera: THREE.Camera;
  rate: ReadonlySignal<number>;
}

const TICK_TIME = 1 / 30;
// rain.lua spreads over +-20 units, but only about a quarter of that lies on screen. This tighter area
// keeps the streaks dense enough to read at the default camera.
const EMIT_HALF_EXTENT = 7 * WORLD_SCALE;
/**
 * The engine's particle scale unit is not world units: taking `{0.1, 10}` literally gives streaks about
 * 5 px wide and 500 px long at the default camera, covering the view. These factors are calibrated by eye.
 */
const SCALE_FACTOR = [0.12, 0.4] as const;
/** Extra transparency on top of the source's colour alpha, calibrated by eye. */
const OPACITY_FACTOR = 0.5;
const MAX_TICKS_PER_FRAME = 10;
// vfx sort order 3 draws after the world's foot-sorted billboards.
const RENDER_ORDER = 1_000_000;
const unitRand = () => Math.random() * 2 - 1;

/**
 * Draws and simulates a declared rainfall emitter that follows the focus. rain.lua falls along world -y with a
 * small (1, 1) drift. Perspective makes world-vertical paths converge toward the nadir on screen, while DST rain
 * stays vertical on screen at every heading and zoom. Particles therefore move along the camera's -up direction
 * (screen x never changes), keeping rain.lua's speeds.
 */
export class Rainfall {
  private readonly options: RainfallOptions;
  private readonly root: THREE.Object3D;
  private readonly rate: ReadonlySignal<number>;
  private stopRate!: () => void;
  private mesh?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** The mesh's dynamic quad attributes and the arrays they upload. */
  private quads?: {
    position: THREE.BufferAttribute;
    positions: Float32Array;
    uv: THREE.BufferAttribute;
    uvs: Float32Array;
  };
  private disposed = false;
  private tickRemainder = 0;
  private particlesPerTick = 0;
  private numParticlesToEmit = 0;
  private count = 0;
  // Particle state; positions and velocities are world-space scene units.
  private readonly position: Float32Array;
  private readonly velocity: Float32Array;
  private readonly age: Float32Array;
  /** Unit direction of screen-down, in world space. */
  private readonly fall = new THREE.Vector3(0, -1, 0);
  private readonly cameraPosition = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(options: RainfallOptions) {
    this.options = options;
    this.root = options.root;
    const max = options.fx.maxParticles;
    this.position = new Float32Array(max * 3);
    this.velocity = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.rate = watchSignal(options.rate, cleanup => {
      this.stopRate = cleanup;
    });
    createEffect(() => {
      this.particlesPerTick = options.fx.particlesPerTick * this.rate.get();
    });
    void this.loadParticles().catch((error: unknown) => {
      if (!this.disposed) {
        console.error('Unable to load rain particles', error);
      }
    });
  }

  private async loadParticles(): Promise<void> {
    const { fx } = this.options;
    const texture = await loadGroundTexture(this.options.dataBaseUrl, fx.texture, false);
    if (this.disposed) {
      texture.dispose();
      return;
    }
    const geometry = new THREE.BufferGeometry();
    const uv = new Float32Array(fx.maxParticles * 8);
    const index = new Uint16Array(fx.maxParticles * 6);
    for (let i = 0; i < fx.maxParticles; i++) {
      uv.set([0, 1, 1, 1, 1, 0, 0, 0], i * 8);
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const positions = new Float32Array(fx.maxParticles * 12);
    const quads = (this.quads = {
      position: new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
      positions,
      uv: new THREE.BufferAttribute(uv, 2),
      uvs: uv,
    });
    geometry.setAttribute('position', quads.position);
    geometry.setAttribute('uv', quads.uv);
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.setDrawRange(0, 0);
    // BLENDMODE.Premultiplied with a white colour envelope: opacity scales the white texture.
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: fx.colourAlpha * OPACITY_FACTOR,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = (this.mesh = new THREE.Mesh(geometry, material));
    mesh.name = 'rain';
    mesh.frustumCulled = false;
    mesh.renderOrder = RENDER_ORDER;
    this.root.add(mesh);
    this.options.scene.add(this.root);
    if (this.rate.value > 0) {
      this.PostInit();
    }
  }

  /** rain.lua's emit_fn: a particle in the box over the emitter (CreateBoxEmitter + UnitRand). */
  private emitParticle(x: number, z: number): void {
    if (this.count >= this.options.fx.maxParticles) {
      return;
    }
    const i = this.count++;
    this.position.set(
      [x + EMIT_HALF_EXTENT * unitRand(), this.options.fx.emitHeight * WORLD_SCALE, z + EMIT_HALF_EXTENT * unitRand()],
      i * 3,
    );
    // vy = -2 - 8 * UnitRand(), along screen-down.
    const speed = (2 + 8 * unitRand()) * WORLD_SCALE;
    this.velocity.set([this.fall.x * speed, this.fall.y * speed, this.fall.z * speed], i * 3);
    this.age[i] = 0;
  }

  /** The particle half of rain.lua's 30 Hz `updateFunc`. */
  private tick(): void {
    const { x, z } = this.options.getFocus();
    while (this.numParticlesToEmit > 0) {
      this.emitParticle(x, z);
      this.numParticlesToEmit -= 1;
    }
    this.numParticlesToEmit += this.particlesPerTick;
  }

  private simulate(dt: number): void {
    const { drag: dragCoefficient, gravity, lifetime } = this.options.fx;
    const drag = Math.exp(-dragCoefficient * dt);
    for (let i = 0; i < this.count; ) {
      if ((this.age[i] += dt) >= lifetime) {
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
        const v = (this.velocity[i * 3 + axis] + this.fall.getComponent(axis) * gravity * WORLD_SCALE * dt) * drag;
        this.velocity[i * 3 + axis] = v;
        this.position[i * 3 + axis] += v * dt;
      }
      i++;
    }
  }

  /** Stretched, screen-facing quads of the scale envelope; the part under the ground is clipped away. */
  private writeGeometry(): void {
    if (!this.mesh || !this.quads) {
      return;
    }
    const { position: attribute, positions: out, uv, uvs: uvOut } = this.quads;
    const { scale } = this.options.fx;
    const fullWidth = (scale[0] * SCALE_FACTOR[0] * WORLD_SCALE) / 2;
    const fullHeight = (scale[1] * SCALE_FACTOR[1] * WORLD_SCALE) / 2;
    const { right, up, cameraPosition } = this;
    cameraPosition.setFromMatrixPosition(this.options.camera.matrixWorld);
    const focusDistance = cameraPosition.distanceTo(this.options.getFocus());
    let quads = 0;
    for (let i = 0; i < this.count; i++) {
      const cx = this.position[i * 3],
        cy = this.position[i * 3 + 1],
        cz = this.position[i * 3 + 2];
      const nearness = Math.min(
        1,
        Math.hypot(cameraPosition.x - cx, cameraPosition.y - cy, cameraPosition.z - cz) / focusDistance,
      );
      const halfWidth = fullWidth * nearness,
        halfHeight = fullHeight * nearness;
      // EnableDepthTest against the terrain: keep only the part of the streak at or above y = 0.
      const bottom = up.y > 1e-4 ? Math.max(-halfHeight, -cy / up.y) : -halfHeight;
      if (bottom >= halfHeight) {
        continue;
      }
      const v = (halfHeight - bottom) / (2 * halfHeight);
      const base = quads * 12;
      const points = [
        [-halfWidth, bottom],
        [halfWidth, bottom],
        [halfWidth, halfHeight],
        [-halfWidth, halfHeight],
      ] as const;
      for (let k = 0; k < 4; k++) {
        out[base + k * 3] = cx + right.x * points[k][0] + up.x * points[k][1];
        out[base + k * 3 + 1] = cy + right.y * points[k][0] + up.y * points[k][1];
        out[base + k * 3 + 2] = cz + right.z * points[k][0] + up.z * points[k][1];
      }
      // Texture rows run top-down; the clipped bottom edge samples the matching row.
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
  PostInit(): void {
    this.orient(this.options.camera.getWorldQuaternion(new THREE.Quaternion()));
    for (let t = this.options.fx.lifetime; t > 0; t -= TICK_TIME) {
      this.tick();
      this.simulate(TICK_TIME);
    }
  }

  /** Advance by `dt` game seconds; `cameraQuaternion` orients the billboards. */
  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) {
      return;
    }
    this.orient(cameraQuaternion);
    this.tickRemainder = Math.min(this.tickRemainder + dt, TICK_TIME * MAX_TICKS_PER_FRAME);
    while (this.tickRemainder >= TICK_TIME) {
      this.tickRemainder -= TICK_TIME;
      this.tick();
    }
    this.simulate(dt);
    this.writeGeometry();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopRate();
    const mesh = this.mesh;
    if (mesh) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.dispose();
    }
    this.mesh = undefined;
    this.quads = undefined;
    this.root.removeFromParent();
  }
}
