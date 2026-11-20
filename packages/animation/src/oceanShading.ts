import * as THREE from 'three';
import { WORLD_SCALE } from './units';

/**
 * anim.ksh's FLOAT_PARAMS and OCEAN_BLEND_PARAMS.x for one entity: AnimState:SetFloatParams(offset, enabled, bob) and
 * AnimState:SetOceanBlendParams(amount).
 */
export interface SpriteOceanShading {
  /** FLOAT_PARAMS: the waterline in DST units, whether drawing below it is cut, and whether the sprite bobs. */
  readonly float: readonly [offset: number, enabled: number, bob: number];
  /** OCEAN_BLEND_PARAMS.x: how far the colour is multiplied by the ocean's colour under it. */
  readonly blend: number;
}

export const NO_OCEAN_SHADING: SpriteOceanShading = Object.freeze({
  float: Object.freeze([0, 0, 0] as const),
  blend: 0,
});

export function hasOceanShading(shading: SpriteOceanShading): boolean {
  return shading.float[1] > 0 || shading.float[2] > 0 || shading.blend > 0;
}

export function sameOceanShading(a: SpriteOceanShading, b: SpriteOceanShading): boolean {
  return a.blend === b.blend && a.float[0] === b.float[0] && a.float[1] === b.float[1] && a.float[2] === b.float[2];
}

const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
white.name = 'DST ocean tint neutral';
white.needsUpdate = true;

/**
 * The scene-wide inputs anim.ksh reads beside each entity's parameters: TIMEPARAMS.x, and the ocean colour texture with
 * its world extents (OCEAN_WORLD_EXTENTS: xy the minimum, zw one over the span). Without an ocean the tint is white.
 */
export const oceanShadingUniforms = {
  dstShaderTime: { value: 0 },
  dstOceanTint: { value: white as THREE.Texture },
  dstOceanExtents: { value: new THREE.Vector4(0, 0, 1, 1) },
};

/** Advance TIMEPARAMS.x, the clock the float bob follows. */
export function advanceOceanShadingTime(dt: number): void {
  if (Number.isFinite(dt) && dt > 0) {
    oceanShadingUniforms.dstShaderTime.value += dt;
  }
}

/** The ocean renderer's colour texture and extents; `undefined` returns to the neutral tint. */
export function setOceanTint(texture: THREE.Texture | undefined, extents?: THREE.Vector4): void {
  oceanShadingUniforms.dstOceanTint.value = texture ?? white;
  if (extents) {
    oceanShadingUniforms.dstOceanExtents.value.copy(extents);
  }
}

/** Where a material reads its entity's parameters: per-instance attributes of a batch, or uniforms of its own copy. */
export type OceanShadingSource =
  | { readonly kind: 'attributes' }
  | {
      readonly kind: 'uniforms';
      readonly float: { value: THREE.Vector3 };
      readonly blend: { value: number };
    };

/** Per-material uniforms for a private copy drawn with `shading`. */
export function oceanShadingMaterialUniforms(
  shading: SpriteOceanShading,
): Extract<OceanShadingSource, { kind: 'uniforms' }> {
  return {
    kind: 'uniforms',
    float: { value: new THREE.Vector3(...shading.float) },
    blend: { value: shading.blend },
  };
}

/** Per-instance values: FLOAT_PARAMS in xyz and the ocean blend in w. */
export function oceanShadingInstanceValues(shading: SpriteOceanShading, target: number[]): number[] {
  target[0] = shading.float[0];
  target[1] = shading.float[1];
  target[2] = shading.float[2];
  target[3] = shading.blend;
  return target;
}

const SCALE = WORLD_SCALE.toFixed(6);

/**
 * anim.ksh's float and ocean blend, injected into a three sprite material: the vertex bobs by
 * sin(world_x + world_z + TIMEPARAMS.x * 3) * 0.025 at the sprite's origin (in DST units), the fragment is discarded
 * below the waterline, and the colour is mixed towards colour * ocean tint at the fragment's world xz. three's own
 * projection runs first, so other injections that follow `project_vertex` keep working; the bobbed position replaces
 * gl_Position after it.
 */
export function injectOceanShading(shader: THREE.WebGLProgramParametersWithUniforms, source: OceanShadingSource): void {
  shader.uniforms.dstShaderTime = oceanShadingUniforms.dstShaderTime;
  shader.uniforms.dstOceanTint = oceanShadingUniforms.dstOceanTint;
  shader.uniforms.dstOceanExtents = oceanShadingUniforms.dstOceanExtents;
  const attributes = source.kind === 'attributes';
  if (!attributes) {
    shader.uniforms.dstFloatParams = source.float;
    shader.uniforms.dstOceanBlend = source.blend;
  }
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `
      #include <common>
      uniform float dstShaderTime;
      varying vec3 vDstOceanWorld;
      varying vec4 vDstOceanParams;
      ${attributes ? 'attribute vec4 spriteOcean;\n      attribute vec2 spriteOceanOrigin;' : 'uniform vec3 dstFloatParams;\n      uniform float dstOceanBlend;'}
    `,
    )
    .replace(
      '#include <project_vertex>',
      `
      #include <project_vertex>
      {
        vec4 dstParams = ${attributes ? 'spriteOcean' : 'vec4(dstFloatParams, dstOceanBlend)'};
        vec4 dstLocal = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          dstLocal = instanceMatrix * dstLocal;
        #endif
        vec4 dstWorld = modelMatrix * dstLocal;
        // MatrixW's translation: the batch carries each entity's, a sprite's own mesh sits at its visual's origin.
        vec2 dstOrigin = ${attributes ? 'spriteOceanOrigin' : '(modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz'};
        if (dstParams.z > 0.0) {
          dstWorld.y += sin((dstOrigin.x + dstOrigin.y) / ${SCALE} + dstShaderTime * 3.0) * 0.025 * ${SCALE};
          gl_Position = projectionMatrix * viewMatrix * dstWorld;
        }
        vDstOceanWorld = dstWorld.xyz;
        vDstOceanParams = dstParams;
      }
    `,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `
      #include <common>
      uniform sampler2D dstOceanTint;
      uniform vec4 dstOceanExtents;
      varying vec3 vDstOceanWorld;
      varying vec4 vDstOceanParams;
    `,
    )
    .replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      if (vDstOceanParams.y > 0.0 && vDstOceanWorld.y < vDstOceanParams.x * ${SCALE}) discard;
      if (vDstOceanParams.w > 0.0) {
        vec2 dstOceanUv = (vDstOceanWorld.xz - dstOceanExtents.xy) * dstOceanExtents.zw;
        vec3 dstOceanColour = texture2D(dstOceanTint, dstOceanUv).rgb;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * dstOceanColour, vDstOceanParams.w);
      }
    `,
    );
}
