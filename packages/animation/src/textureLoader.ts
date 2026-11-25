import * as THREE from 'three';
import { parseKtex, type DecodedTexture } from './parseKtex';
import type { TextureWorkerRequest, TextureWorkerResponse } from './textureWorkerProtocol';

/** Decodes still in flight, so concurrent readers share one; a finished decode belongs to its readers alone. */
const requests = new Map<string, Promise<DecodedTexture>>();
const pending = new Map<number, { resolve(texture: DecodedTexture): void; reject(error: Error): void }>();
let worker: Worker | undefined;
let nextId = 0;

function getWorker(): Worker {
  if (worker) {
    return worker;
  }
  const decoder = new Worker(new URL('./texture.worker.ts', import.meta.url), { type: 'module', name: 'dst-texture' });
  worker = decoder;
  decoder.onmessage = ({ data }: MessageEvent<TextureWorkerResponse>) => {
    const request = pending.get(data.id);
    if (!request) {
      return;
    }
    pending.delete(data.id);
    if ('error' in data) {
      request.reject(new Error(data.error));
    } else {
      request.resolve(data.texture);
    }
  };
  const fail = (error: Error) => {
    if (worker !== decoder) {
      return;
    }
    decoder.terminate();
    worker = undefined;
    for (const request of pending.values()) {
      request.reject(error);
    }
    pending.clear();
  };
  decoder.onerror = event => fail(new Error(event.message || 'Texture worker failed'));
  decoder.onmessageerror = () => fail(new Error('Unable to receive decoded texture'));
  return decoder;
}

/**
 * Decodes a KTEX file off the main thread where Workers exist. Concurrent requests for one URL share a decode; the
 * pixels are not cached once it finishes, so they live only as long as a reader keeps them.
 */
export function loadKtexTexture(path: string): Promise<DecodedTexture> {
  const url = typeof document === 'undefined' ? path : new URL(path, document.baseURI).href;
  let request = requests.get(url);
  if (!request) {
    request =
      typeof document !== 'undefined' && typeof Worker !== 'undefined'
        ? new Promise<DecodedTexture>((resolve, reject) => {
            const decoder = getWorker();
            const id = ++nextId;
            pending.set(id, { resolve, reject });
            try {
              decoder.postMessage({ id, url } satisfies TextureWorkerRequest);
            } catch (error) {
              pending.delete(id);
              reject(error);
            }
          })
        : (async () => {
            const response = await fetch(url);
            if (!response.ok) {
              throw new Error(`Unable to load texture ${url}: HTTP ${response.status}`);
            }
            return parseKtex(new Uint8Array(await response.arrayBuffer()), url);
          })();
    requests.set(url, request);
    const settled = () => {
      if (requests.get(url) === request) {
        requests.delete(url);
      }
    };
    void request.then(settled, settled);
  }
  return request;
}

interface KtexImage {
  data: Uint8Array | null;
  width: number;
  height: number;
}

/** One file and sampling variant: a three.js Source every texture of it shares, so a renderer keeps one GPU copy. */
interface KtexSource {
  readonly path: string;
  readonly source: THREE.Source<KtexImage>;
  readonly textures: Set<THREE.DataTexture>;
  reload?: Promise<void>;
}

const ktexSources = new Map<string, Promise<KtexSource>>();
const sourceRecords = new WeakMap<THREE.Source<unknown>, KtexSource>();
const pendingReloads = new Set<Promise<void>>();

function onKtexUpload(texture: THREE.Texture): void {
  const record = sourceRecords.get(texture.source);
  if (!record) {
    return;
  }
  const image = record.source.data;
  if (image.data) {
    // The GPU holds the texels now; a later GPU copy reads the file again.
    image.data = null;
    return;
  }
  // A GPU copy made without data (a restored context, another renderer, a texture made after the release).
  if (record.reload) {
    return;
  }
  const reload = loadKtexTexture(record.path)
    .then(
      ({ pixels }) => {
        image.data = pixels;
        for (const shared of record.textures) {
          shared.needsUpdate = true;
        }
      },
      error => console.error('Unable to reload a released texture', error),
    )
    .finally(() => {
      record.reload = undefined;
      pendingReloads.delete(reload);
    });
  record.reload = reload;
  pendingReloads.add(reload);
}

/**
 * An RGBA DataTexture of a KTEX file whose pixels leave the CPU once a renderer has uploaded them. Textures of one
 * `path` and `variant` share a Source and so one GPU copy; `variant` names the caller's sampling parameters (wrap,
 * filters, mipmaps), which three uploads separately. A GPU copy made later decodes the file again.
 */
export async function loadKtexDataTexture(path: string, variant = ''): Promise<THREE.DataTexture> {
  const url = typeof document === 'undefined' ? path : new URL(path, document.baseURI).href;
  const key = `${url}\n${variant}`;
  let request = ktexSources.get(key);
  if (!request) {
    request = loadKtexTexture(url).then(({ pixels, width, height }) => {
      const record: KtexSource = {
        path: url,
        source: new THREE.Source<KtexImage>({ data: pixels, width, height }),
        textures: new Set(),
      };
      sourceRecords.set(record.source, record);
      return record;
    });
    ktexSources.set(key, request);
    void request.catch(() => {
      if (ktexSources.get(key) === request) {
        ktexSources.delete(key);
      }
    });
  }
  const record = await request;
  const { width, height } = record.source.data;
  const texture = new THREE.DataTexture(null, width, height, THREE.RGBAFormat);
  texture.source = record.source;
  // Only this texture needs binding: a Source version bump would upload the shared pixels again.
  texture.version++;
  texture.onUpdate = onKtexUpload;
  record.textures.add(texture);
  texture.addEventListener('dispose', () => record.textures.delete(texture));
  return texture;
}

/** Resolves once every released texture being decoded again has its pixels back. */
export async function ktexReloadsSettled(): Promise<void> {
  while (pendingReloads.size) {
    await Promise.all(pendingReloads);
  }
}

/** Explicit scene/session cleanup, including requests still decoding. */
export function disposeTextureAssets(): void {
  worker?.terminate();
  worker = undefined;
  for (const request of pending.values()) {
    request.reject(new Error('Texture assets disposed'));
  }
  pending.clear();
  requests.clear();
  ktexSources.clear();
}
