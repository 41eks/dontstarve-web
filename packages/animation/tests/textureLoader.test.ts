import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { disposeTextureAssets, ktexReloadsSettled, loadKtexDataTexture, loadKtexTexture } from '../src/textureLoader';
import type { TextureWorkerRequest, TextureWorkerResponse } from '../src/textureWorkerProtocol';

class Decoder {
  static instances: Decoder[] = [];
  readonly messages: TextureWorkerRequest[] = [];
  readonly terminate = vi.fn();
  onmessage?: (event: { data: TextureWorkerResponse }) => void;
  onerror?: (event: { message: string }) => void;
  onmessageerror?: () => void;
  constructor() {
    Decoder.instances.push(this);
  }
  postMessage(request: TextureWorkerRequest) {
    this.messages.push(request);
  }
}

beforeEach(() => {
  Decoder.instances = [];
  vi.stubGlobal('Worker', Decoder);
  vi.stubGlobal('document', { baseURI: 'https://example.test/game/' });
});
afterEach(() => {
  disposeTextureAssets();
  vi.unstubAllGlobals();
});

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
  // A finished decode is not cached: its pixels live only as long as a reader keeps them.
  expect(loadKtexTexture('./ground.tex')).not.toBe(first);
  expect(decoder.messages).toHaveLength(2);
});

it('shares one released GPU source per file and sampling variant, and decodes it again for a new GPU copy', async () => {
  const decode = (pixels: number[]) => {
    const decoder = Decoder.instances[0];
    const request = decoder.messages.at(-1)!;
    decoder.onmessage!({ data: { id: request.id, texture: { width: 1, height: 1, pixels: new Uint8Array(pixels) } } });
  };
  const loading = [loadKtexDataTexture('./noise.tex', 'repeat'), loadKtexDataTexture('./noise.tex', 'repeat')];
  decode([1, 2, 3, 4]);
  const [first, second] = await Promise.all(loading);
  const clamped = loadKtexDataTexture('./noise.tex', 'clamp');
  decode([1, 2, 3, 4]);
  // Textures sampled alike share one Source, so a renderer keeps one GPU copy; another variant has its own.
  expect(second.source).toBe(first.source);
  expect((await clamped).source).not.toBe(first.source);
  expect(first.image.data).toEqual(new Uint8Array([1, 2, 3, 4]));

  first.onUpdate!(first); // The renderer uploaded the shared pixels.
  expect(first.image.data).toBeNull();
  expect(second.image.data).toBeNull();

  // A GPU copy made without data (a restored context) decodes the file again and binds every texture of it.
  const version = second.version;
  first.onUpdate!(first);
  first.onUpdate!(first); // One decode while it is pending.
  expect(Decoder.instances[0].messages).toHaveLength(3);
  decode([5, 6, 7, 8]);
  await ktexReloadsSettled();
  expect(first.image.data).toEqual(new Uint8Array([5, 6, 7, 8]));
  expect(second.version).toBeGreaterThan(version);
  first.onUpdate!(first);
  expect(first.image.data).toBeNull();
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
  decoder.onmessage!({
    data: { id: decoder.messages[1].id, texture: { width: 1, height: 1, pixels: new Uint8Array(4) } },
  });
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
