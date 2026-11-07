import * as THREE from 'three';
import { createEffect, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import { WORLD_SCALE } from '@dontstarve-web/animation/units';
import { loadGroundTexture } from './groundAssets';

/** A snowfall emitter as a prefab declares it in Lua (VFXEffect settings plus its emit_fn and EmitterManager tick).
 * Lengths are in DST units. */
export interface SnowfallJson {
  /** SetRenderResources texture, below `dst/data`. */
  readonly texture: string;
  readonly maxParticles: number;
  /** emit_fn: lifetime = min + (max - min) * UnitRand(). */
  readonly minLifetime: number;
  readonly maxLifetime: number;
  /** CreateBoxEmitter half extent around the focus on X and Z. */
  readonly emitExtent: number;
  readonly drag: number;
  /** SetAcceleration's downward component. */
  readonly gravity: number;
  /** The colour envelope's alpha. */
  readonly colourAlpha: number;
  /** particles_per_tick at a precipitation rate of 1. */
  readonly particlesPerTick: number;
}

export interface SnowfallOptions {
  /** The emitter entity's transform root; the display mounts it in `scene` once the art loads. */
  root: THREE.Object3D;
  scene: THREE.Object3D;
  /** Mirrored DST data root, `${BASE_URL}dst/data`. */
  dataBaseUrl: string;
  fx: SnowfallJson;
  getFocus: () => THREE.Vector3;
  camera: THREE.Camera;
  rate: ReadonlySignal<number>;
}

const TICK_TIME = 1 / 30;
// A slow screen-plane fall cannot reach the view from the source's 20-metre
// emitter during its lifetime. Lower it for this perspective camera.
const EMIT_HEIGHT = 8 * WORLD_SCALE;
// The engine's particle scale is not a DST metre. As with rain, calibrate its
// scale envelope of 1 to the scene: clearly visible flakes without near-camera discs.
const HALF_SIZE = 0.16 * WORLD_SCALE / 2;
const EDGE_BLUR_CHANCE = 0.4;
// Calibrate motion in the screen plane so camera heading cannot turn the whole
// snowfall into a diagonal stream. Retain the slow fall, with small, bounded sway.
const FALL_SPEED_SCALE = 0.1;
const unitRand = () => Math.random() * 2 - 1;

/** Draws and simulates a declared snowfall emitter that follows the focus. */
export class Snowfall {
  private readonly options: SnowfallOptions;
  private readonly root: THREE.Object3D;
  private readonly rate: ReadonlySignal<number>;
  private stopRate!: () => void;
  private mesh?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private disposed = false;
  private particlesPerTick = 0;
  private numParticlesToEmit = 0;
  private tickRemainder = 0;
  private count = 0;
  private readonly position: Float32Array;
  private readonly velocity: Float32Array;
  private readonly age: Float32Array;
  private readonly lifetime: Float32Array;
  private readonly sizeMultiplier: Float32Array;
  private readonly edgeBlur: Uint8Array;
  private readonly swayPhase: Float32Array;
  private readonly swayAmplitude: Float32Array;
  private readonly swayFrequency: Float32Array;
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly fall = new THREE.Vector3();
  private readonly cameraPoint = new THREE.Vector3();
  private focusDepth = 1;

  constructor(options: SnowfallOptions) {
    this.options = options;
    this.root = options.root;
    const max = options.fx.maxParticles;
    this.position = new Float32Array(max * 3);
    this.velocity = new Float32Array(max); this.age = new Float32Array(max); this.lifetime = new Float32Array(max);
    this.sizeMultiplier = new Float32Array(max); this.edgeBlur = new Uint8Array(max);
    this.swayPhase = new Float32Array(max); this.swayAmplitude = new Float32Array(max); this.swayFrequency = new Float32Array(max);
    // Three sorts transparent groups before their meshes' renderOrder. Give
    // snowfall its own final group so foot-sorted billboards cannot cover it.
    this.root.name = 'SnowWeatherOverlay';
    this.root.renderOrder = Number.MAX_SAFE_INTEGER;
    this.rate = watchSignal(options.rate, cleanup => { this.stopRate = cleanup; });
    createEffect(() => { this.particlesPerTick = options.fx.particlesPerTick * this.rate.get(); });
    void this.loadParticles().catch((error: unknown) => {
      if (!this.disposed) console.error('Unable to load snow particles', error);
    });
  }

  private async loadParticles(): Promise<void> {
    const { fx } = this.options;
    const texture = await loadGroundTexture(this.options.dataBaseUrl, fx.texture, false);
    if (this.disposed) { texture.dispose(); return; }
    const geometry = new THREE.BufferGeometry();
    const uv = new Float32Array(fx.maxParticles * 8);
    const index = new Uint16Array(fx.maxParticles * 6);
    for (let i = 0; i < fx.maxParticles; i++) {
      uv.set([0, 1, 1, 1, 1, 0, 0, 0], i * 8);
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fx.maxParticles * 12), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(fx.maxParticles * 16), 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('snowBlur', new THREE.BufferAttribute(new Float32Array(fx.maxParticles * 4), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.setDrawRange(0, 0);
    const material = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, opacity: fx.colourAlpha, vertexColors: true,
      premultipliedAlpha: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false,
    });
    material.forceSinglePass = true;
    material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `
        #include <common>
        attribute float snowBlur;
        varying float vSnowBlur;
        varying vec2 vSnowScreenPosition;
      `).replace('#include <project_vertex>', `
        #include <project_vertex>
        vSnowBlur = snowBlur;
        vSnowScreenPosition = gl_Position.xy / gl_Position.w;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
        #include <common>
        varying float vSnowBlur;
        varying vec2 vSnowScreenPosition;
      `).replace('#include <map_fragment>', `
        vec4 snowTexel = texture2D(map, vMapUv);
        float screenEdge = max(abs(vSnowScreenPosition.x), abs(vSnowScreenPosition.y));
        float softness = vSnowBlur * smoothstep(0.65, 0.95, screenEdge);
        float radius = length(vMapUv - vec2(0.5)) * 2.0;
        float softAlpha = 1.0 - smoothstep(0.45, 1.0, radius);
        snowTexel.a *= mix(1.0, softAlpha, softness);
        diffuseColor *= snowTexel;
      `);
    };
    material.customProgramCacheKey = () => 'dst-snow-edge-blur-v1';
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'snow';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = Number.MAX_SAFE_INTEGER;
    this.root.add(this.mesh);
    this.options.scene.add(this.root);
    if (this.rate.peek() > 0) this.PostInit();
  }

  private tick(): void {
    const focus = this.options.getFocus();
    const { fx } = this.options;
    // snow.lua uses > 1 (rain uses > 0).
    const extent = fx.emitExtent * WORLD_SCALE;
    while (this.numParticlesToEmit > 1) {
      if (this.count < fx.maxParticles) {
        const i = this.count++;
        this.position.set([focus.x + extent * unitRand(), focus.y + EMIT_HEIGHT, focus.z + extent * unitRand()], i * 3);
        this.velocity[i] = 0;
        this.age[i] = 0;
        // Source UnitRand is [-1, 1], including in its lifetime expression.
        this.lifetime[i] = fx.minLifetime + (fx.maxLifetime - fx.minLifetime) * unitRand();
        // Sample appearance once per lifetime, including when the pool compacts.
        this.sizeMultiplier[i] = 1 + Math.random();
        this.edgeBlur[i] = Math.random() < EDGE_BLUR_CHANCE ? 1 : 0;
        this.swayPhase[i] = Math.random() * Math.PI * 2;
        this.swayAmplitude[i] = (0.06 + Math.random() * 0.06) * WORLD_SCALE;
        this.swayFrequency[i] = Math.PI * 2 / (3 + Math.random() * 3);
      }
      this.numParticlesToEmit -= 1;
    }
    this.numParticlesToEmit += this.particlesPerTick;
  }

  private simulate(dt: number): void {
    const { drag } = this.options.fx;
    const decay = Math.exp(-drag * dt);
    const terminal = this.options.fx.gravity * WORLD_SCALE / drag;
    const matrix = this.options.camera.matrixWorldInverse.elements;
    for (let i = 0; i < this.count;) {
      const previousAge = this.age[i];
      if ((this.age[i] += dt) >= this.lifetime[i]) {
        const last = --this.count;
        if (i !== last) {
          this.position.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.velocity[i] = this.velocity[last];
          this.age[i] = this.age[last];
          this.lifetime[i] = this.lifetime[last];
          this.sizeMultiplier[i] = this.sizeMultiplier[last];
          this.edgeBlur[i] = this.edgeBlur[last];
          this.swayPhase[i] = this.swayPhase[last];
          this.swayAmplitude[i] = this.swayAmplitude[last];
          this.swayFrequency[i] = this.swayFrequency[last];
        }
        continue;
      }
      // Integrate gravity/drag independently of frame rate. Perspective scales
      // motion like size, keeping near-camera snow from racing across the view.
      const base = i * 3;
      const depth = -(matrix[2] * this.position[base] + matrix[6] * this.position[base + 1]
        + matrix[10] * this.position[base + 2] + matrix[14]);
      const scale = Math.max(0, Math.min(1, depth / this.focusDepth));
      const delta = this.velocity[i] - terminal;
      const distance = (terminal * dt + delta * (1 - decay) / drag) * FALL_SPEED_SCALE * scale;
      // Ease sway in with falling speed; new flakes should not start by sliding sideways.
      const swayRamp = 1 + delta * (1 + decay) / (2 * terminal);
      this.velocity[i] = terminal + delta * decay;
      const phase = this.swayPhase[i], frequency = this.swayFrequency[i];
      const sway = this.swayAmplitude[i] * scale * swayRamp
        * (Math.sin(phase + this.age[i] * frequency) - Math.sin(phase + previousAge * frequency));
      this.position[base] += this.fall.x * distance + this.right.x * sway;
      this.position[base + 1] += this.fall.y * distance + this.right.y * sway;
      this.position[base + 2] += this.fall.z * distance + this.right.z * sway;
      i++;
    }
  }

  private writeGeometry(cameraQuaternion: THREE.Quaternion): void {
    if (!this.mesh) return;
    this.orient(cameraQuaternion);
    const position = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const color = this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const blur = this.mesh.geometry.getAttribute('snowBlur') as THREE.BufferAttribute;
    const vertices = position.array as Float32Array, colors = color.array as Float32Array;
    const blurValues = blur.array as Float32Array;
    const camera = this.options.camera;
    let quads = 0;
    for (let i = 0; i < this.count; i++) {
      const x = this.position[i * 3], y = this.position[i * 3 + 1], z = this.position[i * 3 + 2];
      // Terrain has depthWrite=false to preserve billboard feet. Clip falling FX at its surface.
      const halfSize = HALF_SIZE * this.sizeMultiplier[i];
      if (y < halfSize) continue;
      // Prevent near-camera flakes becoming large white discs while zooming or turning.
      const depth = -this.cameraPoint.set(x, y, z).applyMatrix4(camera.matrixWorldInverse).z;
      if (depth <= 0) continue;
      const scale = halfSize * Math.min(1, depth / this.focusDepth);
      const fade = Math.min(1, (1 - this.age[i] / this.lifetime[i]) / 0.1);
      for (let k = 0; k < 4; k++) {
        const h = k === 0 || k === 3 ? -1 : 1;
        const v = k < 2 ? -1 : 1;
        const offset = quads * 12 + k * 3;
        vertices[offset] = x + (h * this.right.x + v * this.up.x) * scale;
        vertices[offset + 1] = y + (h * this.right.y + v * this.up.y) * scale;
        vertices[offset + 2] = z + (h * this.right.z + v * this.up.z) * scale;
        const colorOffset = quads * 16 + k * 4;
        colors[colorOffset] = colors[colorOffset + 1] = colors[colorOffset + 2] = 1;
        colors[colorOffset + 3] = fade;
        blurValues[quads * 4 + k] = this.edgeBlur[i];
      }
      quads++;
    }
    for (const [attribute, length] of [[position, quads * 12], [color, quads * 16], [blur, quads * 4]] as const) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, length);
      attribute.needsUpdate = true;
    }
    this.mesh.geometry.setDrawRange(0, quads * 6);
  }

  private orient(cameraQuaternion: THREE.Quaternion): void {
    this.right.set(1, 0, 0).applyQuaternion(cameraQuaternion);
    this.up.set(0, 1, 0).applyQuaternion(cameraQuaternion);
    this.fall.copy(this.up).negate();
    this.focusDepth = Math.max(1e-6,
      -this.cameraPoint.copy(this.options.getFocus()).applyMatrix4(this.options.camera.matrixWorldInverse).z);
  }

  /** weather.lua calls snow.lua PostInit on a snowy load to populate existing flakes. */
  PostInit(): void {
    this.orient(this.options.camera.getWorldQuaternion(new THREE.Quaternion()));
    for (let t = 0; t < this.options.fx.maxLifetime; t += TICK_TIME) {
      this.tick();
      this.simulate(TICK_TIME);
    }
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    if (this.disposed || !this.mesh || !Number.isFinite(dt) || dt <= 0) return;
    this.orient(cameraQuaternion);
    // Emission and simulation share the 30 Hz source ticks. Keep particles' age
    // correct on long frames instead of emitting a whole frame's backlog at once.
    let remaining = dt;
    while (remaining > 0) {
      const step = Math.min(remaining, TICK_TIME - this.tickRemainder);
      this.simulate(step);
      this.tickRemainder += step;
      remaining -= step;
      if (this.tickRemainder >= TICK_TIME - 1e-9) {
        this.tickRemainder = 0;
        this.tick();
      }
    }
    this.writeGeometry(cameraQuaternion);
  }

  dispose(): void {
    if (this.disposed) return;
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
    this.root.removeFromParent();
  }
}
