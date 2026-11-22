import * as THREE from 'three';

/**
 * How build atlases reach the GPU. BC1–BC3 KTEX pages are uploaded as their blocks where the renderer can sample them
 * and composes instanced appearances on the GPU (the canvas fallback needs RGBA); otherwise they are decoded to RGBA.
 * DOM/UI readers of build atlases always load RGBA.
 */
let compressedAtlases = false;

/** Rendering premultiplied 16-bit colour needs one of these; without them the canvas path composes instead. */
export function canComposeAtlasOnGpu(renderer: THREE.WebGLRenderer): boolean {
  return renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
}

/** Chooses the atlas format for the renderer that draws build atlases, before their archives are loaded. */
export function configureAtlasCompression(renderer: THREE.WebGLRenderer): boolean {
  compressedAtlases =
    renderer.extensions.has('WEBGL_compressed_texture_s3tc') &&
    renderer.extensions.has('WEBGL_compressed_texture_s3tc_srgb') &&
    canComposeAtlasOnGpu(renderer);
  return compressedAtlases;
}

/** Whether scene sprites load their build atlases as BC blocks. */
export function atlasCompressionEnabled(): boolean {
  return compressedAtlases;
}

const premultipliedSrgbSources = new WeakSet<THREE.Source<unknown>>();

/**
 * BC2/BC3 colour is premultiplied by alpha. The sampler's sRGB decode would run on the premultiplied value, so these
 * pages are uploaded without it and every shader sampling them divides by alpha before decoding (see
 * `PREMULTIPLIED_SRGB_TEXEL`). Filtering then also interpolates premultiplied texels, as their encoding intends.
 */
export function markPremultipliedSrgbAtlas(source: THREE.Source<unknown>): void {
  premultipliedSrgbSources.add(source);
}

export function isPremultipliedSrgbAtlas(texture: THREE.Texture | null | undefined): boolean {
  return !!texture && premultipliedSrgbSources.has(texture.source);
}

/** GLSL: a raw premultiplied-sRGB texel as straight linear colour, as the decoded RGBA atlases are sampled. */
export const PREMULTIPLIED_SRGB_TEXEL = /* glsl */ `
  vec4 dstPremultipliedSrgbTexel(vec4 texel) {
    vec3 straight = texel.a > 0.0 ? min(texel.rgb / texel.a, vec3(1.0)) : vec3(0.0);
    vec3 linear = mix(
      pow(straight * 0.9478672986 + vec3(0.0521327014), vec3(2.4)),
      straight * 0.0773993808,
      vec3(lessThanEqual(straight, vec3(0.04045)))
    );
    return vec4(linear, texel.a);
  }
`;
