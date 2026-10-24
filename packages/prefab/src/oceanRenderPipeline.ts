import * as THREE from 'three';
import { registerSceneRenderPass, type ScenePassLighting, type SceneRenderPass } from '@dontstarve-web/animation/sceneRenderPass';

export interface OceanColourMap {
  readonly size: number;
  readonly tileSize: number;
  isOceanTileAt(col: number, row: number): boolean;
}

// tiledefs.lua COASTAL_OCEAN_COLOR and tilemanager.lua DEFAULT_COLOUR.
const OCEAN = { primary: [220, 255, 255, 28], day: [25, 123, 167, 100], dusk: [10, 120, 125, 120] };
const LAND = { primary: [0, 0, 0, 25], day: [0, 20, 33, 0], dusk: [0, 20, 33, 80] };

const QUAD_VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// blurh.ksh / blurv.ksh: nine taps, intentionally retaining the source's 0.98 sum.
const BLUR_FRAGMENT = /* glsl */`
  uniform sampler2D sourceTexture;
  uniform vec2 pixelStep;
  varying vec2 vUv;
  void main() {
    vec4 sum = texture2D(sourceTexture, vUv - 4.0 * pixelStep) * 0.05;
    sum += texture2D(sourceTexture, vUv - 3.0 * pixelStep) * 0.09;
    sum += texture2D(sourceTexture, vUv - 2.0 * pixelStep) * 0.12;
    sum += texture2D(sourceTexture, vUv - pixelStep) * 0.15;
    sum += texture2D(sourceTexture, vUv) * 0.16;
    sum += texture2D(sourceTexture, vUv + pixelStep) * 0.15;
    sum += texture2D(sourceTexture, vUv + 2.0 * pixelStep) * 0.12;
    sum += texture2D(sourceTexture, vUv + 3.0 * pixelStep) * 0.09;
    sum += texture2D(sourceTexture, vUv + 4.0 * pixelStep) * 0.05;
    gl_FragColor = sum;
  }
`;

// blendoceantexture.ksh mixes all four channels of the blurred day/dusk textures.
const BLEND_FRAGMENT = /* glsl */`
  uniform sampler2D dayTexture;
  uniform sampler2D duskTexture;
  uniform float textureBlend;
  varying vec2 vUv;
  void main() { gl_FragColor = mix(texture2D(dayTexture, vUv), texture2D(duskTexture, vUv), textureBlend); }
`;

const WORLD_VERTEX = /* glsl */`
  varying vec2 vWorldXZ;
  varying vec3 vScreen;
  varying vec2 vUv;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
    vWorldXZ = world.xz;
    vScreen = gl_Position.xyw;
    vUv = uv;
  }
`;

// ocean_combined.ksh: world-space palette, moving green-channel noise,
// display-space lightmap, then an unpremultiplied 2x encoding into a float target.
const COMBINED_FRAGMENT = /* glsl */`
  uniform sampler2D baseTexture;
  uniform sampler2D primaryTexture;
  uniform sampler2D noiseTexture;
  uniform sampler2D lightmap;
  uniform vec4 oceanExtents;
  uniform vec4 lightmapExtents;
  uniform vec3 ambient;
  uniform float useLightmap;
  uniform float oceanTime;
  varying vec2 vWorldXZ;
  float sampleNoise(vec2 uv, float scale, float angle, float speed) {
    vec2 offset = vec2(cos(angle), sin(angle)) * speed * oceanTime;
    float noise = texture2D(noiseTexture, uv * scale + offset).g;
    return noise * noise;
  }
  void main() {
    vec2 oceanUv = (vWorldXZ - oceanExtents.xy) * oceanExtents.zw;
    vec4 base = texture2D(baseTexture, oceanUv);
    vec4 primary = texture2D(primaryTexture, oceanUv);
    float noise = sin(sampleNoise(oceanUv, 26.0, radians(15.0), 0.0035)
      + sampleNoise(oceanUv, 30.0, radians(100.0), 0.0045)
      + sampleNoise(oceanUv, 34.0, radians(230.0), 0.0055)) * 0.5 + 0.5;
    vec3 colour = mix(base.rgb, primary.rgb, noise * primary.a);
    vec2 lightUv = (vWorldXZ - lightmapExtents.xy) * lightmapExtents.zw;
    vec3 light = ambient;
    if (useLightmap > 0.5 && all(greaterThanEqual(lightUv, vec2(0.0)))
      && all(lessThanEqual(lightUv, vec2(1.0)))) light = texture2D(lightmap, lightUv).rgb;
    gl_FragColor = vec4(colour * light * 2.0, base.a + primary.a * noise);
  }
`;

// ocean.ksh: screen-space sampling, 0.5 decoding and premultiplied composition.
// Three's world target is linear; convert the decoded DST display colour before blending.
const RESOLVE_FRAGMENT = /* glsl */`
  uniform sampler2D encodedTexture;
  varying vec3 vScreen;
  varying vec2 vUv;
  void main() {
    vec2 screenUv = (vScreen.xy / vScreen.z) * 0.5 + 0.5;
    vec4 encoded = texture2D(encodedTexture, screenUv + vUv * 0.000001);
    gl_FragColor = sRGBTransferEOTF(vec4(encoded.rgb * 0.5, encoded.a));
    #include <colorspace_fragment>
    #include <premultiplied_alpha_fragment>
  }
`;

const FLOOR_FRAGMENT = /* glsl */`
  uniform vec3 floorColour;
  void main() {
    gl_FragColor = sRGBTransferEOTF(vec4(floorColour, 1.0));
    #include <colorspace_fragment>
  }
`;

function target(name: string, width: number, height: number): THREE.WebGLRenderTarget {
  const result = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  result.texture.name = name;
  result.texture.colorSpace = THREE.NoColorSpace;
  return result;
}

function palette(name: string, width: number, height: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array(width * height * 4), width, height, THREE.RGBAFormat);
  texture.name = name;
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Owns the ocean's offscreen passes; map data, clock and borrowed noise remain with their owners. */
export class OceanRenderPipeline implements SceneRenderPass {
  private readonly min: number;
  private readonly width: number;
  private readonly day: THREE.DataTexture;
  private readonly dusk: THREE.DataTexture;
  private readonly primary: THREE.DataTexture;
  private readonly dayBlur: THREE.WebGLRenderTarget;
  private readonly duskBlur: THREE.WebGLRenderTarget;
  private readonly primaryBlur: THREE.WebGLRenderTarget;
  private readonly scratchH: THREE.WebGLRenderTarget;
  private readonly scratchV: THREE.WebGLRenderTarget;
  private readonly blended: THREE.WebGLRenderTarget;
  private readonly encoded = target('DST ocean encoded screen colour', 1, 1);
  private readonly white = palette('DST ocean neutral light', 1, 1);
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.Camera();
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly combinedScene = new THREE.Scene();
  private readonly combinedMesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly floorMesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly blendMaterial: THREE.ShaderMaterial;
  private readonly combinedMaterial: THREE.ShaderMaterial;
  private readonly resolveMaterial: THREE.ShaderMaterial;
  private readonly floorMaterial: THREE.ShaderMaterial;
  private readonly bufferSize = new THREE.Vector2();
  private readonly clearColour = new THREE.Color();
  private surface?: THREE.Mesh;
  private unregister?: () => void;
  private coloursDirty = true;
  private blendDirty = true;
  private renderer?: THREE.WebGLRenderer;
  private readonly map: OceanColourMap;
  private ownsPlaceholderGeometry = true;
  private disposed = false;

  constructor(noise: THREE.Texture, map: OceanColourMap) {
    this.map = map;
    this.min = Math.floor(-map.size / 2 / map.tileSize);
    this.width = Math.ceil(map.size / 2 / map.tileSize) - this.min;
    this.day = palette('DST ocean day palette', this.width, this.width);
    this.dusk = palette('DST ocean dusk palette', this.width, this.width);
    this.primary = palette('DST ocean primary palette', this.width, this.width);
    this.dayBlur = target('DST ocean blurred day', this.width, this.width);
    this.duskBlur = target('DST ocean blurred dusk', this.width, this.width);
    this.primaryBlur = target('DST ocean blurred primary', this.width, this.width);
    this.scratchH = target('DST ocean horizontal blur', this.width, this.width);
    this.scratchV = target('DST ocean vertical blur', this.width, this.width);
    this.blended = target('DST ocean day-dusk blend', this.width, this.width);
    (this.white.image.data as Uint8Array).fill(255);
    noise.colorSpace = THREE.NoColorSpace;
    this.blurMaterial = this.material('DST ocean nine-tap blur', QUAD_VERTEX, BLUR_FRAGMENT, {
      sourceTexture: { value: this.day }, pixelStep: { value: new THREE.Vector2() },
    });
    this.blendMaterial = this.material('DST ocean colour texture blend', QUAD_VERTEX, BLEND_FRAGMENT, {
      dayTexture: { value: this.dayBlur.texture }, duskTexture: { value: this.duskBlur.texture }, textureBlend: { value: 0 },
    });
    const span = this.width * map.tileSize;
    this.combinedMaterial = this.material('DST ocean combined colour and light', WORLD_VERTEX, COMBINED_FRAGMENT, {
      baseTexture: { value: this.blended.texture }, primaryTexture: { value: this.primaryBlur.texture },
      noiseTexture: { value: noise }, oceanTime: { value: 0 },
      oceanExtents: { value: new THREE.Vector4(this.min * map.tileSize, this.min * map.tileSize, 1 / span, 1 / span) },
      lightmap: { value: this.white }, lightmapExtents: { value: new THREE.Vector4() },
      ambient: { value: new THREE.Vector3(1, 1, 1) }, useLightmap: { value: 0 },
    });
    this.resolveMaterial = this.material('DST ocean screen resolve', WORLD_VERTEX, RESOLVE_FRAGMENT, {
      encodedTexture: { value: this.encoded.texture },
    });
    this.resolveMaterial.transparent = true;
    this.resolveMaterial.blending = THREE.NormalBlending;
    this.resolveMaterial.premultipliedAlpha = true;
    this.resolveMaterial.depthTest = true;
    this.floorMaterial = this.material('DST ocean clear colour', WORLD_VERTEX, FLOOR_FRAGMENT, {
      floorColour: { value: new THREE.Vector3(0, 19 / 255, 20 / 255) },
    });
    this.floorMaterial.depthTest = true;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMaterial);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.combinedMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.combinedMaterial);
    this.combinedMesh.matrixAutoUpdate = false;
    this.combinedMesh.frustumCulled = false;
    this.combinedScene.add(this.combinedMesh);
    this.floorMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.floorMaterial);
    this.floorMesh.name = 'OceanClearColour';
    this.rebuildColours();
  }

  private material(name: string, vertexShader: string, fragmentShader: string,
    uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({ name, vertexShader, fragmentShader, uniforms,
      depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending, side: THREE.DoubleSide });
    material.forceSinglePass = true;
    return material;
  }

  attach(surface: THREE.Mesh): void {
    this.unregister?.();
    this.floorMesh.removeFromParent();
    this.surface = surface;
    surface.material = this.resolveMaterial;
    if (this.ownsPlaceholderGeometry) {
      this.combinedMesh.geometry.dispose();
      this.floorMesh.geometry.dispose();
      this.ownsPlaceholderGeometry = false;
    }
    this.combinedMesh.geometry = this.floorMesh.geometry = surface.geometry;
    this.floorMesh.renderOrder = surface.renderOrder - 0.01;
    surface.add(this.floorMesh);
    this.unregister = registerSceneRenderPass(surface, this);
  }

  rebuildColours(): void {
    for (let row = 0; row < this.width; row++) for (let col = 0; col < this.width; col++) {
      const colour = this.map.isOceanTileAt(col + this.min, row + this.min) ? OCEAN : LAND;
      const offset = (row * this.width + col) * 4;
      (this.day.image.data as Uint8Array).set(colour.day, offset);
      (this.dusk.image.data as Uint8Array).set(colour.dusk, offset);
      (this.primary.image.data as Uint8Array).set(colour.primary, offset);
    }
    this.day.needsUpdate = this.dusk.needsUpdate = this.primary.needsUpdate = true;
    this.coloursDirty = true;
  }

  setPhase(blend: number, floor: THREE.Vector3): void {
    if (this.blendMaterial.uniforms.textureBlend.value !== blend) this.blendDirty = true;
    this.blendMaterial.uniforms.textureBlend.value = blend;
    (this.floorMaterial.uniforms.floorColour.value as THREE.Vector3).copy(floor);
  }

  update(dt: number): void { this.combinedMaterial.uniforms.oceanTime.value += dt; }

  private syncGeometry(): void {
    if (!this.surface) return;
    this.combinedMesh.geometry = this.floorMesh.geometry = this.surface.geometry;
    this.combinedMesh.matrix.copy(this.surface.matrixWorld);
  }

  private resize(renderer: THREE.WebGLRenderer): void {
    const current = renderer.getRenderTarget();
    if (current) this.bufferSize.set(current.width, current.height);
    else renderer.getDrawingBufferSize(this.bufferSize);
    if (this.encoded.width !== this.bufferSize.x || this.encoded.height !== this.bufferSize.y) {
      this.encoded.setSize(this.bufferSize.x, this.bufferSize.y);
    }
    if (this.renderer !== renderer) { this.renderer = renderer; this.coloursDirty = true; }
  }

  private withRendererState(renderer: THREE.WebGLRenderer, run: () => void): void {
    const previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const autoClear = renderer.autoClear, alpha = renderer.getClearAlpha(), scissorTest = renderer.getScissorTest();
    const colour = renderer.getClearColor(this.clearColour);
    try {
      renderer.autoClear = true;
      renderer.setScissorTest(false);
      renderer.setClearColor(0, 0);
      run();
    } finally {
      renderer.autoClear = autoClear;
      renderer.setClearColor(colour, alpha);
      renderer.setScissorTest(scissorTest);
      renderer.setRenderTarget(previous, face, mip);
    }
  }

  private drawQuad(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, output: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    renderer.setRenderTarget(output);
    renderer.render(this.quadScene, this.quadCamera);
  }

  private blur(renderer: THREE.WebGLRenderer, input: THREE.Texture, output: THREE.WebGLRenderTarget): void {
    const uniforms = this.blurMaterial.uniforms;
    // tuning.lua TEXTURE_BLUR_PASS_SIZE = 1, TEXTURE_BLUR_PASS_COUNT = 3.
    for (let round = 0; round < 3; round++) {
      uniforms.sourceTexture.value = input;
      (uniforms.pixelStep.value as THREE.Vector2).set(1 / this.width, 0);
      this.drawQuad(renderer, this.blurMaterial, this.scratchH);
      uniforms.sourceTexture.value = this.scratchH.texture;
      (uniforms.pixelStep.value as THREE.Vector2).set(0, 1 / this.width);
      const destination = round === 2 ? output : this.scratchV;
      this.drawQuad(renderer, this.blurMaterial, destination);
      input = destination.texture;
    }
  }

  private renderColourTextures(renderer: THREE.WebGLRenderer): void {
    if (this.coloursDirty) {
      this.blur(renderer, this.day, this.dayBlur);
      this.blur(renderer, this.dusk, this.duskBlur);
      this.blur(renderer, this.primary, this.primaryBlur);
      this.coloursDirty = false;
      this.blendDirty = true;
    }
    if (this.blendDirty) {
      this.drawQuad(renderer, this.blendMaterial, this.blended);
      this.blendDirty = false;
    }
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera, lighting?: ScenePassLighting): void {
    if (this.disposed || !this.surface) return;
    this.syncGeometry();
    this.resize(renderer);
    const uniforms = this.combinedMaterial.uniforms;
    uniforms.lightmap.value = lighting?.texture ?? this.white;
    uniforms.useLightmap.value = lighting ? 1 : 0;
    if (lighting) (uniforms.ambient.value as THREE.Vector3).copy(lighting.ambient);
    else (uniforms.ambient.value as THREE.Vector3).set(1, 1, 1);
    if (lighting) (uniforms.lightmapExtents.value as THREE.Vector4).copy(lighting.extents);
    this.withRendererState(renderer, () => {
      this.renderColourTextures(renderer);
      renderer.setRenderTarget(this.encoded);
      renderer.render(this.combinedScene, camera);
    });
  }

  async prewarm(renderer: THREE.WebGLRenderer, camera: THREE.Camera, signal?: AbortSignal): Promise<void> {
    if (this.disposed) return;
    this.syncGeometry();
    this.resize(renderer);
    for (const texture of [this.day, this.dusk, this.primary, this.white, this.combinedMaterial.uniforms.noiseTexture.value]) {
      signal?.throwIfAborted();
      renderer.initTexture(texture);
    }
    for (const output of this.targets()) renderer.initRenderTarget(output);
    for (const material of [this.blurMaterial, this.blendMaterial]) {
      signal?.throwIfAborted();
      this.quad.material = material;
      await renderer.compileAsync(this.quadScene, this.quadCamera);
    }
    signal?.throwIfAborted();
    await renderer.compileAsync(this.combinedScene, camera);
    signal?.throwIfAborted();
    this.withRendererState(renderer, () => this.renderColourTextures(renderer));
  }

  private targets(): THREE.WebGLRenderTarget[] {
    return [this.dayBlur, this.duskBlur, this.primaryBlur, this.scratchH, this.scratchV, this.blended, this.encoded];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unregister?.();
    this.floorMesh.removeFromParent();
    if (this.ownsPlaceholderGeometry) {
      this.combinedMesh.geometry.dispose();
      this.floorMesh.geometry.dispose();
    }
    for (const output of this.targets()) output.dispose();
    for (const texture of [this.day, this.dusk, this.primary, this.white]) texture.dispose();
    for (const material of [this.blurMaterial, this.blendMaterial, this.combinedMaterial, this.resolveMaterial, this.floorMaterial]) material.dispose();
    this.quad.geometry.dispose();
    this.combinedScene.clear();
    this.quadScene.clear();
    this.surface = undefined;
  }
}
