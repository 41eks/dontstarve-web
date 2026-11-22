/**
 * Input picking coverage of an atlas page: one bit per texel, set where the texel's alpha reaches the build atlas
 * materials' `alphaTest` (0.01) when drawn fully opaque. Picking needs no more than that, and a byte per texel made
 * these masks the largest CPU copy of the build atlases (as large as the BC3 blocks themselves).
 *
 * Texel `i = y * width + x` is bit `i & 7` of byte `i >> 3`, in the vertically flipped layout of the decoded RGBA.
 */
export interface AlphaMask {
  readonly width: number;
  readonly height: number;
  readonly bits: Uint8Array;
}

/** The smallest 8-bit alpha that a material with `alphaTest` 0.01 draws at full opacity: ceil(0.01 * 255). */
export const ALPHA_MASK_THRESHOLD = 3;

/** Packs one alpha value per texel, read with `stride` and `offset` (RGBA: 4 and 3; an alpha plane: 1 and 0). */
export function packAlphaMask(alpha: Uint8Array, width: number, height: number, stride = 1, offset = 0): AlphaMask {
  const count = width * height;
  const bits = new Uint8Array((count + 7) >> 3);
  for (let texel = 0, source = offset; texel < count; texel++, source += stride) {
    if (alpha[source] >= ALPHA_MASK_THRESHOLD) {
      bits[texel >> 3] |= 1 << (texel & 7);
    }
  }
  return { width, height, bits };
}

/** 1 where texel (x, y) is covered, else 0. */
export function alphaMaskTexel(mask: AlphaMask, x: number, y: number): number {
  const texel = y * mask.width + x;
  return (mask.bits[texel >> 3] >> (texel & 7)) & 1;
}
