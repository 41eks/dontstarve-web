import * as THREE from 'three';
import { loadGroundTileAssets as loadGroundArt,
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

/** tiledefs.lua minimap_tile_def: a minimap render layer's map_edge atlas, its XML and the tile's minimap noise. */
export interface GroundTileMinimapArt {
  readonly texture: string;
  readonly atlas: string;
  readonly noise: string;
  readonly renderOrder: number;
}

/** The minimap render layer art of a named tile; the minimap loads it. */
export function groundTileMinimapArt(name: GroundTileName): GroundTileMinimapArt {
  const { minimap, renderOrder } = definitions[name];
  return { texture: minimap.texture, atlas: minimap.atlas, noise: minimap.noise, renderOrder };
}

/** Quads of one terrain layer in world tiles. */
export function groundTileGeometry(quads: readonly GroundTileQuad[], assets: GroundTileAssets, size: number): THREE.BufferGeometry {
  return drawGroundQuads(quads, assets, size, TILE_SIZE);
}

/** falloffdefs.lua FALLOFF_IDS.FALLOFF: the cliff art under land edges that border void. */
export const GROUND_FALLOFF_ART: GroundFalloffArt = falloff;
