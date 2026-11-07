import * as THREE from 'three';
import { loadKtexTexture } from '@dontstarve-web/animation/textureLoader';
import { parseImageAtlasXml } from '@dontstarve-web/animation/imageAtlas';
import { fetchGroundAsset as fetchAsset, loadGroundTileAssets as loadGroundArt,
  groundTileGeometry as drawGroundQuads, type GroundFalloffArt, type GroundTileArt, type GroundTileAssets, type GroundTileQuad } from '@dontstarve-web/display';
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

/** falloffdefs.lua FALLOFF_IDS.FALLOFF: the cliff art under land edges that border void. */
export const GROUND_FALLOFF_ART: GroundFalloffArt = falloff;
