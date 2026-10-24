import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { disposeTextureAssets, loadKtexTexture } from '../src/textureLoader';
import type { TextureWorkerRequest, TextureWorkerResponse } from '../src/textureWorkerProtocol';

class Decoder {
  static instances: Decoder[] = [];
  readonly messages: TextureWorkerRequest[] = [];
  readonly terminate = vi.fn();
  onmessage?: (event: { data: TextureWorkerResponse }) => void;
  onerror?: (event: { message: string }) => void;
  onmessageerror?: () => void;
  constructor() { Decoder.instances.push(this); }
  postMessage(request: TextureWorkerRequest) { this.messages.push(request); }
}

beforeEach(() => {
  Decoder.instances = [];
  vi.stubGlobal('Worker', Decoder);
  vi.stubGlobal('document', { baseURI: 'https://example.test/game/' });
});
afterEach(() => { disposeTextureAssets(); vi.unstubAllGlobals(); });

it('coalesces texture requests and preserves the worker pixels for independent GPU owners', async () => {
  const first = loadKtexTexture('./ground.tex');
  const second = loadKtexTexture('https://example.test/game/ground.tex');
  expect(second).toBe(first);
  const decoder = Decoder.instances[0];
  expect(decoder.messages).toHaveLength(1);
  const texture = { width: 1, height: 1, pixels: new Uint8Array([10, 20, 30, 40]) };
  decoder.onmessage!({ data: { id: decoder.messages[0].id, texture } });
  expect(await first).toBe(texture);
  expect((await second).pixels).toEqual(new Uint8Array([10, 20, 30, 40]));
  expect(loadKtexTexture('./ground.tex')).toBe(first);
});

it('retries failed decodes without poisoning other cached textures', async () => {
  const first = loadKtexTexture('./ground.tex');
  const decoder = Decoder.instances[0];
  const failed = expect(first).rejects.toThrow('Invalid KTEX');
  decoder.onmessage!({ data: { id: decoder.messages[0].id, error: 'Invalid KTEX' } });
  await failed;
  const retry = loadKtexTexture('./ground.tex');
  expect(retry).not.toBe(first);
  expect(decoder.messages).toHaveLength(2);
  decoder.onmessage!({ data: { id: decoder.messages[1].id, texture: { width: 1, height: 1, pixels: new Uint8Array(4) } } });
  await retry;
});

it('cancels pending requests on disposal and ignores late responses from the previous worker', async () => {
  const first = loadKtexTexture('./ground.tex');
  const old = Decoder.instances[0];
  const cancelled = expect(first).rejects.toThrow('Texture assets disposed');
  disposeTextureAssets();
  await cancelled;
  expect(old.terminate).toHaveBeenCalledOnce();
  const retry = loadKtexTexture('./ground.tex');
  const decoder = Decoder.instances[1];
  old.onmessage!({ data: { id: old.messages[0].id, error: 'Late response' } });
  old.onerror!({ message: 'Late failure' });
  const texture = { width: 1, height: 1, pixels: new Uint8Array([1, 2, 3, 4]) };
  decoder.onmessage!({ data: { id: decoder.messages[0].id, texture } });
  expect(await retry).toBe(texture);
  expect(decoder.terminate).not.toHaveBeenCalled();
});
