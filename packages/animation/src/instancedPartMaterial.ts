import * as THREE from 'three';
import { PREMULTIPLIED_SRGB_TEXEL } from './atlasFormat';
import { PART_TEXELS, type InstancedPartTable } from './instancedPartTable';
import { injectOceanShading } from './oceanShading';
import {
  SPRITE_PLACEMENT_DECLARATIONS,
  SPRITE_PLACEMENT_VERTEX,
  type SpriteCameraRotation,
} from './instancedSpritePlacement';

interface PartUniforms {
  partTable: THREE.IUniform<THREE.Texture | null>;
  partSlots: THREE.IUniform<number>;
  partMap1: THREE.IUniform<THREE.Texture | null>;
  partMap2: THREE.IUniform<THREE.Texture | null>;
  partMap3: THREE.IUniform<THREE.Texture | null>;
  partPremultiplied: THREE.IUniform<THREE.Vector4>;
}

/**
 * A part table batch's material. Like a composed page's (`createInstancedSpriteMaterial`) it is a transparent
 * MeshBasicMaterial without depth writes reading the per-entity sprite attributes, so world lighting and ocean shading
 * patch it the same way. Each instance is one part slot of one entity (instance id = entity × slots + slot): the
 * vertex shader places the unit quad by the slot's row of the instance's frame, and the fragment shader samples the
 * part's own build atlas (`map` is texture 0, `partMap1..3` the others).
 */
export class InstancedPartMaterial extends THREE.MeshBasicMaterial {
  readonly partUniforms: PartUniforms = {
    partTable: { value: null },
    partSlots: { value: 1 },
    partMap1: { value: null },
    partMap2: { value: null },
    partMap3: { value: null },
    partPremultiplied: { value: new THREE.Vector4() },
  };
  private readonly cameraRotation: SpriteCameraRotation;
  constructor(table: InstancedPartTable, source: THREE.MeshBasicMaterial, cameraRotation: SpriteCameraRotation) {
    super({
      color: source.color,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      alphaTest: 0.01,
      toneMapped: false,
    });
    this.name = 'Instanced archive sprite parts';
    this.cameraRotation = cameraRotation;
    this.bind(table);
  }

  /**
   * Points the material at `table` and its textures. The program samples any of MAX_PART_TEXTURES maps whatever the
   * table uses, so rebinding never recompiles (world lighting captures the cache key once when it patches a material).
   */
  bind(table: InstancedPartTable): void {
    const uniforms = this.partUniforms;
    this.map = table.textures[0];
    uniforms.partTable.value = table.texture;
    uniforms.partSlots.value = table.slots;
    uniforms.partMap1.value = table.textures[1] ?? null;
    uniforms.partMap2.value = table.textures[2] ?? null;
    uniforms.partMap3.value = table.textures[3] ?? null;
    uniforms.partPremultiplied.value.set(
      ...([0, 1, 2, 3].map(index => (table.premultiplied[index] ? 1 : 0)) as [number, number, number, number]),
    );
  }

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms, _renderer?: THREE.WebGLRenderer): void {
    for (const [name, uniform] of Object.entries(this.partUniforms)) {
      shader.uniforms[name] = uniform;
    }
    shader.uniforms.spriteCameraRotation = this.cameraRotation;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `
      #include <common>
      uniform highp sampler2D partTable;
      uniform int partSlots;
      attribute float partFrame;
      ${SPRITE_PLACEMENT_DECLARATIONS}
      attribute float spriteOpacity;
      varying float vSpriteOpacity;
      attribute float spriteLightOverride;
      varying float vSpriteLightOverride;
      attribute float spriteErosion;
      varying float vSpriteErosion;
      flat varying int vPartTexture;
    `,
      )
      .replace(
        '#include <uv_vertex>',
        `
      #include <uv_vertex>
      ivec2 partCell = ivec2((gl_InstanceID % partSlots) * ${PART_TEXELS}, int(partFrame));
      vec4 partAxes = texelFetch(partTable, partCell, 0);
      vec4 partOrigin = texelFetch(partTable, partCell + ivec2(1, 0), 0);
      vec4 partUv = texelFetch(partTable, partCell + ivec2(2, 0), 0);
      vMapUv = mix(partUv.xy, partUv.zw, position.xy);
      vPartTexture = int(partOrigin.z + 0.5);
      vSpriteOpacity = spriteOpacity;
      vSpriteLightOverride = max(spriteLightOverride, partOrigin.w);
      vSpriteErosion = spriteErosion;
    `,
      )
      .replace(
        '#include <begin_vertex>',
        `
      vec3 transformed = vec3(
        partAxes.x * position.x + partAxes.z * position.y + partOrigin.x,
        partAxes.y * position.x + partAxes.w * position.y + partOrigin.y,
        0.0
      );
      ${SPRITE_PLACEMENT_VERTEX}
    `,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `
      #include <common>
      uniform sampler2D partMap1;
      uniform sampler2D partMap2;
      uniform sampler2D partMap3;
      uniform vec4 partPremultiplied;
      varying float vSpriteOpacity;
      varying float vSpriteLightOverride;
      varying float vSpriteErosion;
      flat varying int vPartTexture;
      ${PREMULTIPLIED_SRGB_TEXEL}
    `,
      )
      .replace(
        '#include <map_fragment>',
        `
      vec4 partTexel = vec4(0.0);
      float partPremultipliedTexel = 0.0;
      ${[0, 1, 2, 3]
        .map(
          index => `${index ? 'else ' : ''}if (vPartTexture == ${index}) {
        partTexel = texture2D(${index ? `partMap${index}` : 'map'}, vMapUv);
        partPremultipliedTexel = partPremultiplied[${index}];
      }`,
        )
        .join('\n      ')}
      if (partPremultipliedTexel > 0.5) {
        partTexel = dstPremultipliedSrgbTexel(partTexel);
      }
      diffuseColor *= partTexel;
    `,
      )
      .replace(
        '#include <color_fragment>',
        `
      #include <color_fragment>
      diffuseColor.a *= vSpriteOpacity;
      if (vSpriteErosion > 0.0) {
        float erosionNoise = fract(sin(dot(vMapUv * 1024.0, vec2(12.9898, 78.233))) * 43758.5453);
        if (erosionNoise < vSpriteErosion) discard;
      }
    `,
      );
    injectOceanShading(shader, { kind: 'attributes' });
  }

  override customProgramCacheKey(): string {
    return 'dst-instanced-archive-sprite-parts-v2';
  }
}
