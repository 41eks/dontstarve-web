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

export interface MinimapTileQuad { readonly col: number; readonly row: number; readonly variant: number }

export interface MinimapCellBounds { minCol: number; minRow: number; maxCol: number; maxRow: number }

/** Terrain read model, independent of the live icon collection and map view. */
export interface MinimapTerrain {
  cellRange(): { min: number; max: number };
  tileIdAtCell(col: number, row: number): number;
  isVoidAtCell?(col: number, row: number): boolean;
  /** The returned map may gain layers later (a newly deployed turf); a terrain change follows. */
  tileLayerImages(): Promise<ReadonlyMap<number, MinimapTileLayer>>;
  tileLayerQuads(bounds?: MinimapCellBounds): ReadonlyMap<number, readonly MinimapTileQuad[]>;
  minimapOcean(): Promise<import('./minimap-ocean').MinimapOceanConfig>;
  onTerrainChanged(listener: (bounds?: MinimapCellBounds) => void): () => void;
}
