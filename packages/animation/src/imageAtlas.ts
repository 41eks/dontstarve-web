import { imageArchiveUrl, preloadImageArchive } from './imageArchive';
import {
  DecodedImageAtlas,
  imageAtlasPage,
  parseImageAtlasArchive,
  parseImageAtlasXml,
  type ImageAtlas,
  type ImageAtlasPage,
} from './imageAtlasParser';
import { parseKtex, type DecodedTexture } from './parseKtex';
import type { ImageAtlasWorkerRequest, ImageAtlasWorkerResponse } from './imageAtlasWorkerProtocol';

export {
  imageAtlasPage,
  parseImageAtlasArchive,
  parseImageAtlasXml,
  type ImageAtlas,
  type ImageAtlasElement,
  type ImageAtlasPage,
  type ImageAtlasSprite,
  type ParsedImageAtlasXml,
} from './imageAtlasParser';
export { preloadImageArchive } from './imageArchive';

const atlasRequests = new Map<string, Promise<ImageAtlas>>();
const pendingRequests = new Map<
  number,
  {
    resolve: (result: Extract<ImageAtlasWorkerResponse, { pages: unknown } | { texture: unknown }>) => void;
    reject: (error: Error) => void;
  }
>();
let atlasWorker: Worker | undefined;
let nextRequestId = 0;

function getAtlasWorker(): Worker {
  if (atlasWorker) {
    return atlasWorker;
  }
  const worker = new Worker(new URL('./imageAtlas.worker.ts', import.meta.url), {
    type: 'module',
    name: 'dst-image-atlas',
  });
  atlasWorker = worker;
  worker.onmessage = ({ data }: MessageEvent<ImageAtlasWorkerResponse>) => {
    const pending = pendingRequests.get(data.id);
    if (!pending) {
      return;
    }
    pendingRequests.delete(data.id);
    if ('error' in data) {
      pending.reject(new Error(data.error));
    } else {
      pending.resolve(data);
    }
  };
  const fail = (error: Error) => {
    worker.terminate();
    atlasWorker = undefined;
    for (const pending of pendingRequests.values()) {
      pending.reject(error);
    }
    pendingRequests.clear();
  };
  worker.onerror = event => fail(new Error(event.message || 'Image atlas worker failed'));
  worker.onmessageerror = () => fail(new Error('Unable to receive decoded image atlas'));
  return worker;
}

type WorkerTask = ImageAtlasWorkerRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, 'id'>
    : never
  : never;

function requestWorker(
  task: WorkerTask,
): Promise<Extract<ImageAtlasWorkerResponse, { pages: unknown } | { texture: unknown }>> {
  return new Promise((resolve, reject) => {
    const worker = getAtlasWorker();
    const id = ++nextRequestId;
    pendingRequests.set(id, { resolve, reject });
    try {
      worker.postMessage({ id, ...task } as ImageAtlasWorkerRequest);
    } catch (error) {
      pendingRequests.delete(id);
      reject(error);
    }
  });
}

async function loadInWorker(archiveUrl: string, atlasPath: string): Promise<ImageAtlas> {
  const result = await requestWorker({ archiveUrl, atlasPath });
  if (!('pages' in result)) {
    throw new Error('Image atlas worker returned no pages');
  }
  return new DecodedImageAtlas(result.pages);
}

/**
 * The whole page as RGBA, decoded off the main thread where Workers exist. The result is not cached: a reader that
 * needs the page once (to encode it as an image) drops it afterwards, and the page keeps only its KTEX.
 */
export async function decodeImageAtlasPage(page: ImageAtlasPage): Promise<DecodedTexture> {
  if (typeof document === 'undefined' || typeof Worker === 'undefined') {
    return parseKtex(page.ktex, page.texturePath);
  }
  const result = await requestWorker({ ktex: page.ktex, label: page.texturePath });
  if (!('texture' in result)) {
    throw new Error('Image atlas worker returned no texture');
  }
  return result.texture;
}

export function loadImageAtlas(
  archiveUrl: string | URL,
  atlasPath = 'images/inventoryimages.xml',
): Promise<ImageAtlas> {
  const url = imageArchiveUrl(archiveUrl);
  const key = `${url}\n${atlasPath}`;
  let request = atlasRequests.get(key);
  if (!request) {
    // Keep synchronous parsing available for Node and browsers without Workers.
    request =
      typeof document !== 'undefined' && typeof Worker !== 'undefined'
        ? loadInWorker(url, atlasPath)
        : preloadImageArchive(url).then(data => parseImageAtlasArchive(data, atlasPath));
    atlasRequests.set(key, request);
    void request.catch(() => atlasRequests.delete(key));
  }
  return request;
}

/** Some DST UI atlases are loose XML/KTEX files rather than images.zip entries. */
export function loadImageAtlasFiles(xmlUrl: string | URL): Promise<ImageAtlas> {
  const url = imageArchiveUrl(xmlUrl);
  let request = atlasRequests.get(url);
  if (!request) {
    request = (async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Unable to load image atlas ${url}: HTTP ${response.status}`);
      }
      const definition = parseImageAtlasXml(await response.text(), url);
      const texturePath = new URL(definition.texture, url).href;
      const texture = await fetch(texturePath);
      if (!texture.ok) {
        throw new Error(`Unable to load image texture ${texturePath}: HTTP ${texture.status}`);
      }
      return new DecodedImageAtlas([
        imageAtlasPage(definition, url, texturePath, new Uint8Array(await texture.arrayBuffer())),
      ]);
    })();
    atlasRequests.set(url, request);
    void request.catch(() => atlasRequests.delete(url));
  }
  return request;
}
