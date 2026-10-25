import { readAnimationArchivePart, type AnimationArchiveParts, type BuildAtlas, type BuildPackage } from './animationArchive';
import type { AnimationArchiveWorkerRequest, AnimationArchiveWorkerResponse } from './animationArchiveWorkerProtocol';
import { disposeTextureAssets } from './textureLoader';

type ArchivePart = AnimationArchiveParts[keyof AnimationArchiveParts];
const requests = new Map<string, Promise<ArchivePart>>();
const pendingRequests = new Map<number, {
  resolve: (result: ArchivePart) => void;
  reject: (error: Error) => void;
}>();
/** Where each cached build atlas came from, so released RGBA can be decoded again. */
const atlasOrigins = new WeakMap<BuildAtlas, { file: string; baseUrl: string; index: number }>();
const reloads = new Map<string, Promise<BuildPackage>>();
let archiveWorker: Worker | undefined;
let nextRequestId = 0;

function getArchiveWorker(): Worker {
  if (archiveWorker) return archiveWorker;
  const worker = new Worker(new URL('./animationArchive.worker.ts', import.meta.url), {
    type: 'module', name: 'dst-animation-archive',
  });
  archiveWorker = worker;
  worker.onmessage = ({ data }: MessageEvent<AnimationArchiveWorkerResponse>) => {
    const pending = pendingRequests.get(data.id);
    if (!pending) return;
    pendingRequests.delete(data.id);
    if ('error' in data) pending.reject(new Error(data.error));
    else pending.resolve(data.result);
  };
  const fail = (error: Error) => {
    worker.terminate();
    archiveWorker = undefined;
    for (const pending of pendingRequests.values()) pending.reject(error);
    pendingRequests.clear();
  };
  worker.onerror = (event) => fail(new Error(event.message || 'Animation archive worker failed'));
  worker.onmessageerror = () => fail(new Error('Unable to receive decoded animation archive'));
  return worker;
}

function loadInWorker(file: string, assetBaseUrl: string, kind: keyof AnimationArchiveParts): Promise<ArchivePart> {
  return new Promise((resolve, reject) => {
    const worker = getArchiveWorker();
    const id = ++nextRequestId;
    pendingRequests.set(id, { resolve, reject });
    const request: AnimationArchiveWorkerRequest = { id, file, assetBaseUrl, kind };
    try {
      worker.postMessage(request);
    } catch (error) {
      pendingRequests.delete(id);
      reject(error);
    }
  });
}

function readPart<Kind extends keyof AnimationArchiveParts>(file: string, baseUrl: string, kind: Kind) {
  // Resolve relative asset paths against the page, not the Worker's own URL.
  return (typeof document !== 'undefined' && typeof Worker !== 'undefined'
    ? loadInWorker(file, new URL(`${baseUrl}/`, document.baseURI).href, kind)
    : readAnimationArchivePart(file, baseUrl, kind)) as Promise<AnimationArchiveParts[Kind]>;
}

export function loadAnimationArchivePart<Kind extends keyof AnimationArchiveParts>(
  file: string, assetBaseUrl: string, kind: Kind,
): Promise<AnimationArchiveParts[Kind]> {
  const baseUrl = assetBaseUrl.replace(/\/$/, '');
  const key = `${baseUrl}/${file}\n${kind}`;
  let request = requests.get(key);
  if (!request) {
    request = readPart(file, baseUrl, kind).then(result => {
      if (result && 'atlases' in result) result.atlases.forEach((atlas, index) => atlasOrigins.set(atlas, { file, baseUrl, index }));
      return result;
    });
    requests.set(key, request);
    void request.catch(() => {
      if (requests.get(key) === request) requests.delete(key);
    });
  }
  return request as Promise<AnimationArchiveParts[Kind]>;
}

/** Whether a cached atlas can be decoded again after its RGBA is released. */
export function canReloadAtlasPixels(atlas: BuildAtlas): boolean { return atlasOrigins.has(atlas); }

/** Decodes a released atlas page again from its archive; atlases of one build share a single decode. */
export function reloadAtlasPixels(atlas: BuildAtlas): Promise<Uint8Array> {
  const origin = atlasOrigins.get(atlas);
  if (!origin) return Promise.reject(new Error('Atlas has no archive to reload from'));
  const key = `${origin.baseUrl}/${origin.file}`;
  let reload = reloads.get(key);
  if (!reload) {
    reload = readPart(origin.file, origin.baseUrl, 'build');
    reloads.set(key, reload);
    const settle = () => { if (reloads.get(key) === reload) reloads.delete(key); };
    void reload.then(settle, settle);
  }
  return reload.then(({ atlases }) => atlases[origin.index].pixels!);
}

/** Release CPU assets and the decoder worker when the game is shut down. */
export function disposeAnimationAssets(): void {
  disposeTextureAssets();
  archiveWorker?.terminate();
  archiveWorker = undefined;
  for (const pending of pendingRequests.values()) pending.reject(new Error('Animation assets disposed'));
  pendingRequests.clear();
  requests.clear();
  reloads.clear();
}
