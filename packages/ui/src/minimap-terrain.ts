/** Straight-alpha RGBA pixels, top row first. */
export interface MinimapPixels { readonly data: Uint8ClampedArray; readonly width: number; readonly height: number }

/** A mask's rectangle in its atlas, as top-down texture coordinates. */
export interface MinimapMaskRect { readonly u0: number; readonly v0: number; readonly u1: number; readonly v1: number }

/** Inputs of MapLayerManager:CreateRenderLayer, in source layer order. */
export interface MinimapTileLayer {
  /** The map_edge atlas; tiles sharing it pass the same pixels object. */
  readonly atlas: MinimapPixels;
  /** The 48 edge-mask variants of groundTileVariant(). */
  readonly masks: ReadonlyMap<number, MinimapMaskRect>;
  readonly noise: MinimapPixels;
  readonly renderOrder: number;
}

/** The art a terrain declares for one minimap render layer (tiledefs.lua `minimap_tile_def`); the map loads it. */
export interface MinimapTileLayerArt {
  /** The map_edge atlas texture and its XML; tiles naming the same atlas share its decoded pixels. */
  readonly texture: string;
  readonly atlas: string;
  readonly noise: string;
  readonly renderOrder: number;
}

export interface MinimapTileQuad { readonly col: number; readonly row: number; readonly variant: number }

export interface MinimapCellBounds { minCol: number; minRow: number; maxCol: number; maxRow: number }

/** Terrain read model, independent of the live icon collection and map view. */
export interface MinimapTerrain {
  cellRange(): { min: number; max: number };
  tileIdAtCell(col: number, row: number): number;
  isVoidAtCell?(col: number, row: number): boolean;
  /** Declared minimap layers per tile id. A newly deployed turf adds a layer, and a terrain change follows. */
  tileLayerArt(): ReadonlyMap<number, MinimapTileLayerArt>;
  tileLayerQuads(bounds?: MinimapCellBounds): ReadonlyMap<number, readonly MinimapTileQuad[]>;
  /** Tiles drawn by the minimapocean.ksh pass instead of a land layer. */
  minimapOceanTileIds(): ReadonlySet<number>;
  onTerrainChanged(listener: (bounds?: MinimapCellBounds) => void): () => void;
}
