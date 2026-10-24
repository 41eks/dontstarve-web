import { parseKtex } from './parseKtex';
import type { TextureWorkerRequest, TextureWorkerResponse } from './textureWorkerProtocol';

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<TextureWorkerRequest>) => void;
  postMessage(message: TextureWorkerResponse, transfer: Transferable[]): void;
};

scope.onmessage = async ({ data: { id, url } }) => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load texture ${url}: HTTP ${response.status}`);
    const texture = parseKtex(new Uint8Array(await response.arrayBuffer()), url);
    scope.postMessage({ id, texture }, [texture.pixels.buffer as ArrayBuffer]);
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }, []);
  }
};
