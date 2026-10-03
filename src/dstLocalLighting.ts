import * as THREE from 'three';
import { TILE_SIZE } from '@three-roaming/prefab/tile';
import { getPrefabLightOverride, getPrefabLocalLight, type PrefabLocalLight } from '@three-roaming/prefab/localLight';

// DST tiles are 4 units wide; this scene uses TILE_SIZE (12).
// The Lua values are known. Their conversion to shader constants is estimated:
// RC = radius * world scale * 1.5, K0 = log(falloff), K1 = -2, colour *= intensity.
export const TORCH_LIGHT_ESTIMATE = {
  radius: 2 * (TILE_SIZE / 4) * 1.5,
  falloff: 0.5,
  intensity: 0.75,
  colour: new THREE.Vector3(180 / 255, 195 / 255, 150 / 255),
  k0: Math.log(0.5),
  k1: -2,
} as const;

const LIGHTMAP_SIZE = 256;
const LIGHTMAP_SPAN = TORCH_LIGHT_ESTIMATE.radius * 6;

const VERTEX_SHADER = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */`
  uniform vec3 dstAmbientColour;
  uniform vec3 lightColour;
  uniform vec3 lightParameters;
  uniform vec2 lightPosition;
  uniform vec4 dstLightmapExtents;
  uniform float ambientPass;
  varying vec2 vUv;

  void main() {
    if (ambientPass > 0.5) {
      gl_FragColor = vec4(dstAmbientColour, 1.0);
      return;
    }
    vec2 worldXZ = dstLightmapExtents.xy + vUv / dstLightmapExtents.zw;
    float dist = distance(worldXZ, lightPosition);
    float normalizedDistance = max(dist / lightParameters.x, 0.0001);
    float attenuation = clamp(exp(lightParameters.y
      * pow(normalizedDistance, -lightParameters.z)), 0.0, 1.0);
    // Approximate finite support, keeping the map border at ambient colour.
    attenuation *= 1.0 - smoothstep(2.5, 3.0, normalizedDistance);
    gl_FragColor = vec4(lightColour * attenuation, 1.0);
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
  private readonly prefabLights: { owner: THREE.Object3D; settings: PrefabLocalLight }[] = [];
  private torchOwner: THREE.Object3D | null = null;
  private readonly ambient = { value: new THREE.Vector3() };
  private readonly extents = { value: new THREE.Vector4(0, 0, 1 / LIGHTMAP_SPAN, 1 / LIGHTMAP_SPAN) };
  private readonly lightmap = { value: this.target.texture };
  private readonly lightmapMaterial: THREE.ShaderMaterial;

  constructor() {
    this.target.texture.name = 'DST world XZ lightmap';
    this.target.texture.colorSpace = THREE.NoColorSpace;
    const material = new THREE.ShaderMaterial({
      name: 'DST estimated local light falloff',
      uniforms: {
        dstAmbientColour: this.ambient,
        ambientPass: { value: 1 },
        lightColour: { value: new THREE.Vector3() },
        lightParameters: { value: new THREE.Vector3() },
        lightPosition: { value: new THREE.Vector2() },
        dstLightmapExtents: this.extents,
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.lightmapMaterial = material;
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  setAmbientColour(colour: THREE.Vector3): void {
    this.ambient.value.copy(colour);
  }

  setTorchOwner(owner: THREE.Object3D | null): void {
    this.torchOwner = owner;
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
    if (this.torchOwner) accumulate(this.torchOwner, {
      radius: TORCH_LIGHT_ESTIMATE.radius, intensity: TORCH_LIGHT_ESTIMATE.intensity,
      falloff: TORCH_LIGHT_ESTIMATE.falloff, colour: TORCH_LIGHT_ESTIMATE.colour.toArray(),
    });
    return Math.min(1, colour.x) * 0.2126 + Math.min(1, colour.y) * 0.7152 + Math.min(1, colour.z) * 0.0722;
  }

  renderLightmap(renderer: THREE.WebGLRenderer): void {
    const sources = [...this.prefabLights];
    if (this.torchOwner) sources.push({ owner: this.torchOwner, settings: {
      radius: TORCH_LIGHT_ESTIMATE.radius,
      falloff: TORCH_LIGHT_ESTIMATE.falloff,
      intensity: TORCH_LIGHT_ESTIMATE.intensity,
      colour: [TORCH_LIGHT_ESTIMATE.colour.x, TORCH_LIGHT_ESTIMATE.colour.y, TORCH_LIGHT_ESTIMATE.colour.z],
    } });
    const lights = sources.map(({ owner, settings }) => ({
      settings, position: owner.getWorldPosition(new THREE.Vector3()),
    }));
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const { position, settings } of lights) {
      const support = settings.radius * 3;
      minX = Math.min(minX, position.x - support);
      minZ = Math.min(minZ, position.z - support);
      maxX = Math.max(maxX, position.x + support);
      maxZ = Math.max(maxZ, position.z + support);
    }
    if (lights.length) {
      this.ownerPosition.copy(lights[0].position);
      this.extents.value.set(minX, minZ, 1 / (maxX - minX), 1 / (maxZ - minZ));
    } else {
      this.extents.value.set(this.ownerPosition.x - LIGHTMAP_SPAN / 2,
        this.ownerPosition.z - LIGHTMAP_SPAN / 2, 1 / LIGHTMAP_SPAN, 1 / LIGHTMAP_SPAN);
    }
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const material = this.lightmapMaterial;
    try {
      renderer.setRenderTarget(this.target);
      renderer.autoClear = true;
      material.blending = THREE.NoBlending;
      material.uniforms.ambientPass.value = 1;
      renderer.render(this.scene, this.camera);
      material.blending = THREE.AdditiveBlending;
      material.uniforms.ambientPass.value = 0;
      renderer.autoClear = false;
      // Each source gets a pass, avoiding a fixed maximum light count. RGBA8
      // addition clamps ambient + lights, matching the existing estimate.
      for (const { settings, position } of lights) {
        (material.uniforms.lightColour.value as THREE.Vector3)
          .fromArray(settings.colour).multiplyScalar(settings.intensity);
        (material.uniforms.lightParameters.value as THREE.Vector3)
          .set(settings.radius, Math.log(settings.falloff), -2);
        (material.uniforms.lightPosition.value as THREE.Vector2).set(position.x, position.z);
        renderer.render(this.scene, this.camera);
      }
    } finally {
      renderer.autoClear = previousAutoClear;
      renderer.setRenderTarget(previousTarget);
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
        if (uniform) uniform.value = lightOverride;
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
