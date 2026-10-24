import { parseKtex, type DecodedTexture } from './parseKtex';
import type { TextureWorkerRequest, TextureWorkerResponse } from './textureWorkerProtocol';

const requests = new Map<string, Promise<DecodedTexture>>();
const pending = new Map<number, { resolve(texture: DecodedTexture): void; reject(error: Error): void }>();
let worker: Worker | undefined;
let nextId = 0;

function getWorker(): Worker {
  if (worker) return worker;
  const decoder = new Worker(new URL('./texture.worker.ts', import.meta.url), { type: 'module', name: 'dst-texture' });
  worker = decoder;
  decoder.onmessage = ({ data }: MessageEvent<TextureWorkerResponse>) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if ('error' in data) request.reject(new Error(data.error));
    else request.resolve(data.texture);
  };
  const fail = (error: Error) => {
    if (worker !== decoder) return;
    decoder.terminate();
    worker = undefined;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  decoder.onerror = event => fail(new Error(event.message || 'Texture worker failed'));
  decoder.onmessageerror = () => fail(new Error('Unable to receive decoded texture'));
  return decoder;
}

/** Shared CPU pixels, independently owned GPU textures. Browser decoding runs off the main thread. */
export function loadKtexTexture(path: string): Promise<DecodedTexture> {
  const url = typeof document === 'undefined' ? path : new URL(path, document.baseURI).href;
  let request = requests.get(url);
  if (!request) {
    request = typeof document !== 'undefined' && typeof Worker !== 'undefined'
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
        if (!response.ok) throw new Error(`Unable to load texture ${url}: HTTP ${response.status}`);
        return parseKtex(new Uint8Array(await response.arrayBuffer()), url);
      })();
    requests.set(url, request);
    void request.catch(() => { if (requests.get(url) === request) requests.delete(url); });
  }
  return request;
}

/** Explicit scene/session cleanup, including requests still decoding. */
export function disposeTextureAssets(): void {
  worker?.terminate();
  worker = undefined;
  for (const request of pending.values()) request.reject(new Error('Texture assets disposed'));
  pending.clear();
  requests.clear();
}
