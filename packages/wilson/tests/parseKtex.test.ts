import { describe, expect, it } from 'vitest';
import { parseKtex } from '@three-roaming/wilson/parseKtex';

function makeKtex(
  pixelFormat: number,
  width: number,
  height: number,
  data: Uint8Array,
  mipCount = 1,
) {
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
    const source = new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 128,
      0, 0, 255, 64, 1, 2, 3, 4,
    ]);

    const texture = parseKtex(makeKtex(4, 2, 2, source));

    expect(texture.width).toBe(2);
    expect(texture.height).toBe(2);
    expect(Array.from(texture.pixels)).toEqual([
      0, 0, 255, 64, 1, 2, 3, 4,
      255, 0, 0, 255, 0, 255, 0, 128,
    ]);
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

    expect(texture.pixels.every((channel) => channel === 0)).toBe(true);
  });

  it('decodes BC2 four-bit alpha values', () => {
    const block = new Uint8Array(16);
    block.fill(0x88, 0, 8);
    block.set(makeColourBlock(0xffff, 0, 0), 8);

    const texture = parseKtex(makeKtex(1, 4, 4, block));

    expect(Array.from(texture.pixels.slice(0, 4))).toEqual([255, 255, 255, 136]);
    expect(texture.pixels.filter((_, index) => index % 4 === 3).every((alpha) => alpha === 136)).toBe(true);
  });

  it('decodes BC3 interpolated alpha values', () => {
    const block = new Uint8Array(16);
    block[0] = 200;
    block[1] = 100;
    let alphaIndices = 0n;
    for (let pixel = 0; pixel < 16; pixel++) alphaIndices |= 2n << BigInt(pixel * 3);
    for (let byte = 0; byte < 6; byte++) {
      block[2 + byte] = Number((alphaIndices >> BigInt(byte * 8)) & 0xffn);
    }
    block.set(makeColourBlock(0xffff, 0, 0), 8);

    const texture = parseKtex(makeKtex(2, 4, 4, block));

    expect(Array.from(texture.pixels.slice(0, 4))).toEqual([255, 255, 255, 186]);
    expect(texture.pixels.filter((_, index) => index % 4 === 3).every((alpha) => alpha === 186)).toBe(true);
  });

  it('includes the supplied label in invalid-signature errors', () => {
    expect(() => parseKtex(new Uint8Array([0, 0, 0, 0]), 'broken.tex'))
      .toThrow('broken.tex: invalid KTEX signature');
  });

  it('rejects textures without mip levels', () => {
    expect(() => parseKtex(makeKtex(0, 0, 0, new Uint8Array(), 0)))
      .toThrow('KTEX: texture contains no mip levels');
  });

  it('rejects unsupported pixel formats', () => {
    expect(() => parseKtex(makeKtex(3, 1, 1, new Uint8Array())))
      .toThrow('KTEX: unsupported KTEX pixel format 3');
  });

  it('rejects truncated input', () => {
    const truncated = makeKtex(4, 1, 1, new Uint8Array([1, 2, 3, 4])).subarray(0, 20);

    expect(() => parseKtex(truncated, 'truncated.tex'))
      .toThrow('truncated.tex: unexpected end of file at byte 18');
  });
});
