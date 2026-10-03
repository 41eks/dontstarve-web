import { preloadImageArchive } from './imageArchive';
import { parseImageAtlasArchive } from './imageAtlasParser';
import type { ImageAtlasWorkerRequest, ImageAtlasWorkerResponse } from './imageAtlasWorkerProtocol';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<ImageAtlasWorkerRequest>) => void;
  postMessage(message: ImageAtlasWorkerResponse, transfer: Transferable[]): void;
};

scope.onmessage = async ({ data: { id, archiveUrl, atlasPath } }) => {
  try {
    const archive = await preloadImageArchive(archiveUrl);
    const { pages } = parseImageAtlasArchive(archive, atlasPath);
    // Transfer decoded RGBA buffers rather than copying large texture pages.
    const buffers = pages.map((page) => page.decodedTexture.pixels.buffer as ArrayBuffer);
    scope.postMessage({ id, pages }, buffers);
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }, []);
  }
};
