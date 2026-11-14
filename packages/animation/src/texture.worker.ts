import { parseKtex } from './parseKtex';
import type { TextureWorkerRequest, TextureWorkerResponse } from './textureWorkerProtocol';
import { transferBuffers } from './transferBuffers';

// The worker scope's postMessage, typed by the protocol; `{ transfer }` also suits the DOM lib's Window signature.
const postMessage = (message: TextureWorkerResponse, transfer: Transferable[]): void => globalThis.postMessage(message, { transfer });

globalThis.addEventListener('message', async ({ data: { id, url } }: MessageEvent<TextureWorkerRequest>) => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load texture ${url}: HTTP ${response.status}`);
    const texture = parseKtex(new Uint8Array(await response.arrayBuffer()), url);
    postMessage({ id, texture }, transferBuffers([texture.pixels]));
  } catch (error) {
    postMessage({ id, error: error instanceof Error ? error.message : String(error) }, []);
  }
});
