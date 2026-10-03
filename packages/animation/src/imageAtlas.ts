import { imageArchiveUrl, preloadImageArchive } from './imageArchive';
import { DecodedImageAtlas, parseImageAtlasArchive, type ImageAtlas } from './imageAtlasParser';
import type { ImageAtlasWorkerRequest, ImageAtlasWorkerResponse } from './imageAtlasWorkerProtocol';

export {
  cropAtlasTexture,
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
const pendingRequests = new Map<number, {
  resolve: (atlas: ImageAtlas) => void;
  reject: (error: Error) => void;
}>();
let atlasWorker: Worker | undefined;
let nextRequestId = 0;

function getAtlasWorker(): Worker {
  if (atlasWorker) return atlasWorker;
  const worker = new Worker(new URL('./imageAtlas.worker.ts', import.meta.url), {
    type: 'module',
    name: 'dst-image-atlas',
  });
  atlasWorker = worker;
  worker.onmessage = ({ data }: MessageEvent<ImageAtlasWorkerResponse>) => {
    const pending = pendingRequests.get(data.id);
    if (!pending) return;
    pendingRequests.delete(data.id);
    if ('error' in data) pending.reject(new Error(data.error));
    else pending.resolve(new DecodedImageAtlas(data.pages));
  };
  const fail = (error: Error) => {
    worker.terminate();
    atlasWorker = undefined;
    for (const pending of pendingRequests.values()) pending.reject(error);
    pendingRequests.clear();
  };
  worker.onerror = (event) => fail(new Error(event.message || 'Image atlas worker failed'));
  worker.onmessageerror = () => fail(new Error('Unable to receive decoded image atlas'));
  return worker;
}

function loadInWorker(archiveUrl: string, atlasPath: string): Promise<ImageAtlas> {
  return new Promise((resolve, reject) => {
    const worker = getAtlasWorker();
    const id = ++nextRequestId;
    pendingRequests.set(id, { resolve, reject });
    const request: ImageAtlasWorkerRequest = { id, archiveUrl, atlasPath };
    try {
      worker.postMessage(request);
    } catch (error) {
      pendingRequests.delete(id);
      reject(error);
    }
  });
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
    request = typeof document !== 'undefined' && typeof Worker !== 'undefined'
      ? loadInWorker(url, atlasPath)
      : preloadImageArchive(url).then((data) => parseImageAtlasArchive(data, atlasPath));
    atlasRequests.set(key, request);
    void request.catch(() => atlasRequests.delete(key));
  }
  return request;
}
