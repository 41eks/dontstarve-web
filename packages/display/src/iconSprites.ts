import * as THREE from 'three';
import { loadImageAtlas, type ImageAtlas } from '@dontstarve-web/animation/imageAtlas';
import type { LoadedSpriteSource, SpriteSource } from './prefabDisplay';

const ICON_HEIGHT = 4;

function iconArt(atlas: ImageAtlas, icon: string): { texture: THREE.DataTexture; material: THREE.SpriteMaterial; aspect: number } {
  const image = atlas.require(icon);
  const texture = new THREE.DataTexture(
    Uint8Array.from(image.pixels),
    image.width,
    image.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = true;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.01,
    toneMapped: false,
  });
  return { texture, material, aspect: image.width / image.height };
}

/** Inventory icons drawn as billboards: the shared atlases of one archive, and a sprite source per entity's icon. */
export class IconSpriteAtlases {
  private readonly requests = new Map<string, Promise<ImageAtlas>>();
  private readonly loaded = new Map<string, ImageAtlas>();
  private readonly archiveUrl: string;

  constructor(archiveUrl: string) { this.archiveUrl = archiveUrl; }

  private load(atlasPath: string): Promise<ImageAtlas> {
    let request = this.requests.get(atlasPath);
    if (!request) {
      request = loadImageAtlas(this.archiveUrl, atlasPath);
      void request.then(atlas => this.loaded.set(atlasPath, atlas), () => this.requests.delete(atlasPath));
      this.requests.set(atlasPath, request);
    }
    return request;
  }

  /** The icon's own texture and material live until `dispose()`, after the entity's display has released its sprite. */
  source(atlasPath: string, icon: string, name: string): LoadedSpriteSource & { dispose(): void } {
    let art: ReturnType<typeof iconArt> | undefined;
    const draw = (atlas: ImageAtlas): SpriteSource => {
      art ??= iconArt(atlas, icon);
      const { material, aspect } = art;
      return {
        create: () => {
          const sprite = new THREE.Sprite(material);
          sprite.name = name;
          sprite.scale.set(ICON_HEIGHT * aspect, ICON_HEIGHT, 1);
          sprite.position.y = ICON_HEIGHT / 2;
          const visual = new THREE.Group();
          visual.add(sprite);
          return new THREE.Group().add(visual);
        },
        release: drawn => drawn.removeFromParent(),
      };
    };
    return {
      peek: () => { const atlas = this.loaded.get(atlasPath); return atlas && draw(atlas); },
      load: () => this.load(atlasPath).then(draw),
      dispose() {
        art?.texture.dispose();
        art?.material.dispose();
      },
    };
  }

  dispose(): void { this.requests.clear(); this.loaded.clear(); }
}
