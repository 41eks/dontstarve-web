import { loadKtexTexture } from '@dontstarve-web/animation/textureLoader';
import { parseImageAtlasXml } from '@dontstarve-web/animation/imageAtlas';
import type {
  MinimapMaskRect,
  MinimapPixels,
  MinimapTileLayer,
  MinimapTileLayerArt,
} from '../../ui/src/minimap-terrain';

/** Every tile names the same map_edge atlas; decode each path once and share the pixels. */
const minimapPixels = new Map<string, Promise<MinimapPixels>>();
function loadMinimapPixels(url: string): Promise<MinimapPixels> {
  let request = minimapPixels.get(url);
  if (!request) {
    request = loadKtexTexture(url).then(({ pixels, width, height }) => ({
      data: Uint8ClampedArray.from(pixels),
      width,
      height,
    }));
    minimapPixels.set(url, request);
    void request.catch(() => minimapPixels.delete(url));
  }
  return request;
}

/**
 * MapLayerManager:CreateRenderLayer inputs for a tile: the map_edge atlas with
 * its 48 masks and the tile's own minimap noise (tiledefs.lua `minimap_tile_def`).
 */
export async function loadMinimapTileLayer(root: string, art: MinimapTileLayerArt): Promise<MinimapTileLayer> {
  const base = root.replace(/\/$/, '');
  const [atlas, noise, xml] = await Promise.all([
    loadMinimapPixels(`${base}/${art.texture}`),
    loadMinimapPixels(`${base}/${art.noise}`),
    fetch(`${base}/${art.atlas}`).then(response => {
      if (!response.ok) {
        throw new Error(`Unable to load ${art.atlas}: HTTP ${response.status}`);
      }
      return response.text();
    }),
  ]);
  const elements = parseImageAtlasXml(xml, art.atlas).elements;
  const masks = new Map<number, MinimapMaskRect>();
  for (let variant = 1; variant <= 48; variant++) {
    const cell = elements.get(String(variant).padStart(2, '0'));
    if (!cell) {
      throw new Error(`Minimap atlas lacks mask ${variant}: ${art.atlas}`);
    }
    // parseKtex's rows are top-down; invert XML's bottom-up V coordinates.
    masks.set(variant, { u0: cell.u1, v0: 1 - cell.v2, u1: cell.u2, v1: 1 - cell.v1 });
  }
  return { atlas, masks, noise, renderOrder: art.renderOrder };
}

/** Loads the declared layers not yet in `layers`, adding each as it arrives. */
export async function loadMinimapTileLayers(
  root: string,
  declared: ReadonlyMap<number, MinimapTileLayerArt>,
  layers = new Map<number, MinimapTileLayer>(),
): Promise<Map<number, MinimapTileLayer>> {
  await Promise.all(
    [...declared]
      .filter(([id]) => !layers.has(id))
      .map(async ([id, art]) => {
        layers.set(id, await loadMinimapTileLayer(root, art));
      }),
  );
  return layers;
}
