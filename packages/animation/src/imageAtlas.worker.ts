import { preloadImageArchive } from './imageArchive';
import { parseImageAtlasArchive } from './imageAtlasParser';
import type { ImageAtlasWorkerRequest, ImageAtlasWorkerResponse } from './imageAtlasWorkerProtocol';
import { parseKtex } from './parseKtex';
import { transferBuffers } from './transferBuffers';

// The worker scope's postMessage, typed by the protocol; `{ transfer }` also suits the DOM lib's Window signature.
const postMessage = (message: ImageAtlasWorkerResponse, transfer: Transferable[]): void =>
  globalThis.postMessage(message, { transfer });

globalThis.addEventListener('message', async ({ data: request }: MessageEvent<ImageAtlasWorkerRequest>) => {
  const { id } = request;
  try {
    if ('ktex' in request) {
      const texture = parseKtex(request.ktex, request.label);
      postMessage({ id, texture }, transferBuffers([texture.pixels]));
      return;
    }
    const archive = await preloadImageArchive(request.archiveUrl);
    const { pages } = parseImageAtlasArchive(archive, request.atlasPath);
    // Each page owns its KTEX buffer, so transferring it leaves the cached archive intact.
    postMessage({ id, pages }, transferBuffers(pages.map(page => page.ktex)));
  } catch (error) {
    postMessage({ id, error: error instanceof Error ? error.message : String(error) }, []);
  }
});
