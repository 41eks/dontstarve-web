import * as THREE from 'three';
import { parseKtex } from '@dontstarve-web/animation/parseKtex';
import { DstLocalLighting } from './dstLocalLighting';

export type DstSeason = 'autumn' | 'winter' | 'spring' | 'summer';
export type DstLightPhase = 'day' | 'dusk' | 'night' | 'full_moon';

declare global {
  interface WindowEventMap {
    'game:lighting-ready': CustomEvent<DstLightingRenderer>;
  }
}

const DAY_AMBIENT = new THREE.Vector3(255 / 255, 230 / 255, 158 / 255);
const SPRING_DAY_AMBIENT = new THREE.Vector3(255 / 255, 244 / 255, 213 / 255);
const DUSK_AMBIENT = new THREE.Vector3(150 / 255, 150 / 255, 150 / 255);
const SPRING_DUSK_AMBIENT = new THREE.Vector3(171 / 255, 146 / 255, 147 / 255);
const NIGHT_AMBIENT = new THREE.Vector3(0, 0, 0);
const FULL_MOON_AMBIENT = new THREE.Vector3(84 / 255, 122 / 255, 156 / 255);

const PHASE_BLEND_SECONDS: Record<DstLightPhase, number> = {
  day: 4,
  dusk: 6,
  night: 8,
  full_moon: 8,
};

const SEASON_BLEND_SECONDS = 10;
const SANITY_GRADING_STEPS = 10;
// postprocess_distort.ksh's orbit repeats every 2π / TIME_SCALE seconds.
const DISTORTION_PERIOD = Math.PI * 2 / 50;

const LUT_PATHS: Record<DstSeason, Record<DstLightPhase, string>> = {
  autumn: {
    day: 'day05_cc.tex',
    dusk: 'dusk03_cc.tex',
    night: 'night03_cc.tex',
    full_moon: 'purple_moon_cc.tex',
  },
  winter: {
    day: 'snow_cc.tex',
    dusk: 'snowdusk_cc.tex',
    night: 'night04_cc.tex',
    full_moon: 'purple_moon_cc.tex',
  },
  spring: {
    day: 'spring_day_cc.tex',
    dusk: 'spring_dusk_cc.tex',
    // DST deliberately uses its dusk cube for spring nights.
    night: 'spring_dusk_cc.tex',
    full_moon: 'purple_moon_cc.tex',
  },
  summer: {
    day: 'summer_day_cc.tex',
    dusk: 'summer_dusk_cc.tex',
    night: 'summer_night_cc.tex',
    full_moon: 'purple_moon_cc.tex',
  },
};

// components/colourcube.lua: insanity uses the night cube during full moons.
const INSANITY_LUT_PATHS: Record<DstLightPhase, string> = {
  day: 'insane_day_cc.tex',
  dusk: 'insane_dusk_cc.tex',
  night: 'insane_night_cc.tex',
  full_moon: 'insane_night_cc.tex',
};

const DAY_WEATHER_RANGE: Record<DstSeason, number> = {
  autumn: 0.4,
  winter: 0.05,
  spring: 0.4,
  summer: 0.3,
};

const NIGHT_WEATHER_RANGE: Record<DstSeason, number> = {
  autumn: 0.25,
  winter: 0,
  spring: 0.25,
  summer: 0.2,
};

function ambientFor(season: DstSeason, phase: DstLightPhase): THREE.Vector3 {
  if (phase === 'full_moon') return FULL_MOON_AMBIENT;
  if (phase === 'night') return NIGHT_AMBIENT;
  if (phase === 'dusk') return season === 'spring' ? SPRING_DUSK_AMBIENT : DUSK_AMBIENT;
  return season === 'spring' ? SPRING_DAY_AMBIENT : DAY_AMBIENT;
}

/**
 * DST's weather component dims the current ambient colour rather than adding a
 * second light. `precipitation` is a normalized stand-in for its moisture
 * progress, with the same active-precipitation quadratic curve.
 */
export function calculateDstWeatherLight(
  season: DstSeason,
  phase: DstLightPhase,
  precipitation: number,
  snow = false,
): number {
  const amount = THREE.MathUtils.clamp(precipitation, 0, 1);
  if (amount === 0) return 1;
  const rangeSeason = snow ? 'winter' : season;
  const dynamicRange = phase === 'day'
    ? DAY_WEATHER_RANGE[rangeSeason]
    : NIGHT_WEATHER_RANGE[rangeSeason];
  const remainingLight = 1 - amount;
  return remainingLight * remainingLight * dynamicRange + 1 - dynamicRange;
}

async function loadLut(root: string, path: string): Promise<THREE.DataTexture> {
  const url = `${root.replace(/\/$/, '')}/${path}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load DST colour cube ${url}: HTTP ${response.status}`);
  const decoded = parseKtex(new Uint8Array(await response.arrayBuffer()), path);
  if (decoded.width !== decoded.height * decoded.height) {
    throw new Error(`${path}: expected a horizontally packed square colour cube`);
  }

  const texture = new THREE.DataTexture(
    decoded.pixels,
    decoded.width,
    decoded.height,
    THREE.RGBAFormat,
  );
  // LUT values are converted explicitly by the post-process shader.
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

const VERTEX_SHADER = /* glsl */`
  uniform float distortionTime;
  varying vec2 vUv;
  varying vec2 vDistortedUv;

  void main() {
    vUv = uv;
    // Match DST's vertex shader: interpolate one affine UV transform across
    // the fullscreen triangle rather than evaluate sin/cos for every pixel.
    const float range = 0.00625;
    vec2 orbit = vec2(cos(distortionTime * 50.0 + 0.25), sin(distortionTime * 50.0));
    vDistortedUv = uv * (1.0 - 2.0 * range) + range + orbit * range;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */`
  uniform sampler2D sceneTexture;
  uniform sampler2D sourceLut;
  uniform sampler2D destinationLut;
  uniform float lutSize;
  uniform float lutBlend;
  uniform sampler2D sourceInsanityLut;
  uniform sampler2D destinationInsanityLut;
  uniform float insanityIntensity;
  uniform float distortionIntensity;
  uniform vec2 sceneTexelSize;

  varying vec2 vUv;
  varying vec2 vDistortedUv;

  vec3 sampleColourCube(sampler2D lut, vec3 colour) {
    float blue = colour.b * (lutSize - 1.0);
    float slice0 = floor(blue);
    float slice1 = min(slice0 + 1.0, lutSize - 1.0);
    float row = (colour.g * (lutSize - 1.0) + 0.5) / lutSize;
    float width = lutSize * lutSize;
    float red = colour.r * (lutSize - 1.0) + 0.5;
    vec2 uv0 = vec2((slice0 * lutSize + red) / width, row);
    vec2 uv1 = vec2((slice1 * lutSize + red) / width, row);
    return mix(texture2D(lut, uv0).rgb, texture2D(lut, uv1).rgb, fract(blue));
  }

  void main() {
    vec4 sceneColour = texture2D(sceneTexture, vUv);
    // DST's ambient values and colour cubes operate in display-colour space.
    vec3 displayColour = sRGBTransferOETF(vec4(max(sceneColour.rgb, 0.0), 1.0)).rgb;
    // postprocess_distort.ksh precedes colour grading. Its 0.00625 UV orbit
    // affects the edges while the centre stays steady (radii 0.5 / 0.685).
    float mask = clamp((1.0 - distance(vUv, vec2(0.5)) - 0.5) / (0.685 - 0.5), 0.0, 1.0);
    float distortionWeight = distortionIntensity * (1.0 - mask);
    if (distortionWeight > 0.0) {
      // Keep both linear-filter taps inside the resolved scene texture even
      // when interpolation/driver rounding reaches the screen boundary.
      vec2 halfTexel = sceneTexelSize * 0.5;
      vec2 distortedUv = clamp(vDistortedUv, halfTexel, vec2(1.0) - halfTexel);
      // Explicit LOD avoids implicit texture derivatives in this per-pixel
      // branch. The resolved scene has exactly one texture level.
      vec3 distorted = sRGBTransferOETF(vec4(max(textureLod(sceneTexture, distortedUv, 0.0).rgb, 0.0), 1.0)).rgb;
      displayColour = mix(displayColour, distorted, distortionWeight);
    }
    // World materials already apply ambient + local lighting before composition.
    vec3 litColour = clamp(displayColour, 0.0, 1.0);
    vec3 gradedSource = sampleColourCube(sourceLut, litColour);
    vec3 gradedDestination = sampleColourCube(destinationLut, litColour);
    vec3 graded = mix(gradedSource, gradedDestination, lutBlend);
    if (insanityIntensity > 0.0) {
      vec3 insaneSource = sampleColourCube(sourceInsanityLut, litColour);
      vec3 insaneDestination = sampleColourCube(destinationInsanityLut, litColour);
      graded = mix(graded, mix(insaneSource, insaneDestination, lutBlend), insanityIntensity);
    }
    gl_FragColor = sRGBTransferEOTF(vec4(graded, sceneColour.a));
    #include <colorspace_fragment>
  }
`;

/** Applies world lighting before the seasonal colour-cube post-process. */
export class DstLightingRenderer {
  static async create(
    renderer: THREE.WebGLRenderer,
    colourCubeRoot: string,
    initialState: { season: DstSeason; phase: DstLightPhase; sanityPercent?: number } = { season: 'spring', phase: 'night' },
  ): Promise<DstLightingRenderer> {
    const uniquePaths = [...new Set([
      ...Object.values(LUT_PATHS).flatMap((phases) => Object.values(phases)),
      ...Object.values(INSANITY_LUT_PATHS),
    ])];
    const loaded = await Promise.all(uniquePaths.map(async (path) => [path, await loadLut(colourCubeRoot, path)] as const));
    return new DstLightingRenderer(renderer, new Map(loaded), initialState);
  }

  private readonly renderer: THREE.WebGLRenderer;
  private readonly textures: ReadonlyMap<string, THREE.DataTexture>;
  private readonly renderTarget: THREE.WebGLRenderTarget;
  private readonly postScene = new THREE.Scene();
  private readonly postCamera = new THREE.Camera();
  private readonly material: THREE.ShaderMaterial;
  private readonly drawingBufferSize = new THREE.Vector2();
  private readonly localLighting = new DstLocalLighting();
  private readonly litAmbient = new THREE.Vector3();
  private readonly litBackground = new THREE.Color();
  private readonly ambientStart = new THREE.Vector3();
  private readonly ambientCurrent = new THREE.Vector3();
  private readonly ambientTarget = new THREE.Vector3();
  private season: DstSeason = 'spring';
  private phase: DstLightPhase = 'night';
  private weatherLight = 1;
  private sanityPercent = 1;
  private distortionSpeed = 0;
  private ambientBlendRemaining = 0;
  private ambientBlendTotal = 0;
  private lutBlendRemaining = 0;
  private lutBlendTotal = 0;

  private constructor(
    renderer: THREE.WebGLRenderer,
    textures: ReadonlyMap<string, THREE.DataTexture>,
    initialState: { season: DstSeason; phase: DstLightPhase; sanityPercent?: number },
  ) {
    this.renderer = renderer;
    this.textures = textures;
    this.season = initialState.season;
    this.phase = initialState.phase;
    const initialLut = this.requireLut(this.season, this.phase);
    const initialInsanityLut = this.requireInsanityLut(this.phase);
    this.ambientCurrent.copy(ambientFor(this.season, this.phase));
    this.ambientStart.copy(this.ambientCurrent);
    this.ambientTarget.copy(this.ambientCurrent);

    this.renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: true,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
    });
    this.renderTarget.texture.name = 'DST lighting scene colour';
    this.renderTarget.texture.colorSpace = THREE.NoColorSpace;
    this.renderTarget.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.renderTarget.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.renderTarget.samples = Math.min(4, renderer.capabilities.maxSamples);

    this.material = new THREE.ShaderMaterial({
      name: 'DST ambient and colour cube',
      uniforms: {
        sceneTexture: { value: this.renderTarget.texture },
        sourceLut: { value: initialLut },
        destinationLut: { value: initialLut },
        lutSize: { value: initialLut.image.height },
        lutBlend: { value: 1 },
        sourceInsanityLut: { value: initialInsanityLut },
        destinationInsanityLut: { value: initialInsanityLut },
        insanityIntensity: { value: 0 },
        distortionIntensity: { value: 0 },
        distortionTime: { value: 0 },
        sceneTexelSize: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      precision: 'highp',
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -1, -1, 0,
      3, -1, 0,
      -1, 3, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
      0, 0,
      2, 0,
      0, 2,
    ], 2));
    const quad = new THREE.Mesh(geometry, this.material);
    quad.frustumCulled = false;
    this.postScene.add(quad);
    this.setSanityPercent(initialState.sanityPercent ?? 1);
    this.applyAmbientUniform();
  }

  getSeason(): DstSeason {
    return this.season;
  }

  getPhase(): DstLightPhase {
    return this.phase;
  }

  setSeason(season: DstSeason): void {
    if (season === this.season) return;
    this.season = season;
    this.transitionAmbient(SEASON_BLEND_SECONDS);
    this.transitionLut(SEASON_BLEND_SECONDS);
  }

  setPhase(phase: DstLightPhase): void {
    if (phase === this.phase) return;
    this.phase = phase;
    const duration = PHASE_BLEND_SECONDS[phase];
    this.transitionAmbient(duration);
    this.transitionLut(duration);
  }

  getSanityPercent(): number {
    return this.sanityPercent;
  }

  /** Apply DST's quadratic grading using the nearest 10% sanity level. */
  setSanityPercent(percent: number): void {
    if (!Number.isFinite(percent)) throw new Error('Sanity percent must be finite');
    this.sanityPercent = THREE.MathUtils.clamp(percent, 0, 1);
    const gradingPercent = Math.round(this.sanityPercent * SANITY_GRADING_STEPS) / SANITY_GRADING_STEPS;
    this.material.uniforms.insanityIntensity.value = (1 - gradingPercent) ** 2;
    this.material.uniforms.distortionIntensity.value = (1 - this.sanityPercent) ** 2;
    // outQuad(1 - percent, 0, 0.2, 1), with DST's default distortion modifier 1.
    // Slow the orbit to half speed without changing its amplitude or grading.
    this.distortionSpeed = 0.2 * (1 - this.sanityPercent ** 2) * 0.5;
  }

  setWeatherLight(light: number): void {
    this.weatherLight = THREE.MathUtils.clamp(light, 0, 1);
    this.applyAmbientUniform();
  }

  setPrecipitation(intensity: number, snow = false): void {
    this.setWeatherLight(calculateDstWeatherLight(this.season, this.phase, intensity, snow));
  }

  setTorchOwner(owner: THREE.Object3D | null): void {
    this.localLighting.setTorchOwner(owner);
  }

  sampleLightLevel(position: THREE.Vector3, exclude?: THREE.Object3D): number {
    return this.localLighting.sampleLightLevel(position, exclude);
  }

  update(dt: number): void {
    const elapsed = Math.max(0, dt);
    // Keep trigonometric inputs small on every GPU, including after a long
    // session or a large simulation step. Wrapping does not change the orbit.
    this.material.uniforms.distortionTime.value = (
      this.material.uniforms.distortionTime.value
      + (elapsed * this.distortionSpeed) % DISTORTION_PERIOD
    ) % DISTORTION_PERIOD;
    if (this.ambientBlendRemaining > 0) {
      this.ambientBlendRemaining = Math.max(0, this.ambientBlendRemaining - elapsed);
      const alpha = 1 - this.ambientBlendRemaining / this.ambientBlendTotal;
      this.ambientCurrent.lerpVectors(this.ambientStart, this.ambientTarget, alpha);
      this.applyAmbientUniform();
    }
    if (this.lutBlendRemaining > 0) {
      this.lutBlendRemaining = Math.max(0, this.lutBlendRemaining - elapsed);
      this.material.uniforms.lutBlend.value = 1 - this.lutBlendRemaining / this.lutBlendTotal;
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.getDrawingBufferSize(this.drawingBufferSize);
    if (this.renderTarget.width !== this.drawingBufferSize.x
      || this.renderTarget.height !== this.drawingBufferSize.y) {
      this.renderTarget.setSize(this.drawingBufferSize.x, this.drawingBufferSize.y);
      (this.material.uniforms.sceneTexelSize.value as THREE.Vector2)
        .set(1 / this.drawingBufferSize.x, 1 / this.drawingBufferSize.y);
    }

    this.localLighting.prepareScene(scene);
    this.localLighting.renderLightmap(this.renderer);
    const originalBackground = scene.background;
    if (originalBackground instanceof THREE.Color) {
      this.litBackground.copy(originalBackground).convertLinearToSRGB();
      this.litBackground.r *= this.litAmbient.x;
      this.litBackground.g *= this.litAmbient.y;
      this.litBackground.b *= this.litAmbient.z;
      scene.background = this.litBackground.convertSRGBToLinear();
    }
    this.renderer.setRenderTarget(this.renderTarget);
    try {
      this.renderer.render(scene, camera);
    } finally {
      scene.background = originalBackground;
    }
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  }

  private transitionAmbient(duration: number): void {
    this.ambientStart.copy(this.ambientCurrent);
    this.ambientTarget.copy(ambientFor(this.season, this.phase));
    this.ambientBlendRemaining = duration;
    this.ambientBlendTotal = duration;
  }

  private transitionLut(duration: number): void {
    const destination = this.requireLut(this.season, this.phase);
    const insanityDestination = this.requireInsanityLut(this.phase);
    if (destination === this.material.uniforms.destinationLut.value
      && insanityDestination === this.material.uniforms.destinationInsanityLut.value) return;
    this.material.uniforms.sourceInsanityLut.value = this.material.uniforms.destinationInsanityLut.value;
    this.material.uniforms.destinationInsanityLut.value = insanityDestination;
    this.material.uniforms.sourceLut.value = this.material.uniforms.destinationLut.value;
    this.material.uniforms.destinationLut.value = destination;
    this.material.uniforms.lutSize.value = destination.image.height;
    this.material.uniforms.lutBlend.value = 0;
    this.lutBlendRemaining = duration;
    this.lutBlendTotal = duration;
  }

  private applyAmbientUniform(): void {
    this.litAmbient
      .copy(this.ambientCurrent)
      .multiplyScalar(this.weatherLight);
    this.localLighting.setAmbientColour(this.litAmbient);
  }

  private requireInsanityLut(phase: DstLightPhase): THREE.DataTexture {
    const path = INSANITY_LUT_PATHS[phase];
    const texture = this.textures.get(path);
    if (!texture) throw new Error(`DST colour cube was not loaded: ${path}`);
    return texture;
  }

  private requireLut(season: DstSeason, phase: DstLightPhase): THREE.DataTexture {
    const path = LUT_PATHS[season][phase];
    const texture = this.textures.get(path);
    if (!texture) throw new Error(`DST colour cube was not loaded: ${path}`);
    return texture;
  }
}
