import * as THREE from 'three';
import { createEffect, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import { parseKtex } from '@dontstarve-web/animation/parseKtex';
import { WORLD_SCALE } from './standardcomponents';
import { TILE_SIZE } from './tile';
import type { GroundOverlayGeometry, GroundOverlaySource } from './groundTiles';

// prefabs/snow.lua (ordinary snow; Winter's Feast is a separate source branch).
const MAX_PARTICLES = 4800;
const MIN_LIFETIME = 4.5;
const MAX_LIFETIME = 7.5;
const TICK_TIME = 1 / 30;
// A slow screen-plane fall cannot reach the view from the source's 20-metre
// emitter during its lifetime. Lower it for this perspective camera.
const EMIT_HEIGHT = 8 * WORLD_SCALE;
const EMIT_EXTENT = 20 * WORLD_SCALE;
const DRAG = 0.8;
const GRAVITY = 9.8 * WORLD_SCALE;
const COLOUR_ALPHA = 200 / 255;
// The engine's particle scale is not a DST metre. As with rain, calibrate its
// scale envelope of 1 to the scene: clearly visible flakes without near-camera discs.
const HALF_SIZE = 0.16 * WORLD_SCALE / 2;
const EDGE_BLUR_CHANCE = 0.4;
// Calibrate motion in the screen plane so camera heading cannot turn the whole
// snowfall into a diagonal stream. Retain the slow fall, with small, bounded sway.
const FALL_SPEED_SCALE = 0.1;
const unitRand = () => Math.random() * 2 - 1;

export interface SnowEffectOptions {
  scene: THREE.Scene;
  /** Mirrored DST data root, `${BASE_URL}dst/data`. */
  dataBaseUrl: string;
  getFocus: () => THREE.Vector3;
  camera: THREE.Camera;
  rate: ReadonlySignal<number>;
  /** weather.lua's snowlevel * 3, independent of whether it is still snowing. */
  cover: ReadonlySignal<number>;
  /** Ground extent in scene units. */
  groundSize: number;
  /** Map land coverage with the source terrain atlas masks, including coastal skirts. */
  groundOverlay?: GroundOverlaySource;
}

async function loadTexture(root: string, path: string, repeat = false): Promise<THREE.DataTexture> {
  const url = `${root.replace(/\/$/, '')}/${path}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load ${url}: ${response.status}`);
  const decoded = parseKtex(new Uint8Array(await response.arrayBuffer()), path);
  const texture = new THREE.DataTexture(decoded.pixels, decoded.width, decoded.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = repeat ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.generateMipmaps = repeat;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Player-following, nonpersistent `snow` FX and weather.lua's ground overlay.
 * Only presentation lives here; accumulation, melting and saves belong to Weather.
 */
export class SnowEffect {
  private readonly options: SnowEffectOptions;
  private stopRate!: () => void;
  private stopCover!: () => void;
  private readonly rate: ReadonlySignal<number>;
  private readonly cover: ReadonlySignal<number>;
  private stopGroundOverlay?: () => void;
  private mesh?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly visual = new THREE.Group();
  private ground?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial | THREE.MeshLambertMaterial[]>;
  private disposed = false;
  private particlesPerTick = 0;
  private numParticlesToEmit = 0;
  private tickRemainder = 0;
  private count = 0;
  private readonly position = new Float32Array(MAX_PARTICLES * 3);
  private readonly velocity = new Float32Array(MAX_PARTICLES);
  private readonly age = new Float32Array(MAX_PARTICLES);
  private readonly lifetime = new Float32Array(MAX_PARTICLES);
  private readonly sizeMultiplier = new Float32Array(MAX_PARTICLES);
  private readonly edgeBlur = new Uint8Array(MAX_PARTICLES);
  private readonly swayPhase = new Float32Array(MAX_PARTICLES);
  private readonly swayAmplitude = new Float32Array(MAX_PARTICLES);
  private readonly swayFrequency = new Float32Array(MAX_PARTICLES);
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly fall = new THREE.Vector3();
  private readonly cameraPoint = new THREE.Vector3();
  private focusDepth = 1;
  private readonly groundBlend = { value: new THREE.Vector3() };

  constructor(options: SnowEffectOptions) {
    this.options = options;
    // Three sorts transparent groups before their meshes' renderOrder. Give
    // snowfall its own final group so foot-sorted billboards cannot cover it.
    this.visual.name = 'SnowWeatherOverlay';
    this.visual.renderOrder = Number.MAX_SAFE_INTEGER;
    this.rate = watchSignal(options.rate, cleanup => { this.stopRate = cleanup; });
    this.cover = watchSignal(options.cover, cleanup => { this.stopCover = cleanup; });
    createEffect(() => { this.particlesPerTick = 20 * this.rate.get(); });
    createEffect(() => this.setCover(this.cover.get()));
    void this.loadParticles().catch((error: unknown) => {
      if (!this.disposed) console.error('Unable to load snow particles', error);
    });
    void this.loadGround().catch((error: unknown) => {
      if (!this.disposed) console.error('Unable to load snow ground overlay', error);
    });
  }

  private async loadParticles(): Promise<void> {
    const texture = await loadTexture(this.options.dataBaseUrl, 'fx/snow.tex');
    if (this.disposed) { texture.dispose(); return; }
    const geometry = new THREE.BufferGeometry();
    const uv = new Float32Array(MAX_PARTICLES * 8);
    const index = new Uint16Array(MAX_PARTICLES * 6);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      uv.set([0, 1, 1, 1, 1, 0, 0, 0], i * 8);
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 12), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 16), 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('snowBlur', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 4), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.setDrawRange(0, 0);
    const material = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, opacity: COLOUR_ALPHA, vertexColors: true,
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
    Object.assign(this.mesh.userData, { prefab: 'snow', persists: false, tags: ['FX'] });
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = Number.MAX_SAFE_INTEGER;
    this.visual.add(this.mesh);
    this.options.scene.add(this.visual);
    if (this.rate.peek() > 0) this.PostInit();
  }

  private async loadGround(): Promise<void> {
    const texture = await loadTexture(this.options.dataBaseUrl, 'levels/textures/snow.tex', true);
    if (this.disposed) { texture.dispose(); return; }
    // ground_overlay.ksh uses RGB as three masks, not as visible colours.
    texture.colorSpace = THREE.NoColorSpace;
    const size = this.options.groundSize;
    // Same world-space tiling as ground.ksh's existing terrain noise.
    const tileSize = TILE_SIZE * 8;
    if (!this.options.groundOverlay) {
      texture.repeat.set(size / tileSize, size / tileSize);
      texture.offset.set(-size / 2 / tileSize, -size / 2 / tileSize);
    }
    const overlay = this.options.groundOverlay?.createLandOverlay();
    const geometry = overlay?.geometry ?? new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(geometry, overlay?.atlases.length
      ? overlay.atlases.map(atlas => this.createGroundMaterial(texture, atlas)) : this.createGroundMaterial(texture));
    this.ground.name = 'SnowGroundOverlay';
    // Source overlay belongs to the ground map: above turf ([-1, -0.6)), below LAYER_BACKGROUND decor (ponds: -0.5).
    this.ground.renderOrder = -0.55;
    this.setCover(this.cover.peek());
    this.options.scene.add(this.ground);
    this.stopGroundOverlay = this.options.groundOverlay?.onTerrainChanged(() => {
      this.setGroundOverlay(this.options.groundOverlay!.createLandOverlay());
    });
  }

  private createGroundMaterial(texture: THREE.Texture, atlas?: THREE.Texture): THREE.MeshLambertMaterial {
    const material = new THREE.MeshLambertMaterial({
      map: texture, transparent: true, premultipliedAlpha: true,
      depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    });
    material.forceSinglePass = true;
    material.userData.prewarmTextures = atlas ? [atlas] : [];
    material.onBeforeCompile = shader => {
      shader.uniforms.dstSnowBlend = this.groundBlend;
      if (atlas) {
        shader.uniforms.dstSnowGroundAtlas = { value: atlas };
        shader.vertexShader = shader.vertexShader.replace('#include <common>', `
          #include <common>
          attribute vec2 groundTileUv;
          varying vec2 vSnowGroundTileUv;
        `).replace('#include <uv_vertex>', `
          #include <uv_vertex>
          vSnowGroundTileUv = groundTileUv;
        `);
      }
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
        #include <common>
        uniform vec3 dstSnowBlend;
        ${atlas ? 'uniform sampler2D dstSnowGroundAtlas; varying vec2 vSnowGroundTileUv;' : ''}
      `).replace('#include <map_fragment>', `
        ${atlas ? `
          float terrainAlpha = texture2D(dstSnowGroundAtlas, vSnowGroundTileUv).a;
          if (terrainAlpha < 0.105) discard;
        ` : 'float terrainAlpha = 1.0;'}
        vec3 snowLayers = texture2D(map, vMapUv).rgb * dstSnowBlend;
        float firstAlpha = snowLayers.b;
        float secondaryAlpha = (1.0 - firstAlpha) * snowLayers.g;
        float thirdAlpha = (1.0 - firstAlpha - secondaryAlpha) * snowLayers.r;
        diffuseColor.a *= (firstAlpha + secondaryAlpha + thirdAlpha) * terrainAlpha;
      `);
    };
    material.customProgramCacheKey = () => atlas ? 'dst-snow-ground-overlay-atlas-v1' : 'dst-snow-ground-overlay-v1';
    return material;
  }

  private setGroundOverlay(overlay: GroundOverlayGeometry): void {
    if (!this.ground) { overlay.geometry.dispose(); return; }
    const previous = Array.isArray(this.ground.material) ? this.ground.material : [this.ground.material];
    const texture = previous[0].map!;
    this.ground.geometry.dispose();
    this.ground.geometry = overlay.geometry;
    this.ground.material = overlay.atlases.length
      ? overlay.atlases.map(atlas => this.createGroundMaterial(texture, atlas)) : this.createGroundMaterial(texture);
    for (const material of previous) material.dispose();
  }

  private setCover(cover: number): void {
    this.groundBlend.value.set(
      THREE.MathUtils.clamp(cover, 0, 1),
      THREE.MathUtils.clamp(cover - 1, 0, 1),
      THREE.MathUtils.clamp(cover - 2, 0, 1),
    );
    if (!this.ground) return;
    this.ground.visible = cover > 0;
    this.ground.userData.snowCover = cover;
  }

  private tick(): void {
    const focus = this.options.getFocus();
    // snow.lua uses > 1 (rain uses > 0).
    while (this.numParticlesToEmit > 1) {
      if (this.count < MAX_PARTICLES) {
        const i = this.count++;
        this.position.set([focus.x + EMIT_EXTENT * unitRand(), focus.y + EMIT_HEIGHT, focus.z + EMIT_EXTENT * unitRand()], i * 3);
        this.velocity[i] = 0;
        this.age[i] = 0;
        // Source UnitRand is [-1, 1], including in its lifetime expression.
        this.lifetime[i] = MIN_LIFETIME + (MAX_LIFETIME - MIN_LIFETIME) * unitRand();
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
    const decay = Math.exp(-DRAG * dt);
    const terminal = GRAVITY / DRAG;
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
      const distance = (terminal * dt + delta * (1 - decay) / DRAG) * FALL_SPEED_SCALE * scale;
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
    for (let t = 0; t < MAX_LIFETIME; t += TICK_TIME) {
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
    this.stopCover();
    this.stopGroundOverlay?.();
    this.stopGroundOverlay = undefined;
    for (const mesh of [this.mesh, this.ground]) {
      if (!mesh) continue;
      mesh.removeFromParent();
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const texture of new Set(materials.map(material => material.map))) texture?.dispose();
      for (const material of materials) material.dispose();
    }
    this.mesh = undefined;
    this.ground = undefined;
    this.visual.removeFromParent();
  }
}
