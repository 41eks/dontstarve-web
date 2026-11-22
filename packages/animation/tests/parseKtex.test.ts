import { describe, expect, it } from 'vitest';
import { parseKtex, parseKtexBlocks, parseKtexRegion, type BcType } from '@dontstarve-web/animation/parseKtex';
import { ALPHA_MASK_THRESHOLD, alphaMaskTexel, packAlphaMask } from '../src/alphaMask';

function makeKtex(pixelFormat: number, width: number, height: number, data: Uint8Array, mipCount = 1) {
  const output = new Uint8Array(8 + mipCount * 10 + data.length);
  output.set([0x4b, 0x54, 0x45, 0x58]);
  const view = new DataView(output.buffer);
  view.setUint32(4, mipCount * 8192 + pixelFormat * 16, true);
  if (mipCount) {
    view.setUint16(8, width, true);
    view.setUint16(10, height, true);
    view.setUint16(12, width * 4, true);
    view.setUint32(14, data.length, true);
    output.set(data, 18);
  }
  return output;
}

function makeColourBlock(c0: number, c1: number, indices: number) {
  const block = new Uint8Array(8);
  const view = new DataView(block.buffer);
  view.setUint16(0, c0, true);
  view.setUint16(2, c1, true);
  view.setUint32(4, indices, true);
  return block;
}

describe('parseKtex', () => {
  it('decodes and vertically flips uncompressed RGBA textures', () => {
    const source = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 64, 1, 2, 3, 4]);

    const texture = parseKtex(makeKtex(4, 2, 2, source));

    expect(texture.width).toBe(2);
    expect(texture.height).toBe(2);
    expect(Array.from(texture.pixels)).toEqual([0, 0, 255, 64, 1, 2, 3, 4, 255, 0, 0, 255, 0, 255, 0, 128]);
  });

  it('decodes and vertically flips uncompressed RGB textures', () => {
    const source = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 1, 2, 3]);

    const texture = parseKtex(makeKtex(5, 2, 2, source));

    expect(texture.width).toBe(2);
    expect(texture.height).toBe(2);
    expect(Array.from(texture.pixels)).toEqual([0, 0, 255, 255, 1, 2, 3, 255, 255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it('decodes BC1 colours and flips their rows', () => {
    let indices = 0;
    for (let pixel = 0; pixel < 16; pixel++) {
      indices |= Math.floor(pixel / 4) << (pixel * 2);
    }

    const texture = parseKtex(makeKtex(0, 4, 4, makeColourBlock(0xf800, 0x001f, indices)));

    expect(Array.from(texture.pixels.slice(0, 4))).toEqual([85, 0, 170, 255]);
    expect(Array.from(texture.pixels.slice(16, 20))).toEqual([170, 0, 85, 255]);
    expect(Array.from(texture.pixels.slice(32, 36))).toEqual([0, 0, 255, 255]);
    expect(Array.from(texture.pixels.slice(48, 52))).toEqual([255, 0, 0, 255]);
  });

  it('clears RGB channels for transparent BC1 pixels', () => {
    const block = makeColourBlock(0, 0xffff, 0xffffffff);

    const texture = parseKtex(makeKtex(0, 4, 4, block));

    expect(texture.pixels.every(channel => channel === 0)).toBe(true);
  });

  it('decodes BC2 four-bit alpha values', () => {
    const block = new Uint8Array(16);
    block.fill(0x88, 0, 8);
    block.set(makeColourBlock(0xffff, 0, 0), 8);

    const texture = parseKtex(makeKtex(1, 4, 4, block));

    expect(Array.from(texture.pixels.slice(0, 4))).toEqual([255, 255, 255, 136]);
    expect(texture.pixels.filter((_, index) => index % 4 === 3).every(alpha => alpha === 136)).toBe(true);
  });

  it('decodes BC3 interpolated alpha values', () => {
    const block = new Uint8Array(16);
    block[0] = 200;
    block[1] = 100;
    let alphaIndices = 0n;
    for (let pixel = 0; pixel < 16; pixel++) {
      alphaIndices |= 2n << BigInt(pixel * 3);
    }
    for (let byte = 0; byte < 6; byte++) {
      block[2 + byte] = Number((alphaIndices >> BigInt(byte * 8)) & 0xffn);
    }
    block.set(makeColourBlock(0xffff, 0, 0), 8);

    const texture = parseKtex(makeKtex(2, 4, 4, block));

    expect(Array.from(texture.pixels.slice(0, 4))).toEqual([255, 255, 255, 186]);
    expect(texture.pixels.filter((_, index) => index % 4 === 3).every(alpha => alpha === 186)).toBe(true);
  });

  it('rejects truncated input', () => {
    const truncated = makeKtex(4, 1, 1, new Uint8Array([1, 2, 3, 4])).subarray(0, 20);

    expect(() => parseKtex(truncated, 'truncated.tex')).toThrow('truncated.tex: unexpected end of file at byte 18');
  });

  /** Deterministic pseudo-random BC data, so every block mode and index pattern is sampled. */
  function randomBlocks(type: BcType, width: number, height: number) {
    const data = new Uint8Array((width / 4) * (height / 4) * (type === 1 ? 8 : 16));
    let seed = 12345 + type;
    for (let index = 0; index < data.length; index++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      data[index] = seed >>> 24;
    }
    return data;
  }

  it.each([1, 2, 3] as const)('keeps BC%i blocks for upload in the flipped layout of the decoded RGBA', type => {
    const width = 8,
      height = 12;
    const ktex = makeKtex(type - 1, width, height, randomBlocks(type, width, height));
    const decoded = parseKtex(ktex).pixels;

    const compressed = parseKtexBlocks(ktex)!;
    expect(compressed).toMatchObject({ width, height, bcType: type });
    // Decoding the uploaded blocks (parseKtex flips once more) gives the decoded RGBA with its rows reversed back.
    const reflipped = parseKtex(makeKtex(type - 1, width, height, compressed.blocks)).pixels;
    const rowSize = width * 4;
    for (let y = 0; y < height; y++) {
      expect(reflipped.subarray(y * rowSize, (y + 1) * rowSize)).toEqual(
        decoded.subarray((height - 1 - y) * rowSize, (height - y) * rowSize),
      );
    }
    expect(compressed.alpha).toEqual(packAlphaMask(decoded, width, height, 4, 3));
  });

  it('marks a texel covered from the alpha a material with alphaTest 0.01 draws at full opacity', () => {
    const alpha = new Uint8Array([0, ALPHA_MASK_THRESHOLD - 1, ALPHA_MASK_THRESHOLD, 255, 128, 0, 0, 0, 1]);
    const mask = packAlphaMask(alpha, 3, 3);
    expect(mask.bits.length).toBe(2);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(index => alphaMaskTexel(mask, index % 3, Math.floor(index / 3)))).toEqual([
      0, 0, 1, 1, 1, 0, 0, 0, 0,
    ]);
  });

  it('leaves textures that are not whole BC blocks to RGBA decoding', () => {
    expect(parseKtexBlocks(makeKtex(2, 4, 6, randomBlocks(3, 4, 8)))).toBeUndefined();
    expect(parseKtexBlocks(makeKtex(4, 4, 4, new Uint8Array(64)))).toBeUndefined();
  });

  it.each([
    [0, 12, 10],
    [1, 12, 10],
    [2, 12, 10],
    [2, 8, 7],
    [4, 6, 5],
  ] as const)(
    'decodes a region of pixel format %i (%ix%i) as the crop of the whole decode',
    (format, width, height) => {
      const data =
        format === 4
          ? Uint8Array.from({ length: width * height * 4 }, (_, index) => (index * 37) & 255)
          : randomBlocks(BC_FORMAT_TYPES[format], Math.ceil(width / 4) * 4, Math.ceil(height / 4) * 4);
      const ktex = makeKtex(format, width, height, data);
      const full = parseKtex(ktex).pixels;
      const region = { x: 1, y: 2, width: width - 3, height: height - 4 };
      const crop = new Uint8Array(region.width * region.height * 4);
      for (let y = 0; y < region.height; y++) {
        const start = ((region.y + y) * width + region.x) * 4;
        crop.set(full.subarray(start, start + region.width * 4), y * region.width * 4);
      }
      expect(parseKtexRegion(ktex, region)).toEqual({ width: region.width, height: region.height, pixels: crop });
      expect(() => parseKtexRegion(ktex, { x: 0, y: 0, width: width + 1, height: 1 })).toThrow('region outside');
    },
  );
});

const BC_FORMAT_TYPES = { 0: 1, 1: 2, 2: 3 } as const;
