import type * as THREE from 'three';

/**
 * DST draws an anim's quads about the entity's projected origin: the camera's perspective places the origin, and the
 * art keeps its view-space shape around it, scaled by the origin's depth (a weak perspective). OnGround art lying flat
 * then looks as it was painted wherever it is on screen, instead of shearing towards the screen centre's vanishing
 * point. Depth stays per vertex, so sorting and occlusion are unchanged. A camera-facing billboard lies at one view
 * depth, where this is the full perspective.
 */
const PROJECT_ABOUT_ORIGIN = `
  #include <project_vertex>
  vec4 spriteOriginView = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 spriteOriginClip = projectionMatrix * spriteOriginView;
  if (spriteOriginClip.w > 1e-4 && gl_Position.w > 1e-4) {
    vec2 spriteOffset = vec2(projectionMatrix[0][0], projectionMatrix[1][1]) * (mvPosition.xy - spriteOriginView.xy);
    gl_Position = vec4(spriteOriginClip.xy + spriteOffset, gl_Position.z / gl_Position.w * spriteOriginClip.w, spriteOriginClip.w);
  }
`;

const projected = new WeakSet<THREE.Material>();

/**
 * Projects a sprite material's quads about their mesh origin. Material.clone and copy drop compile hooks, so every
 * private copy of a sprite material installs it again; chained hooks (lighting, tint) keep it.
 */
export function projectAboutOrigin<M extends THREE.Material>(material: M): M {
  if (projected.has(material)) return material;
  projected.add(material);
  const previousCompile = material.onBeforeCompile.bind(material), previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', PROJECT_ABOUT_ORIGIN);
  };
  material.customProgramCacheKey = () => previousKey + ':spriteOrigin';
  return material;
}
