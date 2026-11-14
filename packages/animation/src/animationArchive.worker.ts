import { readAnimationArchivePart } from './animationArchive';
import type { AnimationArchiveWorkerRequest, AnimationArchiveWorkerResponse } from './animationArchiveWorkerProtocol';
import { transferBuffers } from './transferBuffers';

// The worker scope's postMessage, typed by the protocol; `{ transfer }` also suits the DOM lib's Window signature.
const postMessage = (message: AnimationArchiveWorkerResponse, transfer: Transferable[]): void => globalThis.postMessage(message, { transfer });

globalThis.addEventListener('message', async ({ data: { id, file, assetBaseUrl, kind } }: MessageEvent<AnimationArchiveWorkerRequest>) => {
  try {
    const result = await readAnimationArchivePart(file, assetBaseUrl, kind);
    // Ownership of RGBA and alpha buffers moves to the main-thread cache without a copy.
    const buffers = result && 'atlases' in result
      ? transferBuffers(result.atlases.flatMap(({ pixels, alpha }) => [pixels, alpha])) : [];
    postMessage({ id, result }, buffers);
  } catch (error) {
    postMessage({ id, error: error instanceof Error ? error.message : String(error) }, []);
  }
});
