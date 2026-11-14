import { preloadImageArchive } from './imageArchive';
import { parseImageAtlasArchive } from './imageAtlasParser';
import type { ImageAtlasWorkerRequest, ImageAtlasWorkerResponse } from './imageAtlasWorkerProtocol';
import { transferBuffers } from './transferBuffers';

// The worker scope's postMessage, typed by the protocol; `{ transfer }` also suits the DOM lib's Window signature.
const postMessage = (message: ImageAtlasWorkerResponse, transfer: Transferable[]): void => globalThis.postMessage(message, { transfer });

globalThis.addEventListener('message', async ({ data: { id, archiveUrl, atlasPath } }: MessageEvent<ImageAtlasWorkerRequest>) => {
  try {
    const archive = await preloadImageArchive(archiveUrl);
    const { pages } = parseImageAtlasArchive(archive, atlasPath);
    // Transfer decoded RGBA buffers rather than copying large texture pages.
    const buffers = transferBuffers(pages.map(page => page.decodedTexture.pixels));
    postMessage({ id, pages }, buffers);
  } catch (error) {
    postMessage({ id, error: error instanceof Error ? error.message : String(error) }, []);
  }
});
