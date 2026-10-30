import * as THREE from 'three';

type Colour = readonly [number, number, number, number];
type Stop<T> = readonly [number, T];

/**
 * One emitter of an entity's VFXEffect, as a prefab sets it up in Lua (InitEmitters, SetRenderResources, envelopes,
 * blend mode, UV frames, sort offset) together with its EmitterManager tick and emit_fn. Lengths are in DST units.
 */
export interface VfxEmitterJson {
  /** SetRenderResources texture, below `dst/data`. */
  readonly texture: string;
  readonly maxParticles: number;
  readonly maxLifetime: number;
  readonly blendMode: 'premultiplied' | 'additive';
  /** SetUVFrameSize: a particle shows one random column of frames this wide. */
  readonly uvFrameWidth: number;
  readonly sortOffset: number;
  readonly colourEnvelope: readonly Stop<Colour>[];
  readonly scaleEnvelope: readonly Stop<readonly [number, number]>[];
  /** The EmitterManager tick adds this many particles per second to its counter. */
  readonly particlesPerSecond: number;
  /** The counter's start; a negative value delays the first emission. */
  readonly initialCount: number;
  /** emit_fn: CreateSphereEmitter radius around the emitter. */
  readonly sphereRadius: number;
  /** emit_fn: velocity = base + spread * UnitRand() per axis, in DST units per second. */
  readonly velocity: readonly [number, number, number];
  readonly velocitySpread: readonly [number, number, number];
  /** emit_fn: lifetime = maxLifetime * (base + spread * UnitRand()). */
  readonly lifetime: readonly [number, number];
}

/** An entity's VFXEffect; the display loads the textures, draws and simulates the particles. */
export interface VfxJson {
  readonly emitters: readonly VfxEmitterJson[];
}

/** Project world units per DST unit: a 12-unit tile is TILE_SCALE 4 DST units. */
const WORLD_SCALE = 12 / 4;
const TICK_TIME = 1 / 30;
const MAX_TICKS_PER_FRAME = 10;
// VFX sort order 0 draws after the world's foot-sorted billboards; sort offsets order the emitters.
const RENDER_ORDER = 1_000_000;
/** The engine's particle scale unit is not world units; calibrated by eye. */
const SCALE_FACTOR = 0.8;

const VERTEX_SHADER = /* glsl */`
  attribute vec2 corner;
  attribute vec4 tint;
  attribute vec2 size;
  varying vec2 vUv;
  varying vec4 vTint;
  void main() {
    vUv = uv;
    vTint = tint;
    // Positions are world-space, so the mesh may be parented anywhere; billboards face the camera.
    vec4 view = viewMatrix * vec4(position, 1.0);
    view.xy += corner * size * 0.5;
    gl_Position = projectionMatrix * view;
  }
`;
const FRAGMENT_SHADER = /* glsl */`
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec4 vTint;
  void main() {
    vec4 texel = texture2D(map, vUv);
  #ifdef PREMULTIPLIED
    // The texture is straight alpha; the blend equation expects premultiplied output.
    gl_FragColor = vec4(texel.rgb * texel.a * vTint.rgb * vTint.a, texel.a * vTint.a);
  #else
    gl_FragColor = vec4(texel.rgb * vTint.rgb, texel.a * vTint.a);
  #endif
  }
`;

function sample<T extends readonly number[]>(stops: readonly Stop<T>[], t: number): number[] {
  for (let i = 1; i < stops.length; i++) {
    const [t1, v1] = stops[i];
    if (t > t1 && i < stops.length - 1) continue;
    const [t0, v0] = stops[i - 1];
    const k = THREE.MathUtils.clamp((t - t0) / (t1 - t0), 0, 1);
    return v0.map((value, axis) => value + (v1[axis] - value) * k);
  }
  return [...stops[0][1]];
}

const unitRand = () => Math.random() * 2 - 1;

class Emitter {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly spec: VfxEmitterJson;
  private readonly position: Float32Array;
  private readonly velocity: Float32Array;
  private readonly age: Float32Array;
  private readonly lifetime: Float32Array;
  private readonly uvOffset: Float32Array;
  private count = 0;
  private toEmit: number;

  constructor(spec: VfxEmitterJson, texture: THREE.Texture) {
    this.spec = spec;
    const max = spec.maxParticles;
    this.position = new Float32Array(max * 3); this.velocity = new Float32Array(max * 3);
    this.age = new Float32Array(max); this.lifetime = new Float32Array(max); this.uvOffset = new Float32Array(max);
    this.toEmit = spec.initialCount;
    const geometry = new THREE.BufferGeometry();
    const corners = new Float32Array(max * 8);
    const index = new Uint16Array(max * 6);
    for (let i = 0; i < max; i++) {
      corners.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8);
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const dynamic = (size: number) => new THREE.BufferAttribute(new Float32Array(max * 4 * size), size)
      .setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', dynamic(3));
    geometry.setAttribute('uv', dynamic(2));
    geometry.setAttribute('tint', dynamic(4));
    geometry.setAttribute('size', dynamic(2));
    geometry.setAttribute('corner', new THREE.BufferAttribute(corners, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.setDrawRange(0, 0);
    const premultiplied = spec.blendMode === 'premultiplied';
    const material = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture } }, vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER,
      defines: premultiplied ? { PREMULTIPLIED: '' } : {}, transparent: true, depthWrite: false,
      side: THREE.DoubleSide,
      ...(premultiplied
        ? { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }
        : { blending: THREE.AdditiveBlending }),
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = spec.texture;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = RENDER_ORDER + spec.sortOffset;
  }

  /** emit_fn: AddParticleUV inside the sphere emitter, with a random UV frame column. */
  private emit(origin: THREE.Vector3): void {
    const { spec } = this;
    if (this.count >= spec.maxParticles) return;
    const i = this.count++;
    let x: number, y: number, z: number;
    do { x = unitRand(); y = unitRand(); z = unitRand(); } while (x * x + y * y + z * z > 1);
    const radius = spec.sphereRadius * WORLD_SCALE;
    this.position.set([origin.x + x * radius, origin.y + y * radius, origin.z + z * radius], i * 3);
    for (let axis = 0; axis < 3; axis++) {
      this.velocity[i * 3 + axis] = (spec.velocity[axis] + spec.velocitySpread[axis] * unitRand()) * WORLD_SCALE;
    }
    this.age[i] = 0;
    this.lifetime[i] = spec.maxLifetime * (spec.lifetime[0] + spec.lifetime[1] * unitRand());
    this.uvOffset[i] = Math.floor(Math.random() * Math.round(1 / spec.uvFrameWidth)) * spec.uvFrameWidth;
  }

  tick(origin: THREE.Vector3): void {
    while (this.toEmit > 1) {
      this.emit(origin);
      this.toEmit -= 1;
    }
    this.toEmit += this.spec.particlesPerSecond * TICK_TIME;
  }

  simulate(dt: number): void {
    for (let i = 0; i < this.count;) {
      if ((this.age[i] += dt) >= this.lifetime[i]) {
        const last = --this.count;
        if (i !== last) {
          this.position.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.velocity.copyWithin(i * 3, last * 3, last * 3 + 3);
          this.age[i] = this.age[last];
          this.lifetime[i] = this.lifetime[last];
          this.uvOffset[i] = this.uvOffset[last];
        }
        continue;
      }
      for (let axis = 0; axis < 3; axis++) this.position[i * 3 + axis] += this.velocity[i * 3 + axis] * dt;
      i++;
    }
  }

  write(): void {
    const { geometry } = this.mesh, { spec } = this;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const tint = geometry.getAttribute('tint') as THREE.BufferAttribute;
    const size = geometry.getAttribute('size') as THREE.BufferAttribute;
    for (let i = 0; i < this.count; i++) {
      const life = this.age[i] / this.lifetime[i];
      const colour = sample(spec.colourEnvelope, life);
      const [width, height] = sample(spec.scaleEnvelope, life);
      for (let k = 0; k < 4; k++) {
        const v = i * 4 + k;
        position.setXYZ(v, this.position[i * 3], this.position[i * 3 + 1], this.position[i * 3 + 2]);
        const right = k === 1 || k === 2;
        uv.setXY(v, this.uvOffset[i] + (right ? spec.uvFrameWidth : 0), k < 2 ? 1 : 0);
        tint.setXYZW(v, colour[0], colour[1], colour[2], colour[3]);
        size.setXY(v, width * SCALE_FACTOR * WORLD_SCALE, height * SCALE_FACTOR * WORLD_SCALE);
      }
    }
    for (const attribute of [position, uv, tint, size]) attribute.needsUpdate = true;
    geometry.setDrawRange(0, this.count * 6);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/**
 * A declared VFXEffect drawn at `node`. Particles keep their world position after emission, so they trail a moving
 * emitter; they leave with it, as on inst:Remove().
 */
export class VfxEffect {
  private readonly node: THREE.Object3D;
  private readonly emitters: Emitter[];
  private readonly origin = new THREE.Vector3();
  private tickRemainder = 0;

  constructor(node: THREE.Object3D, vfx: VfxJson, textures: readonly THREE.Texture[]) {
    this.node = node;
    this.emitters = vfx.emitters.map((spec, i) => new Emitter(spec, textures[i]));
    for (const emitter of this.emitters) node.add(emitter.mesh);
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.node.updateWorldMatrix(true, false);
    this.origin.setFromMatrixPosition(this.node.matrixWorld);
    this.tickRemainder = Math.min(this.tickRemainder + dt, TICK_TIME * MAX_TICKS_PER_FRAME);
    while (this.tickRemainder >= TICK_TIME) {
      this.tickRemainder -= TICK_TIME;
      for (const emitter of this.emitters) emitter.tick(this.origin);
    }
    for (const emitter of this.emitters) {
      emitter.simulate(dt);
      emitter.write();
    }
  }

  dispose(): void {
    for (const emitter of this.emitters) emitter.dispose();
    this.emitters.length = 0;
  }
}
