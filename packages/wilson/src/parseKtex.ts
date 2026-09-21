export interface DecodedTexture {
  width: number;
  height: number;
  pixels: Uint8Array;
}

class KtexReader {
  private readonly data: Uint8Array;
  private readonly view: DataView;
  private readonly label: string;
  private offset = 0;

  constructor(data: Uint8Array, label: string) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.label = label;
  }

  private ensure(size: number) {
    if (this.offset + size > this.data.byteLength) {
      throw new Error(`${this.label}: unexpected end of file at byte ${this.offset}`);
    }
  }

  bytes(size: number) {
    this.ensure(size);
    const result = this.data.subarray(this.offset, this.offset + size);
    this.offset += size;
    return result;
  }

  ascii(size: number) {
    return String.fromCharCode(...this.bytes(size));
  }

  u16() {
    this.ensure(2);
    const result = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return result;
  }

  u32() {
    this.ensure(4);
    const result = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return result;
  }
}

function rgb565(value: number) {
  return [
    Math.round(((value >>> 11) & 31) * 255 / 31),
    Math.round(((value >>> 5) & 63) * 255 / 63),
    Math.round((value & 31) * 255 / 31),
  ];
}

function colourTable(c0: number, c1: number, forceFourColours: boolean) {
  const a = rgb565(c0);
  const b = rgb565(c1);
  if (c0 > c1 || forceFourColours) {
    return [a, b, a.map((value, i) => Math.round((2 * value + b[i]) / 3)),
      a.map((value, i) => Math.round((value + 2 * b[i]) / 3))];
  }
  return [a, b, a.map((value, i) => Math.round((value + b[i]) / 2)), [0, 0, 0]];
}

function decodeBC(data: Uint8Array, width: number, height: number, type: 1 | 2 | 3) {
  const output = new Uint8Array(width * height * 4);
  let offset = 0;
  for (let blockY = 0; blockY < Math.ceil(height / 4); blockY++) {
    for (let blockX = 0; blockX < Math.ceil(width / 4); blockX++) {
      let alphas: number[] | undefined;
      if (type === 2) {
        alphas = new Array<number>(16);
        for (let index = 0; index < 8; index++) {
          alphas[index * 2] = (data[offset + index] & 15) * 17;
          alphas[index * 2 + 1] = (data[offset + index] >>> 4) * 17;
        }
        offset += 8;
      } else if (type === 3) {
        const alpha0 = data[offset];
        const alpha1 = data[offset + 1];
        const table = [alpha0, alpha1];
        if (alpha0 > alpha1) {
          for (let index = 1; index <= 6; index++) table.push(Math.round(((7 - index) * alpha0 + index * alpha1) / 7));
        } else {
          for (let index = 1; index <= 4; index++) table.push(Math.round(((5 - index) * alpha0 + index * alpha1) / 5));
          table.push(0, 255);
        }
        let bits = 0n;
        for (let index = 0; index < 6; index++) bits |= BigInt(data[offset + 2 + index]) << BigInt(index * 8);
        alphas = Array.from({ length: 16 }, (_, index) => table[Number((bits >> BigInt(index * 3)) & 7n)]);
        offset += 8;
      }

      const c0 = data[offset] | (data[offset + 1] << 8);
      const c1 = data[offset + 2] | (data[offset + 3] << 8);
      const colours = colourTable(c0, c1, type !== 1);
      const indices = (data[offset + 4] | (data[offset + 5] << 8) |
        (data[offset + 6] << 16) | (data[offset + 7] << 24)) >>> 0;
      offset += 8;
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const pixel = y * 4 + x;
          const targetX = blockX * 4 + x;
          const targetY = blockY * 4 + y;
          if (targetX >= width || targetY >= height) continue;
          const colourIndex = (indices >>> (pixel * 2)) & 3;
          const target = (targetY * width + targetX) * 4;
          output.set(colours[colourIndex], target);
          output[target + 3] = alphas?.[pixel] ?? (c0 <= c1 && colourIndex === 3 ? 0 : 255);
        }
      }
    }
  }
  return output;
}

export function parseKtex(data: Uint8Array, label = 'KTEX'): DecodedTexture {
  const reader = new KtexReader(data, label);
  if (reader.ascii(4) !== 'KTEX') throw new Error(`${label}: invalid KTEX signature`);
  const header = reader.u32();
  const mipCount = Math.floor(header / 8192) % 32;
  const pixelFormat = Math.floor(header / 16) % 32;
  const mips = Array.from({ length: mipCount }, () => ({
    width: reader.u16(), height: reader.u16(), pitch: reader.u16(), size: reader.u32(),
  }));
  const first = mips[0];
  if (!first) throw new Error(`${label}: texture contains no mip levels`);
  const source = reader.bytes(first.size);
  let pixels: Uint8Array;
  if (pixelFormat <= 2) pixels = decodeBC(source, first.width, first.height, (pixelFormat + 1) as 1 | 2 | 3);
  else if (pixelFormat === 4) pixels = new Uint8Array(source.subarray(0, first.width * first.height * 4));
  else throw new Error(`${label}: unsupported KTEX pixel format ${pixelFormat}`);

  const rowSize = first.width * 4;
  const flipped = new Uint8Array(pixels.length);
  for (let y = 0; y < first.height; y++) {
    flipped.set(pixels.subarray(y * rowSize, (y + 1) * rowSize), (first.height - y - 1) * rowSize);
  }
  if (pixelFormat <= 2) {
    for (let index = 0; index < flipped.length; index += 4) {
      const alpha = flipped[index + 3];
      if (!alpha) flipped[index] = flipped[index + 1] = flipped[index + 2] = 0;
      else if (alpha !== 255) {
        flipped[index] = Math.min(255, Math.round(flipped[index] * 255 / alpha));
        flipped[index + 1] = Math.min(255, Math.round(flipped[index + 1] * 255 / alpha));
        flipped[index + 2] = Math.min(255, Math.round(flipped[index + 2] * 255 / alpha));
      }
    }
  }
  return { width: first.width, height: first.height, pixels: flipped };
}
