import { packAlphaMask, type AlphaMask } from './alphaMask';

export interface DecodedTexture {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export type BcType = 1 | 2 | 3;

/** Block-compressed texels in the same vertically flipped layout as decoded RGBA, for upload as they are. */
export interface CompressedTexture {
  width: number;
  height: number;
  /** BC1 (DXT1) colour is straight; BC2/BC3 (DXT3/DXT5) colour is premultiplied by alpha. */
  bcType: BcType;
  blocks: Uint8Array;
  /** Picking coverage in the layout of the decoded RGBA, read without the colour. */
  alpha: AlphaMask;
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

/** The sixteen alphas of a BC2 explicit four-bit alpha block at `offset`. */
function decodeBc2Alpha(data: Uint8Array, offset: number, alphas: Uint8Array) {
  for (let index = 0; index < 8; index++) {
    alphas[index * 2] = (data[offset + index] & 15) * 17;
    alphas[index * 2 + 1] = (data[offset + index] >>> 4) * 17;
  }
}

/** The sixteen alphas of a BC3 interpolated alpha block at `offset`. */
function decodeBc3Alpha(data: Uint8Array, offset: number, alphaTable: Uint8Array, alphas: Uint8Array) {
  const alpha0 = data[offset];
  const alpha1 = data[offset + 1];
  alphaTable[0] = alpha0;
  alphaTable[1] = alpha1;
  if (alpha0 > alpha1) {
    for (let index = 1; index <= 6; index++) {
      alphaTable[index + 1] = Math.round(((7 - index) * alpha0 + index * alpha1) / 7);
    }
  } else {
    for (let index = 1; index <= 4; index++) {
      alphaTable[index + 1] = Math.round(((5 - index) * alpha0 + index * alpha1) / 5);
    }
    alphaTable[6] = 0;
    alphaTable[7] = 255;
  }
  const low = (data[offset + 2] | (data[offset + 3] << 8) | (data[offset + 4] << 16)) >>> 0;
  const high = (data[offset + 5] | (data[offset + 6] << 8) | (data[offset + 7] << 16)) >>> 0;
  for (let index = 0; index < 8; index++) {
    alphas[index] = alphaTable[(low >>> (index * 3)) & 7];
    alphas[index + 8] = alphaTable[(high >>> (index * 3)) & 7];
  }
}

function decodeBC(data: Uint8Array, width: number, height: number, type: BcType) {
  // Decodes straight into the final vertically flipped, un-premultiplied RGBA layout.
  const output = new Uint8Array(width * height * 4);
  const colours = new Uint8Array(16);
  const alphas = new Uint8Array(16);
  const alphaTable = new Uint8Array(8);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const premultiplied = type !== 1;
  let offset = 0;
  for (let blockY = 0; blockY < blocksY; blockY++) {
    for (let blockX = 0; blockX < blocksX; blockX++) {
      if (type === 2) {
        decodeBc2Alpha(data, offset, alphas);
        offset += 8;
      } else if (type === 3) {
        decodeBc3Alpha(data, offset, alphaTable, alphas);
        offset += 8;
      }

      const c0 = data[offset] | (data[offset + 1] << 8);
      const c1 = data[offset + 2] | (data[offset + 3] << 8);
      const r0 = Math.round((((c0 >>> 11) & 31) * 255) / 31);
      const g0 = Math.round((((c0 >>> 5) & 63) * 255) / 63);
      const b0 = Math.round(((c0 & 31) * 255) / 31);
      const r1 = Math.round((((c1 >>> 11) & 31) * 255) / 31);
      const g1 = Math.round((((c1 >>> 5) & 63) * 255) / 63);
      const b1 = Math.round(((c1 & 31) * 255) / 31);
      colours[0] = r0;
      colours[1] = g0;
      colours[2] = b0;
      colours[4] = r1;
      colours[5] = g1;
      colours[6] = b1;
      const fourColours = c0 > c1 || type !== 1;
      if (fourColours) {
        colours[8] = Math.round((2 * r0 + r1) / 3);
        colours[9] = Math.round((2 * g0 + g1) / 3);
        colours[10] = Math.round((2 * b0 + b1) / 3);
        colours[12] = Math.round((r0 + 2 * r1) / 3);
        colours[13] = Math.round((g0 + 2 * g1) / 3);
        colours[14] = Math.round((b0 + 2 * b1) / 3);
      } else {
        colours[8] = Math.round((r0 + r1) / 2);
        colours[9] = Math.round((g0 + g1) / 2);
        colours[10] = Math.round((b0 + b1) / 2);
        colours[12] = colours[13] = colours[14] = 0;
      }
      const indices =
        (data[offset + 4] | (data[offset + 5] << 8) | (data[offset + 6] << 16) | (data[offset + 7] << 24)) >>> 0;
      offset += 8;
      for (let y = 0; y < 4; y++) {
        const sourceY = blockY * 4 + y;
        if (sourceY >= height) {
          break;
        }
        const rowStart = (height - 1 - sourceY) * width;
        for (let x = 0; x < 4; x++) {
          const targetX = blockX * 4 + x;
          if (targetX >= width) {
            break;
          }
          const pixel = y * 4 + x;
          const colourIndex = (indices >>> (pixel * 2)) & 3;
          const target = (rowStart + targetX) * 4;
          const source = colourIndex * 4;
          const alpha = type === 1 ? (!fourColours && colourIndex === 3 ? 0 : 255) : alphas[pixel];
          output[target + 3] = alpha;
          if (!alpha) {
            continue;
          }
          if (premultiplied && alpha !== 255) {
            output[target] = Math.min(255, Math.round((colours[source] * 255) / alpha));
            output[target + 1] = Math.min(255, Math.round((colours[source + 1] * 255) / alpha));
            output[target + 2] = Math.min(255, Math.round((colours[source + 2] * 255) / alpha));
          } else {
            output[target] = colours[source];
            output[target + 1] = colours[source + 1];
            output[target + 2] = colours[source + 2];
          }
        }
      }
    }
  }
  return output;
}

/** KTEX pixel formats 0–2 are DXT1, DXT3 and DXT5: BC1–BC3. */
const BC_TYPES = [1, 2, 3] as const;

function readKtex(data: Uint8Array, label: string) {
  const reader = new KtexReader(data, label);
  if (reader.ascii(4) !== 'KTEX') {
    throw new Error(`${label}: invalid KTEX signature`);
  }
  const header = reader.u32();
  const mipCount = Math.floor(header / 8192) % 32;
  const pixelFormat = Math.floor(header / 16) % 32;
  const mips = Array.from({ length: mipCount }, () => ({
    width: reader.u16(),
    height: reader.u16(),
    pitch: reader.u16(),
    size: reader.u32(),
  }));
  const first = mips[0];
  if (!first) {
    throw new Error(`${label}: texture contains no mip levels`);
  }
  return { pixelFormat, width: first.width, height: first.height, source: reader.bytes(first.size) };
}

function bcBlockBytes(type: BcType) {
  return type === 1 ? 8 : 16;
}

/**
 * Reverses the block rows and the four texel rows inside every block, giving the blocks of the vertically flipped
 * image. Only whole blocks flip exactly, so the height must be a multiple of four.
 */
export function flipBcBlocks(data: Uint8Array, width: number, height: number, type: BcType): Uint8Array {
  const blockBytes = bcBlockBytes(type);
  const blocksY = height / 4;
  const rowBytes = Math.ceil(width / 4) * blockBytes;
  const output = new Uint8Array(blocksY * rowBytes);
  for (let blockY = 0; blockY < blocksY; blockY++) {
    output.set(data.subarray(blockY * rowBytes, (blockY + 1) * rowBytes), (blocksY - 1 - blockY) * rowBytes);
  }
  const swap = (a: number, b: number) => {
    const value = output[a];
    output[a] = output[b];
    output[b] = value;
  };
  for (let offset = 0; offset < output.length; offset += blockBytes) {
    if (type === 2) {
      // Four bits per texel: two bytes per row.
      swap(offset, offset + 6);
      swap(offset + 1, offset + 7);
      swap(offset + 2, offset + 4);
      swap(offset + 3, offset + 5);
    } else if (type === 3) {
      // Two alpha endpoints, then three bits per texel: twelve bits per row, rows 0–1 and 2–3 in 24-bit halves.
      const low = output[offset + 2] | (output[offset + 3] << 8) | (output[offset + 4] << 16);
      const high = output[offset + 5] | (output[offset + 6] << 8) | (output[offset + 7] << 16);
      const flippedLow = (high >>> 12) | ((high & 0xfff) << 12);
      const flippedHigh = (low >>> 12) | ((low & 0xfff) << 12);
      output[offset + 2] = flippedLow & 255;
      output[offset + 3] = (flippedLow >>> 8) & 255;
      output[offset + 4] = flippedLow >>> 16;
      output[offset + 5] = flippedHigh & 255;
      output[offset + 6] = (flippedHigh >>> 8) & 255;
      output[offset + 7] = flippedHigh >>> 16;
    }
    // The colour block ends in one byte of two-bit indices per row.
    const colour = offset + blockBytes - 8;
    swap(colour + 4, colour + 7);
    swap(colour + 5, colour + 6);
  }
  return output;
}

/** Only the alpha of BC texels, in the vertically flipped layout `decodeBC` writes. */
export function decodeBcAlpha(data: Uint8Array, width: number, height: number, type: BcType): Uint8Array {
  const output = new Uint8Array(width * height);
  const alphas = new Uint8Array(16);
  const alphaTable = new Uint8Array(8);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const blockBytes = bcBlockBytes(type);
  for (let blockY = 0, offset = 0; blockY < blocksY; blockY++) {
    for (let blockX = 0; blockX < blocksX; blockX++, offset += blockBytes) {
      if (type === 1) {
        const c0 = data[offset] | (data[offset + 1] << 8);
        const c1 = data[offset + 2] | (data[offset + 3] << 8);
        const indices =
          (data[offset + 4] | (data[offset + 5] << 8) | (data[offset + 6] << 16) | (data[offset + 7] << 24)) >>> 0;
        for (let pixel = 0; pixel < 16; pixel++) {
          alphas[pixel] = c0 <= c1 && ((indices >>> (pixel * 2)) & 3) === 3 ? 0 : 255;
        }
      } else if (type === 2) {
        decodeBc2Alpha(data, offset, alphas);
      } else {
        decodeBc3Alpha(data, offset, alphaTable, alphas);
      }
      for (let y = 0; y < 4; y++) {
        const sourceY = blockY * 4 + y;
        if (sourceY >= height) {
          break;
        }
        const rowStart = (height - 1 - sourceY) * width;
        for (let x = 0; x < 4; x++) {
          const targetX = blockX * 4 + x;
          if (targetX >= width) {
            break;
          }
          output[rowStart + targetX] = alphas[y * 4 + x];
        }
      }
    }
  }
  return output;
}

/**
 * The BC blocks of a DXT1/3/5 texture, ready for a compressed upload, or undefined when the texture is another format
 * or its size is not whole blocks (its blocks could not be flipped exactly); decode those with `parseKtex`.
 */
export function parseKtexBlocks(data: Uint8Array, label = 'KTEX'): CompressedTexture | undefined {
  const { pixelFormat, width, height, source } = readKtex(data, label);
  if (pixelFormat > 2 || width % 4 || height % 4) {
    return undefined;
  }
  const bcType = BC_TYPES[pixelFormat];
  const size = (width / 4) * (height / 4) * bcBlockBytes(bcType);
  if (source.length < size) {
    throw new Error(`${label}: BC data is shorter than its ${width}x${height} size`);
  }
  return {
    width,
    height,
    bcType,
    blocks: flipBcBlocks(source.subarray(0, size), width, height, bcType),
    alpha: packAlphaMask(decodeBcAlpha(source, width, height, bcType), width, height),
  };
}

export function parseKtex(data: Uint8Array, label = 'KTEX'): DecodedTexture {
  const { pixelFormat, width, height, source } = readKtex(data, label);
  if (pixelFormat <= 2) {
    return { width, height, pixels: decodeBC(source, width, height, BC_TYPES[pixelFormat]) };
  }
  let pixels: Uint8Array;
  if (pixelFormat === 4) {
    pixels = new Uint8Array(source.subarray(0, width * height * 4));
  } else if (pixelFormat === 5) {
    pixels = new Uint8Array(width * height * 4);
    for (let sourceIndex = 0, targetIndex = 0; targetIndex < pixels.length; sourceIndex += 3, targetIndex += 4) {
      pixels[targetIndex] = source[sourceIndex];
      pixels[targetIndex + 1] = source[sourceIndex + 1];
      pixels[targetIndex + 2] = source[sourceIndex + 2];
      pixels[targetIndex + 3] = 255;
    }
  } else {
    throw new Error(`${label}: unsupported KTEX pixel format ${pixelFormat}`);
  }

  const rowSize = width * 4;
  const flipped = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y++) {
    flipped.set(pixels.subarray(y * rowSize, (y + 1) * rowSize), (height - y - 1) * rowSize);
  }
  return { width, height, pixels: flipped };
}
