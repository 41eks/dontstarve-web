import * as THREE from 'three';
import { parseKtex } from '@dontstarve-web/animation/parseKtex';

/** A drawn effect at a symbol follower's node, advanced with the entity's frames. */
export interface FollowerFxInstance {
  update(dt: number): void;
  dispose(): void;
}

/**
 * An effect a prefab declares on a symbol follower by its texture paths; the display loads them and only then creates
 * the effect, so the prefab never waits for art.
 */
export interface FollowerFx {
  /** KTEX texture URLs, given to `create` in this order. */
  readonly textures: readonly string[];
  create(node: THREE.Object3D, textures: readonly THREE.Texture[]): FollowerFxInstance;
}

// Shared by every display in the page, like the engine's texture cache; each effect only borrows them.
const textures = new Map<string, Promise<THREE.DataTexture>>();

function loadTexture(url: string): Promise<THREE.DataTexture> {
  let request = textures.get(url);
  if (!request) {
    request = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Unable to load ${url}: ${response.status}`);
      const decoded = parseKtex(new Uint8Array(await response.arrayBuffer()), url);
      const texture = new THREE.DataTexture(decoded.pixels, decoded.width, decoded.height, THREE.RGBAFormat);
      // The engine blends texel values directly; no sRGB decode.
      texture.flipY = false;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      return texture;
    })();
    textures.set(url, request);
    void request.catch(() => textures.delete(url));
  }
  return request;
}

/** Loads a follower's effect art, then creates the effect unless the follower was removed meanwhile. */
export class FollowerFxSlot {
  private instance: FollowerFxInstance | undefined;
  private removed = false;
  readonly loaded: Promise<void>;

  constructor(node: THREE.Object3D, fx: FollowerFx, label: string) {
    this.loaded = Promise.all(fx.textures.map(loadTexture)).then((loaded) => {
      if (!this.removed) this.instance = fx.create(node, loaded);
    }, (error: unknown) => {
      if (!this.removed) console.error(`Unable to load the follower effect of ${label}`, error);
    });
  }

  update(dt: number): void { this.instance?.update(dt); }

  dispose(): void {
    this.removed = true;
    this.instance?.dispose();
    this.instance = undefined;
  }
}
