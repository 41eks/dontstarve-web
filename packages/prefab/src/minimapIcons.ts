import { loadImageAtlasFiles, type ImageAtlasSprite } from '@dontstarve-web/animation/imageAtlas';

// prefabs/minimap.lua registers these two source atlases.
const MINIMAP_ATLAS_PATHS = ['minimap/minimap_data1.xml', 'minimap/minimap_data2.xml'] as const;

/** Fetch and decode both atlases ahead of the first icon request. Their BC textures are decoded on the main
 * thread, so this belongs to loading rather than to the first frame that shows a marker.
 */
export async function preloadMinimapAtlases(root: string): Promise<void> {
  const base = root.replace(/\/$/, '');
  await Promise.all(MINIMAP_ATLAS_PATHS.map(path => loadImageAtlasFiles(`${base}/${path}`)));
}

/** prefabs/minimap.lua registers these two source atlases; resolve the actual
 * named icon instead of substituting a portrait or inventory image.
 */
export async function loadMinimapIcon(root: string, icon: string): Promise<ImageAtlasSprite> {
  const base = root.replace(/\/$/, '');
  for (const path of MINIMAP_ATLAS_PATHS) {
    const atlas = await loadImageAtlasFiles(`${base}/${path}`);
    const sprite = atlas.get(icon);
    if (sprite) return sprite;
  }
  throw new Error(`Minimap atlases lack icon ${icon}`);
}
