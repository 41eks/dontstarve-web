import * as THREE from 'three';
import { injectOceanShading } from './oceanShading';
import type { RgbaSpriteAtlas } from './rgbaSpriteAtlas';

/**
 * One atlas page's material: transparent and without depth writes, like the ordinary billboards, since each batch is
 * drawn at its place in the scene's key order. It reads the per-instance sprite attributes.
 */
export function createInstancedSpriteMaterial(
  atlas: RgbaSpriteAtlas,
  source: THREE.MeshBasicMaterial,
): THREE.MeshBasicMaterial {
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
  result.customProgramCacheKey = () => 'dst-instanced-archive-sprite-v6';
  return result;
}
