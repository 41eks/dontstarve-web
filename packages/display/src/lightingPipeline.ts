import * as THREE from 'three';
import { prewarmScenePasses, renderSceneWithPasses } from '@dontstarve-web/animation/sceneRenderPass';
import { prewarmScene, yieldLoadingFrame } from '@dontstarve-web/animation/prewarmScene';
import type { ColourCube } from './colourCube';
import type { DstLocalLighting } from './localLighting';

const VERTEX_SHADER = /* glsl */ `
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

// combine_colour_cubes.ksh: blends the source/destination cubes of every layer
// into one cube only when a blend input changes, so the full-screen pass below
// (postprocess_colourcube.ksh) samples a single cube regardless of transitions.
const BAKE_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D sourceLut;
  uniform sampler2D destinationLut;
  uniform sampler2D sourceInsanityLut;
  uniform sampler2D destinationInsanityLut;
  uniform float lutBlend;
  uniform float insanityIntensity;

  varying vec2 vUv;

  void main() {
    vec3 graded = mix(texture2D(sourceLut, vUv).rgb, texture2D(destinationLut, vUv).rgb, lutBlend);
    if (insanityIntensity > 0.0) {
      vec3 insane = mix(texture2D(sourceInsanityLut, vUv).rgb, texture2D(destinationInsanityLut, vUv).rgb, lutBlend);
      graded = mix(graded, insane, insanityIntensity);
    }
    // Raw cube values: the target is NoColorSpace and nothing converts them.
    gl_FragColor = vec4(graded, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D sceneTexture;
  uniform sampler2D colourCube;
  uniform float lutSize;
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
    if (distortionIntensity > 0.0) {
      float mask = clamp((1.0 - distance(vUv, vec2(0.5)) - 0.5) / (0.685 - 0.5), 0.0, 1.0);
      float distortionWeight = distortionIntensity * (1.0 - mask);
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
    // The graded value is already in the drawing buffer's sRGB encoding, so it
    // is written directly instead of a decode/re-encode round trip.
    gl_FragColor = vec4(sampleColourCube(colourCube, litColour), sceneColour.a);
  }
`;

/**
 * The world's frame: the local lightmap, the world drawn into an offscreen target, then postprocess_distort and
 * postprocess_colourcube to the canvas. The combined cube is re-blended (combine_colour_cubes) only when the
 * ColourCube's inputs changed.
 */
export class LightingPipeline {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly cube: ColourCube;
  private readonly local: DstLocalLighting;
  private readonly renderTarget: THREE.WebGLRenderTarget;
  private readonly bakeTarget: THREE.WebGLRenderTarget;
  private readonly postScene = new THREE.Scene();
  private readonly bakeScene = new THREE.Scene();
  private readonly postCamera = new THREE.Camera();
  private readonly material: THREE.ShaderMaterial;
  private readonly bakeMaterial: THREE.ShaderMaterial;
  private readonly geometry = new THREE.BufferGeometry();
  private bakedVersion = 0;
  private readonly drawingBufferSize = new THREE.Vector2();
  /** The sceneTexelSize uniform's value, written in place. */
  private readonly sceneTexelSize = new THREE.Vector2(1, 1);
  private readonly litBackground = new THREE.Color();

  constructor(renderer: THREE.WebGLRenderer, cube: ColourCube, local: DstLocalLighting, cubeSize: number) {
    this.renderer = renderer;
    this.cube = cube;
    this.local = local;
    this.bakeTarget = new THREE.WebGLRenderTarget(cubeSize * cubeSize, cubeSize, {
      depthBuffer: false,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
    });
    this.bakeTarget.texture.name = 'DST baked colour cube';
    this.bakeTarget.texture.colorSpace = THREE.NoColorSpace;
    this.bakeTarget.texture.generateMipmaps = false;
    this.bakeTarget.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.bakeTarget.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.bakeMaterial = new THREE.ShaderMaterial({
      name: 'DST combined colour cube',
      uniforms: {
        sourceLut: { value: cube.source },
        destinationLut: { value: cube.destination },
        sourceInsanityLut: { value: cube.insanitySource },
        destinationInsanityLut: { value: cube.insanityDestination },
        lutBlend: { value: cube.blend },
        insanityIntensity: { value: cube.insanityIntensity },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: BAKE_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      precision: 'highp',
    });

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
        colourCube: { value: this.bakeTarget.texture },
        lutSize: { value: cubeSize },
        distortionIntensity: { value: 0 },
        distortionTime: { value: 0 },
        sceneTexelSize: { value: this.sceneTexelSize },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      precision: 'highp',
    });
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const quad = new THREE.Mesh(this.geometry, this.material);
    quad.frustumCulled = false;
    this.postScene.add(quad);
    const bakeQuad = new THREE.Mesh(this.geometry, this.bakeMaterial);
    bakeQuad.frustumCulled = false;
    this.bakeScene.add(bakeQuad);
  }

  private resizeRenderTarget(): void {
    this.renderer.getDrawingBufferSize(this.drawingBufferSize);
    if (this.renderTarget.width !== this.drawingBufferSize.x || this.renderTarget.height !== this.drawingBufferSize.y) {
      this.renderTarget.setSize(this.drawingBufferSize.x, this.drawingBufferSize.y);
      this.sceneTexelSize.set(1 / this.drawingBufferSize.x, 1 / this.drawingBufferSize.y);
    }
  }

  /** combine_colour_cubes: re-blend the cube only after a blend input changed. */
  private bakeColourCube(): void {
    const { cube } = this;
    if (cube.bakeVersion === this.bakedVersion) {
      return;
    }
    this.bakedVersion = cube.bakeVersion;
    const uniforms = this.bakeMaterial.uniforms;
    uniforms.sourceLut.value = cube.source;
    uniforms.destinationLut.value = cube.destination;
    uniforms.sourceInsanityLut.value = cube.insanitySource;
    uniforms.destinationInsanityLut.value = cube.insanityDestination;
    uniforms.lutBlend.value = cube.blend;
    uniforms.insanityIntensity.value = cube.insanityIntensity;
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.bakeTarget);
    try {
      this.renderer.render(this.bakeScene, this.postCamera);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
    }
  }

  /** Compile the actual world/lightmap/post-process variants without drawing the world. */
  async prewarm(scene: THREE.Scene, camera: THREE.Camera, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    this.resizeRenderTarget();
    this.bakeColourCube();
    this.local.prepareScene(scene);
    await this.local.prewarm(this.renderer, signal);
    await yieldLoadingFrame();
    signal?.throwIfAborted();
    this.renderer.initRenderTarget(this.renderTarget);
    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.renderTarget);
    try {
      await prewarmScenePasses(this.renderer, scene, camera, signal);
      await prewarmScene(this.renderer, scene, camera, signal);
      this.renderer.setRenderTarget(null);
      await prewarmScene(this.renderer, this.postScene, this.postCamera, signal);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
    }
  }

  /** The world's frame, with its background colour scaled by the lit ambient. */
  render(scene: THREE.Scene, camera: THREE.Camera, ambient: THREE.Vector3): void {
    this.resizeRenderTarget();
    this.bakeColourCube();
    const uniforms = this.material.uniforms;
    uniforms.distortionIntensity.value = this.cube.distortionIntensity;
    uniforms.distortionTime.value = this.cube.distortionTime;

    const originalBackground = scene.background;
    if (originalBackground instanceof THREE.Color) {
      this.litBackground.copy(originalBackground).convertLinearToSRGB();
      this.litBackground.r *= ambient.x;
      this.litBackground.g *= ambient.y;
      this.litBackground.b *= ambient.z;
      scene.background = this.litBackground.convertSRGBToLinear();
    }
    this.renderer.setRenderTarget(this.renderTarget);
    try {
      renderSceneWithPasses(this.renderer, scene, camera, () => {
        this.local.renderLightmap(this.renderer, scene);
        return this.local.getRenderPassLighting();
      });
    } finally {
      scene.background = originalBackground;
    }
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  }

  dispose(): void {
    this.renderTarget.dispose();
    this.bakeTarget.dispose();
    this.bakeMaterial.dispose();
    this.material.dispose();
    this.geometry.dispose();
    this.bakeScene.clear();
    this.postScene.clear();
  }
}
