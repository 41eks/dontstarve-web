import { loadImageAtlasFiles, type ImageAtlasSprite } from '@dontstarve-web/animation/imageAtlas';

/** prefabs/minimap.lua registers these two source atlases; resolve the actual
 * named icon instead of substituting a portrait or inventory image.
 */
export async function loadMinimapIcon(root: string, icon: string): Promise<ImageAtlasSprite> {
  const base = root.replace(/\/$/, '');
  for (const path of ['minimap/minimap_data1.xml', 'minimap/minimap_data2.xml']) {
    const atlas = await loadImageAtlasFiles(`${base}/${path}`);
    const sprite = atlas.get(icon);
    if (sprite) return sprite;
  }
  throw new Error(`Minimap atlases lack icon ${icon}`);
}
