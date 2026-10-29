import { loadImageAtlasFiles, type ImageAtlasSprite } from '@dontstarve-web/animation/imageAtlas';
import { atlasElementBounds, type ImageAtlasPage } from '../../animation/src/imageAtlasParser';

// prefabs/minimap.lua registers these two source atlases.
const MINIMAP_ATLAS_PATHS = ['minimap/minimap_data1.xml', 'minimap/minimap_data2.xml'] as const;

/** Fetch and decode both atlases ahead of the first icon request. Their BC textures are decoded on the main
 * thread, so this belongs to loading rather than to the first frame that shows a marker.
 */
async function loadMinimapAtlases(root: string) {
  const base = root.replace(/\/$/, '');
  return Promise.all(MINIMAP_ATLAS_PATHS.map(path => loadImageAtlasFiles(`${base}/${path}`)));
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

export interface MinimapIcon {
  readonly imageUrl: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
}

/** Map-owned image sheets and icon-name indices. Prewarm decodes each whole sheet once. */
export class MinimapIcons {
  private readonly root: string;
  private readonly indices = new Map<string, number>();
  private readonly icons: MinimapIcon[] = [];
  private readonly urls = new Set<string>();
  private pending?: Promise<void>;
  private disposed = false;
  private prepared = false;

  constructor(root: string) { this.root = root; }

  get ready(): boolean { return this.prepared && !this.disposed; }
  index(icon: string): number | undefined { return this.indices.get(icon); }
  get(index: number | undefined): MinimapIcon | undefined { return index === undefined ? undefined : this.icons[index]; }

  prewarm(): Promise<void> {
    return this.pending ??= this.prepare();
  }

  dispose(): void {
    this.disposed = true;
    this.indices.clear(); this.icons.length = 0;
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
  }

  private async prepare(): Promise<void> {
    const atlases = await loadMinimapAtlases(this.root);
    if (this.disposed) return;
    const pages = atlases.flatMap(atlas => atlas.pages);
    const results = await Promise.allSettled(pages.map(page => this.preparePage(page)));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    if (this.disposed) return;
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index], result = results[index];
      if (result.status !== 'fulfilled' || !result.value) continue;
      for (const [name, element] of page.elements) if (!this.indices.has(name)) {
        this.indices.set(name, this.icons.length);
        this.icons.push({ imageUrl: result.value, ...atlasElementBounds(page.decodedTexture, element),
          atlasWidth: page.decodedTexture.width, atlasHeight: page.decodedTexture.height });
      }
    }
    this.prepared = true;
  }

  private async preparePage(page: ImageAtlasPage): Promise<string | undefined> {
    const { width, height, pixels } = page.decodedTexture;
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')!.putImageData(new ImageData(Uint8ClampedArray.from(pixels), width, height), 0, 0);
    let url: string | undefined;
    let retained = false;
    try {
      const blob = await canvas.convertToBlob();
      if (this.disposed) return;
      url = URL.createObjectURL(blob);
      this.urls.add(url);
      const image = new Image(); image.src = url;
      await image.decode();
      if (this.disposed) return;
      retained = true;
      return url;
    } finally {
      canvas.width = canvas.height = 0;
      if (url && !retained && this.urls.delete(url)) URL.revokeObjectURL(url);
    }
  }
}
