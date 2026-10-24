import { readAnimationArchivePart, type AnimationArchiveParts } from './animationArchive';
import type { AnimationArchiveWorkerRequest, AnimationArchiveWorkerResponse } from './animationArchiveWorkerProtocol';

type ArchivePart = AnimationArchiveParts[keyof AnimationArchiveParts];
const requests = new Map<string, Promise<ArchivePart>>();
const pendingRequests = new Map<number, {
  resolve: (result: ArchivePart) => void;
  reject: (error: Error) => void;
}>();
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

export function loadAnimationArchivePart<Kind extends keyof AnimationArchiveParts>(
  file: string, assetBaseUrl: string, kind: Kind,
): Promise<AnimationArchiveParts[Kind]> {
  const baseUrl = assetBaseUrl.replace(/\/$/, '');
  const key = `${baseUrl}/${file}\n${kind}`;
  let request = requests.get(key);
  if (!request) {
    // Resolve relative asset paths against the page, not the Worker's own URL.
    request = typeof document !== 'undefined' && typeof Worker !== 'undefined'
      ? loadInWorker(file, new URL(`${baseUrl}/`, document.baseURI).href, kind)
      : readAnimationArchivePart(file, baseUrl, kind);
    requests.set(key, request);
    void request.catch(() => {
      if (requests.get(key) === request) requests.delete(key);
    });
  }
  return request as Promise<AnimationArchiveParts[Kind]>;
}

/** Release CPU assets and the decoder worker when the game is shut down. */
export function disposeAnimationAssets(): void {
  archiveWorker?.terminate();
  archiveWorker = undefined;
  for (const pending of pendingRequests.values()) pending.reject(new Error('Animation assets disposed'));
  pendingRequests.clear();
  requests.clear();
}
