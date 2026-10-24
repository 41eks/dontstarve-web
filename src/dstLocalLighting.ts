import * as THREE from 'three';
import { TILE_SIZE } from '@dontstarve-web/prefab/tile';
import { getPrefabLightOverride, getPrefabLocalLight, type PrefabLocalLight } from '@dontstarve-web/prefab/localLight';
import { prewarmScene, yieldLoadingFrame } from './prewarmScene';
import type { ScenePassLighting } from '@dontstarve-web/animation/sceneRenderPass';

// DST tiles are 4 units wide; this scene uses TILE_SIZE (12).
const LIGHTMAP_SIZE = 256;
const LIGHTMAP_SPAN = 2 * (TILE_SIZE / 4) * 6;

const VERTEX_SHADER = /* glsl */`
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const LIGHT_VERTEX_SHADER = /* glsl */`
  attribute vec3 lightOriginRadius;
  attribute vec3 lightColour;
  attribute float lightLogFalloff;
  uniform vec4 dstLightmapExtents;
  varying vec2 vLightOffset;
  varying vec3 vLightColour;
  varying float vLightLogFalloff;

  void main() {
    // Each instance covers only its finite support, instead of the whole lightmap.
    vLightOffset = position.xy * 3.0;
    vec2 worldXZ = lightOriginRadius.xy + vLightOffset * lightOriginRadius.z;
    vec2 lightUv = (worldXZ - dstLightmapExtents.xy) * dstLightmapExtents.zw;
    gl_Position = vec4(lightUv * 2.0 - 1.0, 0.0, 1.0);
    vLightColour = lightColour;
    vLightLogFalloff = lightLogFalloff;
  }
`;

const LIGHT_FRAGMENT_SHADER = /* glsl */`
  varying vec2 vLightOffset;
  varying vec3 vLightColour;
  varying float vLightLogFalloff;

  void main() {
    float normalizedDistance = max(length(vLightOffset), 0.0001);
    float attenuation = clamp(exp(vLightLogFalloff * normalizedDistance * normalizedDistance), 0.0, 1.0);
    attenuation *= 1.0 - smoothstep(2.5, 3.0, normalizedDistance);
    gl_FragColor = vec4(vLightColour * attenuation, 1.0);
  }
`;

/** World XZ lightmap shared by ground, animated sprites and instanced scenery. */
export class DstLocalLighting {
  private readonly target = new THREE.WebGLRenderTarget(LIGHTMAP_SIZE, LIGHTMAP_SIZE, {
    depthBuffer: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
  });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly patchedMaterials = new WeakSet<THREE.Material>();
  private readonly lightOverrides = new WeakMap<THREE.Material, { value: number }>();
  private readonly ownerPosition = new THREE.Vector3();
  private readonly lightPosition = new THREE.Vector3();
  private readonly prefabLights: { owner: THREE.Object3D; settings: PrefabLocalLight }[] = [];
  private readonly ambient = { value: new THREE.Vector3() };
  private readonly extents = { value: new THREE.Vector4(0, 0, 1 / LIGHTMAP_SPAN, 1 / LIGHTMAP_SPAN) };
  private readonly lightmap = { value: this.target.texture };
  private readonly ambientMaterial: THREE.ShaderMaterial;
  private readonly lightmapMaterial: THREE.ShaderMaterial;
  private readonly lightGeometry = new THREE.InstancedBufferGeometry();
  private readonly lightMesh: THREE.Mesh;
  private lightCapacity = 0;

  constructor() {
    this.target.texture.name = 'DST world XZ lightmap';
    this.target.texture.colorSpace = THREE.NoColorSpace;
    this.ambientMaterial = new THREE.ShaderMaterial({
      name: 'DST lightmap ambient',
      uniforms: { dstAmbientColour: this.ambient },
      vertexShader: VERTEX_SHADER,
      fragmentShader: 'uniform vec3 dstAmbientColour; void main() { gl_FragColor = vec4(dstAmbientColour, 1.0); }',
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.ambientMaterial);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.lightmapMaterial = new THREE.ShaderMaterial({
      name: 'DST batched local light falloff',
      uniforms: { dstLightmapExtents: this.extents },
      vertexShader: LIGHT_VERTEX_SHADER,
      fragmentShader: LIGHT_FRAGMENT_SHADER,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.lightGeometry.setIndex(quad.geometry.index!.clone());
    this.lightGeometry.setAttribute('position', quad.geometry.getAttribute('position').clone());
    this.ensureLightCapacity(1);
    this.lightGeometry.instanceCount = 0;
    this.lightMesh = new THREE.Mesh(this.lightGeometry, this.lightmapMaterial);
    this.lightMesh.frustumCulled = false;
    this.scene.add(this.lightMesh);
  }

  setAmbientColour(colour: THREE.Vector3): void {
    this.ambient.value.copy(colour);
  }

  getRenderPassLighting(): ScenePassLighting {
    return { texture: this.lightmap.value, extents: this.extents.value, ambient: this.ambient.value };
  }

  async prewarm(renderer: THREE.WebGLRenderer, signal?: AbortSignal): Promise<void> {
    await yieldLoadingFrame();
    signal?.throwIfAborted();
    renderer.initRenderTarget(this.target);
    const previousTarget = renderer.getRenderTarget();
    const previousCount = this.lightGeometry.instanceCount;
    const previousVisible = this.lightMesh.visible;
    this.lightGeometry.instanceCount = Math.max(1, previousCount);
    this.lightMesh.visible = true;
    renderer.setRenderTarget(this.target);
    try {
      await prewarmScene(renderer, this.scene, this.camera, signal);
    } finally {
      this.lightGeometry.instanceCount = previousCount;
      this.lightMesh.visible = previousVisible;
      renderer.setRenderTarget(previousTarget);
    }
  }

  dispose(): void {
    this.prefabLights.length = 0;
    this.target.dispose();
    this.ambientMaterial.dispose();
    this.lightmapMaterial.dispose();
    for (const quad of this.scene.children) if (quad instanceof THREE.Mesh) quad.geometry.dispose();
    this.scene.clear();
  }

  /** CPU counterpart of the estimated lightmap, for prefab LightWatchers. */
  sampleLightLevel(position: THREE.Vector3, exclude?: THREE.Object3D): number {
    const colour = this.ambient.value.clone();
    const accumulate = (owner: THREE.Object3D, light: PrefabLocalLight) => {
      if (owner === exclude || light.radius <= 0 || light.intensity <= 0) return;
      const origin = owner.getWorldPosition(new THREE.Vector3());
      const distance = Math.max(Math.hypot(position.x - origin.x, position.z - origin.z) / light.radius, 0.0001);
      const edge = THREE.MathUtils.clamp((distance - 2.5) / 0.5, 0, 1);
      const attenuation = THREE.MathUtils.clamp(Math.exp(Math.log(light.falloff) * distance ** 2), 0, 1)
        * (1 - edge * edge * (3 - 2 * edge));
      colour.addScaledVector(new THREE.Vector3().fromArray(light.colour), light.intensity * attenuation);
    };
    for (const { owner } of this.prefabLights) {
      const settings = getPrefabLocalLight(owner);
      if (owner.parent && settings) accumulate(owner, settings);
    }
    return Math.min(1, colour.x) * 0.2126 + Math.min(1, colour.y) * 0.7152 + Math.min(1, colour.z) * 0.0722;
  }

  renderLightmap(renderer: THREE.WebGLRenderer): void {
    this.ensureLightCapacity(this.prefabLights.length);
    const origins = this.lightGeometry.getAttribute('lightOriginRadius') as THREE.InstancedBufferAttribute;
    const colours = this.lightGeometry.getAttribute('lightColour') as THREE.InstancedBufferAttribute;
    const falloffs = this.lightGeometry.getAttribute('lightLogFalloff') as THREE.InstancedBufferAttribute;
    let count = 0;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const { owner, settings } of this.prefabLights) {
      if (settings.radius <= 0 || settings.intensity <= 0) continue;
      const position = owner.getWorldPosition(this.lightPosition);
      if (count === 0) this.ownerPosition.copy(position);
      origins.setXYZ(count, position.x, position.z, settings.radius);
      colours.setXYZ(count, settings.colour[0] * settings.intensity,
        settings.colour[1] * settings.intensity, settings.colour[2] * settings.intensity);
      falloffs.setX(count, Math.log(settings.falloff));
      count++;
      const support = settings.radius * 3;
      minX = Math.min(minX, position.x - support);
      minZ = Math.min(minZ, position.z - support);
      maxX = Math.max(maxX, position.x + support);
      maxZ = Math.max(maxZ, position.z + support);
    }
    this.lightGeometry.instanceCount = count;
    this.lightMesh.visible = count > 0;
    if (count) {
      for (const attribute of [origins, colours, falloffs]) {
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, count * attribute.itemSize);
        attribute.needsUpdate = true;
      }
      this.extents.value.set(minX, minZ, 1 / (maxX - minX), 1 / (maxZ - minZ));
    } else {
      this.extents.value.set(this.ownerPosition.x - LIGHTMAP_SPAN / 2,
        this.ownerPosition.z - LIGHTMAP_SPAN / 2, 1 / LIGHTMAP_SPAN, 1 / LIGHTMAP_SPAN);
    }
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    try {
      renderer.setRenderTarget(this.target);
      renderer.autoClear = true;
      // One ambient draw plus one instanced additive draw, independent of light count.
      // RGBA8 clamps after every fragment addition as in the former per-source passes.
      renderer.render(this.scene, this.camera);
    } finally {
      renderer.autoClear = previousAutoClear;
      renderer.setRenderTarget(previousTarget);
    }
  }

  private ensureLightCapacity(count: number): void {
    if (count <= this.lightCapacity) return;
    // Release old GPU attributes before replacing them; retain and re-upload the shared quad.
    if (this.lightCapacity) this.lightGeometry.dispose();
    this.lightCapacity = THREE.MathUtils.ceilPowerOfTwo(count);
    for (const [name, size] of [['lightOriginRadius', 3], ['lightColour', 3], ['lightLogFalloff', 1]] as const) {
      this.lightGeometry.setAttribute(name, new THREE.InstancedBufferAttribute(
        new Float32Array(this.lightCapacity * size), size).setUsage(THREE.DynamicDrawUsage));
    }
  }

  prepareScene(scene: THREE.Scene): void {
    this.prefabLights.length = 0;
    // New equipment, ground items and nearby scenery may introduce materials
    // after startup. Shared atlas materials only receive this patch once.
    scene.traverse((object) => {
      const light = getPrefabLocalLight(object);
      if (light) this.prefabLights.push({ owner: object, settings: light });
      const material = (object as THREE.Mesh).material;
      if (!material) return;
      let lightOverride = 0;
      for (let owner: THREE.Object3D | null = object; owner; owner = owner.parent) {
        const value = getPrefabLightOverride(owner);
        if (value === undefined) continue;
        lightOverride = value;
        break;
      }
      // Placement sprites own their atlas materials, including skin atlases.
      // Reset every frame so commits and animation changes restore normal light.
      for (const entry of Array.isArray(material) ? material : [material]) {
        this.patchMaterial(entry);
        const uniform = this.lightOverrides.get(entry);
        if (uniform) uniform.value = Math.max(lightOverride, getPrefabLightOverride(entry) ?? 0);
      }
    });
  }

  private patchMaterial(material: THREE.Material): void {
    if (this.patchedMaterials.has(material) || !material.colorWrite) return;
    if (!(material instanceof THREE.MeshBasicMaterial
      || material instanceof THREE.MeshLambertMaterial
      || material instanceof THREE.MeshStandardMaterial
      || material instanceof THREE.MeshPhongMaterial
      || material instanceof THREE.LineBasicMaterial)) return;

    const previousCompile = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey();
    const lightOverride = { value: 0 };
    this.lightOverrides.set(material, lightOverride);
    material.onBeforeCompile = (shader, renderer) => {
      previousCompile.call(material, shader, renderer);
      shader.uniforms.dstAmbientColour = this.ambient;
      shader.uniforms.dstLightmap = this.lightmap;
      shader.uniforms.dstLightmapExtents = this.extents;
      shader.uniforms.dstLightOverride = lightOverride;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `
        #include <common>
        varying vec2 vDstWorldXZ;
      `).replace('#include <project_vertex>', `
        #include <project_vertex>
        vec4 dstWorldPosition = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          dstWorldPosition = batchingMatrix * dstWorldPosition;
        #endif
        #ifdef USE_INSTANCING
          dstWorldPosition = instanceMatrix * dstWorldPosition;
        #endif
        vDstWorldXZ = (modelMatrix * dstWorldPosition).xz;
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
        #include <common>
        uniform sampler2D dstLightmap;
        uniform vec4 dstLightmapExtents;
        uniform vec3 dstAmbientColour;
        uniform float dstLightOverride;
        varying vec2 vDstWorldXZ;
      `).replace('#include <colorspace_fragment>', `
        vec2 dstLightUv = (vDstWorldXZ - dstLightmapExtents.xy) * dstLightmapExtents.zw;
        vec3 dstLight = dstAmbientColour;
        if (all(greaterThanEqual(dstLightUv, vec2(0.0)))
          && all(lessThanEqual(dstLightUv, vec2(1.0)))) {
          dstLight = texture2D(dstLightmap, dstLightUv).rgb;
        }
        // The original ambient colours and LUTs operate in display space.
        dstLight = max(dstLight, vec3(dstLightOverride));
        vec3 dstDisplay = sRGBTransferOETF(vec4(max(gl_FragColor.rgb, 0.0), 1.0)).rgb;
        gl_FragColor.rgb = sRGBTransferEOTF(vec4(dstDisplay * dstLight, 1.0)).rgb;
        #include <colorspace_fragment>
      `);
    };
    material.customProgramCacheKey = () => `${previousKey}:dst-world-lightmap-v2`;
    material.needsUpdate = true;
    this.patchedMaterials.add(material);
  }
}
