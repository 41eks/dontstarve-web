import type { MinimapPixels } from './minimap';

/** TUNING.OCEAN_MINIMAP_SHADER */
export interface MinimapOceanTuning {
  readonly TEXTURE_ALPHA_BLUR_SIZE: number;
  readonly TEXTURE_ALPHA_BLUR_PASS_COUNT: number;
  readonly MASK_BLUR_SIZE: number;
  readonly MASK_BLUR_PASS_COUNT: number;
  readonly EDGE_COLOR0: readonly number[];
  readonly EDGE_PARAMS0: { readonly THRESHOLD: number; readonly HALF_THRESHOLD_RANGE: number };
  readonly EDGE_COLOR1: readonly number[];
  readonly EDGE_PARAMS1: { readonly THRESHOLD: number; readonly HALF_THRESHOLD_RANGE: number };
  readonly EDGE_SHADOW_COLOR: readonly number[];
  readonly EDGE_SHADOW_PARAMS: {
    readonly THRESHOLD: number; readonly HALF_THRESHOLD_RANGE: number; readonly UV_OFFSET_X: number; readonly UV_OFFSET_Y: number;
  };
  readonly EDGE_FADE_PARAMS: { readonly THRESHOLD: number; readonly HALF_THRESHOLD_RANGE: number; readonly MASK_INSET: number };
  readonly EDGE_NOISE_PARAMS: { readonly UV_SCALE: number };
}

export interface MinimapOceanConfig {
  readonly oceanTileIds: ReadonlySet<number>;
  /** minimap_color {r, g, b, a} of the ocean tiles (0-255). */
  readonly colour: readonly number[];
  readonly paper: MinimapPixels;
  readonly tuning: MinimapOceanTuning;
}

/** One texel per DST tile (TILE_SCALE = 4 world units), so the tuning's blur sizes keep their meaning. */
const TEXEL_WORLD_SIZE = 4;

/** Repeated edge-clamped box blur, as MiniMapRenderer's texture blur with SIZE and PASS_COUNT. */
export function boxBlur(values: Float32Array, side: number, size: number, passes: number): Float32Array {
  let source = values.slice(), target = new Float32Array(values.length);
  const window = 2 * size + 1;
  for (let pass = 0; pass < passes; pass++) {
    for (const horizontal of [true, false]) {
      for (let line = 0; line < side; line++) {
        const at = (i: number) => horizontal ? line * side + Math.min(side - 1, Math.max(0, i)) : Math.min(side - 1, Math.max(0, i)) * side + line;
        let sum = 0;
        for (let i = -size; i <= size; i++) sum += source[at(i)];
        for (let i = 0; i < side; i++) {
          target[horizontal ? line * side + i : i * side + line] = sum / window;
          sum += source[at(i + size + 1)] - source[at(i - size)];
        }
      }
      [source, target] = [target, source];
    }
  }
  return source;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function bilinear(values: Float32Array, side: number, u: number, v: number): number {
  const x = Math.min(side - 1, Math.max(0, u * side - 0.5)), y = Math.min(side - 1, Math.max(0, v * side - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(side - 1, x0 + 1), y1 = Math.min(side - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  return (values[y0 * side + x0] * (1 - fx) + values[y0 * side + x1] * fx) * (1 - fy)
    + (values[y1 * side + x0] * (1 - fx) + values[y1 * side + x1] * fx) * fy;
}

/** Repeating (wrapped) bilinear RGB sample in 0-1. */
function paperAt(paper: MinimapPixels, u: number, v: number, out: [number, number, number]): void {
  const x = (u - Math.floor(u)) * paper.width - 0.5, y = (v - Math.floor(v)) * paper.height - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const wrapX = (i: number) => ((i % paper.width) + paper.width) % paper.width;
  const wrapY = (i: number) => ((i % paper.height) + paper.height) % paper.height;
  for (let c = 0; c < 3; c++) {
    const at = (px: number, py: number) => paper.data[(wrapY(py) * paper.width + wrapX(px)) * 4 + c];
    out[c] = ((at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy) / 255;
  }
}

/**
 * minimapocean.ksh over the whole world. `isOcean(col, row)` covers `side` x `side` cells
 * of `cellSize` world units; row increases with world z and image rows follow it.
 *
 * MiniMapRenderer builds its inputs in C++, so these are inferred from the shader: the
 * alpha texture is land coverage (1 on land, 0 on ocean, blurred), the mask is ocean
 * coverage (blurred), and the colour is the ocean tile's minimap_color.
 */
export function renderMinimapOcean(side: number, cellSize: number, isOcean: (col: number, row: number) => boolean,
  config: MinimapOceanConfig, pixelsPerCell: number): MinimapPixels {
  const { tuning } = config;
  const texelsPerCell = Math.max(1, Math.round(cellSize / TEXEL_WORLD_SIZE));
  const texels = side * texelsPerCell;
  const land = new Float32Array(texels * texels), mask = new Float32Array(texels * texels);
  for (let y = 0; y < texels; y++) for (let x = 0; x < texels; x++) {
    const ocean = isOcean(Math.floor(x / texelsPerCell), Math.floor(y / texelsPerCell));
    land[y * texels + x] = ocean ? 0 : 1;
    mask[y * texels + x] = ocean ? 1 : 0;
  }
  const alphaTexture = boxBlur(land, texels, tuning.TEXTURE_ALPHA_BLUR_SIZE, tuning.TEXTURE_ALPHA_BLUR_PASS_COUNT);
  const maskTexture = boxBlur(mask, texels, tuning.MASK_BLUR_SIZE, tuning.MASK_BLUR_PASS_COUNT);

  const size = side * pixelsPerCell;
  const data = new Uint8ClampedArray(size * size * 4);
  const base = config.colour.slice(0, 3).map(value => value / 255);
  const edge0 = tuning.EDGE_COLOR0.map(value => value / 255), edge1 = tuning.EDGE_COLOR1.map(value => value / 255);
  const shadowColour = tuning.EDGE_SHADOW_COLOR.map(value => value / 255);
  const { EDGE_PARAMS0: p0, EDGE_PARAMS1: p1, EDGE_SHADOW_PARAMS: ps, EDGE_FADE_PARAMS: pf } = tuning;
  const inset = pf.MASK_INSET, range = 1 + 2 * inset;
  const paper: [number, number, number] = [0, 0, 0];
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = (px + 0.5) / size, v = (py + 0.5) / size;
    const maskAlpha = bilinear(maskTexture, texels,
      Math.min(1, Math.max(0, u * range - inset)), Math.min(1, Math.max(0, v * range - inset)));
    const landAlpha = bilinear(alphaTexture, texels, u, v);
    paperAt(config.paper, u * tuning.EDGE_NOISE_PARAMS.UV_SCALE, v * tuning.EDGE_NOISE_PARAMS.UV_SCALE, paper);
    const amount0 = smoothstep(p0.THRESHOLD - p0.HALF_THRESHOLD_RANGE, p0.THRESHOLD + p0.HALF_THRESHOLD_RANGE, maskAlpha);
    const amount1 = smoothstep(p1.THRESHOLD - p1.HALF_THRESHOLD_RANGE, p1.THRESHOLD + p1.HALF_THRESHOLD_RANGE, landAlpha);
    const alpha = smoothstep(pf.THRESHOLD - pf.HALF_THRESHOLD_RANGE, pf.THRESHOLD + pf.HALF_THRESHOLD_RANGE, 1 - landAlpha);
    const shadowSample = bilinear(alphaTexture, texels, u + ps.UV_OFFSET_X, v + ps.UV_OFFSET_Y);
    const shadowAlpha = smoothstep(ps.THRESHOLD - ps.HALF_THRESHOLD_RANGE, ps.THRESHOLD + ps.HALF_THRESHOLD_RANGE, 1 - shadowSample);
    const visible = Math.max(alpha, shadowAlpha);
    const i = (py * size + px) * 4;
    for (let c = 0; c < 3; c++) {
      let colour = base[c] + (edge0[c] * paper[c] - base[c]) * amount0;
      colour += (edge1[c] * paper[c] - colour) * amount1;
      colour += (shadowColour[c] * paper[c] - colour) * (1 - alpha);
      data[i + c] = Math.round(colour * visible * 255);
    }
    data[i + 3] = 255;
  }
  return { data, width: size, height: size };
}
