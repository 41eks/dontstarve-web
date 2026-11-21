import * as THREE from 'three';
import { DEPTH_OFFSET_UNITS } from './animationAssets';
import { injectOceanShading } from './oceanShading';
import type { RgbaSpriteAtlas } from './rgbaSpriteAtlas';

function colourMaterial(atlas: RgbaSpriteAtlas, source: THREE.MeshBasicMaterial): THREE.MeshBasicMaterial {
  const result = new THREE.MeshBasicMaterial({
    map: atlas.texture,
    color: source.color,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    alphaTest: 0.01,
    toneMapped: false,
  });
  result.name = 'Instanced archive sprite colour';
  result.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `
      #include <common>
      attribute vec4 spriteUv;
      attribute float spriteOpacity;
      varying float vSpriteOpacity;
      attribute float spriteLightOverride;
      varying float vSpriteLightOverride;
      attribute float spriteErosion;
      varying float vSpriteErosion;
      attribute float spriteDepthBias;
    `,
      )
      .replace(
        '#include <project_vertex>',
        `
      #include <project_vertex>
      gl_Position.z -= spriteDepthBias * gl_Position.w;
    `,
      )
      .replace(
        '#include <uv_vertex>',
        `
      #include <uv_vertex>
      vMapUv = mix(spriteUv.xy, spriteUv.zw, uv);
      vSpriteOpacity = spriteOpacity;
      vSpriteLightOverride = spriteLightOverride;
      vSpriteErosion = spriteErosion;
    `,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `
      #include <common>
      varying float vSpriteOpacity;
      varying float vSpriteLightOverride;
      varying float vSpriteErosion;
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
  };
  result.customProgramCacheKey = () => 'dst-instanced-archive-sprite-v5';
  return result;
}

/**
 * One atlas page's materials: the transparent colour pass (no depth write) and its alpha-tested, colour-disabled
 * depth prepass, both reading the per-instance sprite attributes.
 */
export function createInstancedSpriteMaterials(
  atlas: RgbaSpriteAtlas,
  source: THREE.MeshBasicMaterial,
): { colour: THREE.MeshBasicMaterial; depth: THREE.MeshBasicMaterial } {
  const colour = colourMaterial(atlas, source),
    depth = colour.clone();
  depth.name = 'Instanced archive sprite depth';
  // Material.clone() deliberately omits callbacks.
  depth.onBeforeCompile = colour.onBeforeCompile;
  depth.customProgramCacheKey = colour.customProgramCacheKey;
  depth.transparent = false;
  depth.colorWrite = false;
  depth.depthWrite = true;
  depth.alphaTest = 0.98;
  return { colour, depth };
}

/** An offset batch draws after the ordinary ones, a few depth-buffer steps towards the camera. */
export function layerInstancedSpriteMeshes(colour: THREE.Mesh, depth: THREE.Mesh, offset: boolean): void {
  colour.renderOrder = offset ? -0.39 : -0.4;
  depth.renderOrder = offset ? -0.395 : -0.41;
  for (const material of [colour.material, depth.material] as THREE.Material[]) {
    if (material.polygonOffset === offset) {
      continue;
    }
    material.polygonOffset = offset;
    material.polygonOffsetFactor = 0;
    material.polygonOffsetUnits = offset ? DEPTH_OFFSET_UNITS : 0;
    material.needsUpdate = true;
  }
}
