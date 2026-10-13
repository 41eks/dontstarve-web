import { loadKtexTexture } from '@dontstarve-web/animation/textureLoader';
import definitions from './groundTiles.json';
import oceanMinimap from './minimapOcean.json';
import type { GroundTilePixels } from './groundTiles';

/** Inputs of the minimapocean.ksh pass: ocean tiles, their minimap colour, the paper texture and TUNING.OCEAN_MINIMAP_SHADER. */
export interface MinimapOceanData {
  readonly oceanTileIds: ReadonlySet<number>;
  /** minimap_color {r, g, b, a} of the ocean tiles (0-255). */
  readonly colour: readonly number[];
  readonly paper: GroundTilePixels;
  readonly tuning: typeof oceanMinimap.tuning;
}

export async function loadMinimapOcean(root: string): Promise<MinimapOceanData> {
  const paper = await loadKtexTexture(`${root.replace(/\/$/, '')}/${oceanMinimap.paper}`);
  return {
    oceanTileIds: new Set(Object.entries(definitions).filter(([name]) => name.startsWith('OCEAN_')).map(([, tile]) => tile.tileId)),
    colour: definitions.OCEAN_COASTAL.minimapColour,
    paper: { data: Uint8ClampedArray.from(paper.pixels), width: paper.width, height: paper.height },
    tuning: oceanMinimap.tuning,
  };
}
