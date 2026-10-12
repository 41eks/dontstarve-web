import * as THREE from 'three';
import { parseKtex } from '@dontstarve-web/animation/parseKtex';
import { WORLD_SCALE } from './standardcomponents';

// torchfire.lua: two VFX emitters (smoke, fire) on an entity that follows the holder's swap_object symbol.
const SMOKE_TEXTURE = 'fx/smoke.tex';
const FIRE_TEXTURE = 'fx/torchfire.tex';
const TICK_TIME = 1 / 30;
const MAX_TICKS_PER_FRAME = 10;
const MAX_PARTICLES = 64;
const FRAME_WIDTH = 0.25;
/** torchfire.lua master_postinit: fx_offset is the FollowSymbol y offset, in animation pixels (y grows down). */
export const TORCH_FIRE_OFFSET_Y = -110;
// vfx sort order 0 draws after the world's foot-sorted billboards; the offsets order smoke below fire.
const RENDER_ORDER = 1_000_000;
/** The engine's particle scale unit is not world units (see rain.ts); calibrated by eye like it. */
const SCALE_FACTOR = 0.8;

type Colour = readonly [number, number, number, number];
type Stop<T> = readonly [number, T];

const int = (r: number, g: number, b: number, a: number): Colour => [r / 255, g / 255, b / 255, a / 255];

interface EmitterSpec {
  readonly texture: string;
  readonly lifetime: number;
  readonly particlesPerSecond: number;
  /** Negative values delay the first emission, like smoke_num_particles_to_emit = -50. */
  readonly initialCount: number;
  readonly velocityY: number;
  readonly premultiplied: boolean;
  readonly renderOrder: number;
  readonly colour: readonly Stop<Colour>[];
  readonly scale: readonly Stop<readonly [number, number]>[];
}

const SMOKE_MAX_SCALE = 1.25;
const FIRE_MAX_SCALE = 3;
const EMITTERS: readonly EmitterSpec[] = [{
  texture: SMOKE_TEXTURE, lifetime: 0.7, particlesPerSecond: 80, initialCount: -50, velocityY: 0.05,
  premultiplied: true, renderOrder: RENDER_ORDER + 1,
  colour: [[0, int(35, 32, 30, 0)], [0.3, int(35, 32, 30, 100)], [0.55, int(30, 30, 30, 28)], [1, int(30, 30, 30, 0)]],
  scale: [[0, [SMOKE_MAX_SCALE * 0.4, SMOKE_MAX_SCALE * 0.4]], [0.5, [SMOKE_MAX_SCALE * 0.6, SMOKE_MAX_SCALE * 0.6]],
    [0.65, [SMOKE_MAX_SCALE * 0.9, SMOKE_MAX_SCALE * 0.9]], [1, [SMOKE_MAX_SCALE, SMOKE_MAX_SCALE]]],
}, {
  texture: FIRE_TEXTURE, lifetime: 0.3, particlesPerSecond: 40, initialCount: 1, velocityY: 0,
  premultiplied: false, renderOrder: RENDER_ORDER + 2,
  colour: [[0, int(187, 111, 60, 128)], [0.49, int(187, 111, 60, 128)], [0.5, int(255, 255, 0, 128)],
    [0.51, int(255, 30, 56, 128)], [0.75, int(255, 30, 56, 128)], [1, int(255, 7, 28, 0)]],
  scale: [[0, [FIRE_MAX_SCALE * 0.5, FIRE_MAX_SCALE]], [1, [FIRE_MAX_SCALE * 0.25, FIRE_MAX_SCALE * 0.5]]],
}];

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
  private readonly spec: EmitterSpec;
  private readonly position = new Float32Array(MAX_PARTICLES * 3);
  private readonly age = new Float32Array(MAX_PARTICLES);
  private readonly lifetime = new Float32Array(MAX_PARTICLES);
  private readonly uvOffset = new Float32Array(MAX_PARTICLES);
  private count = 0;
  private toEmit: number;

  constructor(spec: EmitterSpec, texture: THREE.Texture) {
    this.spec = spec;
    this.toEmit = spec.initialCount;
    const geometry = new THREE.BufferGeometry();
    const corners = new Float32Array(MAX_PARTICLES * 8);
    const index = new Uint16Array(MAX_PARTICLES * 6);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      corners.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8);
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const dynamic = (size: number) => new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 4 * size), size)
      .setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', dynamic(3));
    geometry.setAttribute('uv', dynamic(2));
    geometry.setAttribute('tint', dynamic(4));
    geometry.setAttribute('size', dynamic(2));
    geometry.setAttribute('corner', new THREE.BufferAttribute(corners, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture } }, vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER,
      defines: spec.premultiplied ? { PREMULTIPLIED: '' } : {}, transparent: true, depthWrite: false,
      side: THREE.DoubleSide,
      ...(spec.premultiplied
        ? { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }
        : { blending: THREE.AdditiveBlending }),
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = spec.texture === FIRE_TEXTURE ? 'torchfire' : 'torchfire_smoke';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = spec.renderOrder;
  }

  /** torchfire.lua emit_fn: a particle inside CreateSphereEmitter(.05) around the emitter. */
  private emit(origin: THREE.Vector3): void {
    if (this.count >= MAX_PARTICLES) return;
    const i = this.count++;
    let x: number, y: number, z: number;
    do { x = unitRand(); y = unitRand(); z = unitRand(); } while (x * x + y * y + z * z > 1);
    const radius = 0.05 * WORLD_SCALE;
    this.position.set([origin.x + x * radius, origin.y + y * radius, origin.z + z * radius], i * 3);
    this.age[i] = 0;
    this.lifetime[i] = this.spec.lifetime * (0.9 + unitRand() * 0.1);
    this.uvOffset[i] = Math.floor(Math.random() * 4) * FRAME_WIDTH;
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
          this.age[i] = this.age[last];
          this.lifetime[i] = this.lifetime[last];
          this.uvOffset[i] = this.uvOffset[last];
        }
        continue;
      }
      this.position[i * 3 + 1] += this.spec.velocityY * WORLD_SCALE * dt;
      i++;
    }
  }

  write(): void {
    const geometry = this.mesh.geometry;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const tint = geometry.getAttribute('tint') as THREE.BufferAttribute;
    const size = geometry.getAttribute('size') as THREE.BufferAttribute;
    for (let i = 0; i < this.count; i++) {
      const life = this.age[i] / this.lifetime[i];
      const colour = sample(this.spec.colour, life);
      const [width, height] = sample(this.spec.scale, life);
      for (let k = 0; k < 4; k++) {
        const v = i * 4 + k;
        position.setXYZ(v, this.position[i * 3], this.position[i * 3 + 1], this.position[i * 3 + 2]);
        const right = k === 1 || k === 2;
        uv.setXY(v, this.uvOffset[i] + (right ? FRAME_WIDTH : 0), k < 2 ? 1 : 0);
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

const textures = new Map<string, Promise<THREE.DataTexture>>();

function loadTexture(dataBaseUrl: string, path: string): Promise<THREE.DataTexture> {
  const url = `${dataBaseUrl.replace(/\/$/, '')}/${path}`;
  let request = textures.get(url);
  if (!request) {
    request = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Unable to load ${url}: ${response.status}`);
      const decoded = parseKtex(new Uint8Array(await response.arrayBuffer()), path);
      const texture = new THREE.DataTexture(decoded.pixels, decoded.width, decoded.height, THREE.RGBAFormat);
      // The engine blends texel values directly; no sRGB decode.
      texture.flipY = false;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      return texture;
    })();
    textures.set(url, request);
    void request.catch(() => textures.delete(url));
  }
  return request;
}

/**
 * torchfire.lua: smoke and flame particles emitted at its follower node, i.e. the holder's
 * `swap_object` symbol. Particles keep their world position after emission, so they trail a moving holder.
 */
export class TorchFireEffect {
  private readonly follower: THREE.Object3D;
  private readonly emitters: Emitter[] = [];
  private readonly origin = new THREE.Vector3();
  private tickRemainder = 0;
  private disposed = false;

  constructor(follower: THREE.Object3D, dataBaseUrl: string) {
    this.follower = follower;
    void Promise.all(EMITTERS.map(async (spec) => [spec, await loadTexture(dataBaseUrl, spec.texture)] as const))
      .then((loaded) => {
        if (this.disposed) return;
        for (const [spec, texture] of loaded) {
          const emitter = new Emitter(spec, texture);
          this.emitters.push(emitter);
          this.follower.add(emitter.mesh);
        }
      }, (error: unknown) => {
        if (!this.disposed) console.error('Unable to load torch fire', error);
      });
  }

  update(dt: number): void {
    (globalThis as any).__tf = ((globalThis as any).__tf ?? 0) + 1;
    if (this.disposed || !Number.isFinite(dt) || dt <= 0 || !this.emitters.length) return;
    this.follower.updateWorldMatrix(true, false);
    this.origin.setFromMatrixPosition(this.follower.matrixWorld);
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

  /** inst:Remove(): the particles leave with the entity. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const emitter of this.emitters) emitter.dispose();
    this.emitters.length = 0;
  }
}
