import * as THREE from 'three';
import { loadKtexTexture } from '@dontstarve-web/animation/textureLoader';
import { parseImageAtlasXml, type ImageAtlasElement } from '@dontstarve-web/animation/imageAtlas';
import { fetchGroundAsset as fetchAsset, loadGroundTexture as texture, loadGroundTileAssets as loadGroundArt,
  groundTileGeometry as drawGroundQuads, type GroundTileArt, type GroundTileAssets, type GroundTileQuad } from '@dontstarve-web/display';
import definitions from './groundTiles.json';
import falloff from './groundFalloff.json';
import { TILE_SIZE } from './tile';
import { groundTileVariant } from './groundTileQuads';

export const GROUND_TILE_DEFINITIONS = definitions;
export type GroundTileName = keyof typeof definitions;

export { groundTileVariant };
export type { GroundTileAssets, GroundTileQuad };

/** tiledefs.lua ground_tile_def: the art a tile's render layer names. */
export function groundTileArt(name: GroundTileName): GroundTileArt {
  const { texture, atlas, noise } = definitions[name];
  return { name, texture, atlas, noise };
}

/** ground.ksh art of a named tile; loading belongs to the display. */
export function loadGroundTileAssets(root: string, name: GroundTileName): Promise<GroundTileAssets> {
  return loadGroundArt(root, groundTileArt(name));
}

/** Straight-alpha RGBA pixels, top row first. */
export interface GroundTilePixels { readonly data: Uint8ClampedArray; readonly width: number; readonly height: number }

/** A mask's rectangle in its atlas, as top-down texture coordinates. */
export interface GroundTileMaskRect { readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number }

/** What MapLayerManager:CreateRenderLayer receives: the tile atlas, its 48 mask rectangles and the noise texture. */
export interface GroundTileLayerImage {
  readonly atlas: GroundTilePixels;
  readonly masks: ReadonlyMap<number, GroundTileMaskRect>;
  readonly noise: GroundTilePixels;
  readonly renderOrder: number;
}

/** Every tile names the same map_edge atlas; decode each path once and share the pixels. */
const minimapPixels = new Map<string, Promise<GroundTilePixels>>();
function loadMinimapPixels(url: string): Promise<GroundTilePixels> {
  let request = minimapPixels.get(url);
  if (!request) {
    request = loadKtexTexture(url).then(({ pixels, width, height }) => ({ data: Uint8ClampedArray.from(pixels), width, height }));
    minimapPixels.set(url, request);
    void request.catch(() => minimapPixels.delete(url));
  }
  return request;
}

/**
 * MapLayerManager:CreateRenderLayer inputs for a tile: the map_edge atlas with
 * its 48 masks and the tile's own minimap noise (tiledefs.lua `minimap_tile_def`).
 */
export async function loadGroundTileMinimapLayer(root: string, name: GroundTileName): Promise<GroundTileLayerImage> {
  const { minimap } = definitions[name];
  const base = root.replace(/\/$/, '');
  const [atlas, noise, xml] = await Promise.all([
    loadMinimapPixels(`${base}/${minimap.texture}`), loadMinimapPixels(`${base}/${minimap.noise}`),
    fetchAsset(root, minimap.atlas).then((response) => response.text()),
  ]);
  const elements = parseImageAtlasXml(xml, minimap.atlas).elements;
  const masks = new Map<number, GroundTileMaskRect>();
  for (let variant = 1; variant <= 48; variant++) {
    const cell = elements.get(String(variant).padStart(2, '0'));
    if (!cell) throw new Error(`Minimap atlas lacks mask ${variant}: ${minimap.atlas}`);
    // parseKtex's rows are top-down; invert XML's bottom-up V coordinates.
    masks.set(variant, { u0: cell.u1, v0: 1 - cell.v2, u1: cell.u2, v1: 1 - cell.v1 });
  }
  return { atlas, masks, noise, renderOrder: definitions[name].renderOrder };
}

/** Quads of one terrain layer in world tiles. */
export function groundTileGeometry(quads: readonly GroundTileQuad[], assets: GroundTileAssets, size: number): THREE.BufferGeometry {
  return drawGroundQuads(quads, assets, size, TILE_SIZE);
}

/** Outward cell offsets of the four sides that can carry a cliff. */
export const FALLOFF_EDGES = [{ dx: 1, dz: 0 }, { dx: 0, dz: -1 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }] as const;
/** Visually calibrated against the cave reference: a motif spans one tile, hanging two tiles below land.
 * Lua exposes the atlas and neighbour rules, but does not expose the native mesh dimensions. */
export const FALLOFF_TEXTURE_WIDTH = TILE_SIZE;
export const FALLOFF_HEIGHT = TILE_SIZE * 2;
/** Multiplies the atlas colour; the reference cliffs are much darker than the lit ground. */
const FALLOFF_BRIGHTNESS = 0.45;

interface FalloffFaceOrder {
  centres: Float64Array;
  depths: Float64Array;
  order: number[];
  matrix?: THREE.Matrix4;
}
const falloffFaceOrders = new WeakMap<THREE.BufferGeometry, FalloffFaceOrder>();

export interface FalloffEdge { col: number; row: number; edge: number }

export interface GroundFalloffAssets {
  readonly material: THREE.MeshLambertMaterial;
  readonly elements: ReadonlyMap<string, ImageAtlasElement>;
}

/** falloffdefs.lua FALLOFF_IDS.FALLOFF: `falloff.tex` has no noise, so the atlas is the material map. */
export async function loadGroundFalloffAssets(root: string): Promise<GroundFalloffAssets> {
  const [atlas, xml] = await Promise.all([texture(root, falloff.texture, false),
    fetchAsset(root, falloff.atlas).then(response => response.text())]);
  const material = new THREE.MeshLambertMaterial({ name: 'DST ground:falloff', map: atlas, side: THREE.DoubleSide,
    depthWrite: false, transparent: true, alphaTest: 1 / 255 });
  material.color.setScalar(FALLOFF_BRIGHTNESS);
  material.forceSinglePass = true;
  // The reference cliffs disappear into cave void: darken the rock from the ground edge down to black.
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying float vGroundFalloffDepth;').replace('#include <begin_vertex>',
      `#include <begin_vertex>\nvGroundFalloffDepth = -position.y / ${FALLOFF_HEIGHT.toFixed(1)};`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying float vGroundFalloffDepth;').replace('#include <alphatest_fragment>',
      'diffuseColor.rgb *= 1.0 - smoothstep(0.0, 1.0, vGroundFalloffDepth);\n#include <alphatest_fragment>');
  };
  material.addEventListener('dispose', () => atlas.dispose());
  return { material, elements: parseImageAtlasXml(xml, falloff.atlas).elements };
}

/** Cliff faces standing on `edges` (cell boundaries), dropping `FALLOFF_HEIGHT` below the ground. */
export function groundFalloffGeometry(edges: readonly FalloffEdge[], assets: GroundFalloffAssets): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const centres = new Float64Array(edges.length * 3);
  for (const { col, row, edge } of edges) {
    const { dx, dz } = FALLOFF_EDGES[edge];
    // Consecutive texture-width segments share one atlas cell; crossing zero must not restart the UV span.
    const along = dx ? row : col;
    const segment = Math.floor(along * TILE_SIZE / FALLOFF_TEXTURE_WIDTH);
    const across = dx ? col : row;
    const variant = 1 + Math.abs(Math.imul(segment, 73856093) ^ Math.imul(across, 19349663) ^ Math.imul(edge, 83492791)) % falloff.variants;
    const cell = assets.elements.get(String(variant).padStart(2, '0'));
    if (!cell) throw new Error(`Ground falloff variant ${variant} is unavailable`);
    // The boundary line of the cell on its `dx`/`dz` side, from its low to its high end.
    const x0 = dx ? (col + (dx > 0 ? 1 : 0)) * TILE_SIZE : col * TILE_SIZE;
    const z0 = dz ? (row + (dz > 0 ? 1 : 0)) * TILE_SIZE : row * TILE_SIZE;
    const offset = positions.length / 3;
    const face = offset / 4;
    centres.set([dx ? x0 : x0 + TILE_SIZE / 2, -FALLOFF_HEIGHT / 2, dx ? z0 + TILE_SIZE / 2 : z0], face * 3);
    for (const t of [0, TILE_SIZE]) for (const y of [0, -FALLOFF_HEIGHT]) {
      positions.push(dx ? x0 : x0 + t, y, dx ? z0 + t : z0);
      // parseKtex's rows are top-down; invert XML's bottom-up V coordinates.
      const u = (along * TILE_SIZE - segment * FALLOFF_TEXTURE_WIDTH + t) / FALLOFF_TEXTURE_WIDTH;
      uvs.push(THREE.MathUtils.lerp(cell.u1, cell.u2, u),
        y === 0 ? 1 - cell.v2 : 1 - cell.v1);
    }
    indices.push(offset, offset + 1, offset + 2, offset + 2, offset + 1, offset + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  if (positions.length) { geometry.computeBoundingBox(); geometry.computeBoundingSphere(); }
  falloffFaceOrders.set(geometry, { centres, depths: new Float64Array(edges.length),
    order: Array.from({ length: edges.length }, (_, i) => i) });
  return geometry;
}

/** Three.js sorts transparent objects, not faces within a merged mesh. Reorder only its index buffer. */
export function sortGroundFalloffGeometry(geometry: THREE.BufferGeometry, modelView: THREE.Matrix4): void {
  const data = falloffFaceOrders.get(geometry);
  if (!data || data.matrix?.equals(modelView)) return;
  (data.matrix ??= new THREE.Matrix4()).copy(modelView);
  const matrix = modelView.elements;
  for (let i = 0; i < data.order.length; i++) {
    const p = i * 3;
    data.depths[i] = matrix[2] * data.centres[p] + matrix[6] * data.centres[p + 1]
      + matrix[10] * data.centres[p + 2] + matrix[14];
  }
  data.order.sort((a, b) => data.depths[a] - data.depths[b] || a - b);
  const index = geometry.index!;
  data.order.forEach((face, i) => {
    const v = face * 4, offset = i * 6;
    index.setX(offset, v); index.setX(offset + 1, v + 1); index.setX(offset + 2, v + 2);
    index.setX(offset + 3, v + 2); index.setX(offset + 4, v + 1); index.setX(offset + 5, v + 3);
  });
  index.needsUpdate = true;
}
