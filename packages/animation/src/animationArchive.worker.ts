import { readAnimationArchivePart } from './animationArchive';
import type { AnimationArchiveWorkerRequest, AnimationArchiveWorkerResponse } from './animationArchiveWorkerProtocol';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<AnimationArchiveWorkerRequest>) => void;
  postMessage(message: AnimationArchiveWorkerResponse, transfer: Transferable[]): void;
};

scope.onmessage = async ({ data: { id, file, assetBaseUrl, kind } }) => {
  try {
    const result = await readAnimationArchivePart(file, assetBaseUrl, kind);
    // Ownership of RGBA and alpha buffers moves to the main-thread cache without a copy.
    const buffers = result && 'atlases' in result
      ? result.atlases.flatMap(({ pixels, alpha }) => [pixels, alpha].filter(data => data !== undefined)
        .map(data => data.buffer as ArrayBuffer)) : [];
    scope.postMessage({ id, result }, buffers);
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }, []);
  }
};
