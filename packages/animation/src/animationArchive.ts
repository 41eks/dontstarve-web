import { unzipSync } from 'fflate';
import { parseKtex, type DecodedTexture } from './parseKtex';
import { decodeDyn } from './decodeDyn';

export type Matrix2D = [number, number, number, number, number, number];

export interface AnimElement {
  imageHash: number;
  imageIndex: number;
  layerHash: number;
  matrix: Matrix2D;
  z: number;
}

export interface Animation {
  name: string;
  facing: number;
  bankHash: number;
  frameRate: number;
  frames: Array<{ elements: AnimElement[] }>;
}

export interface ParsedAnim {
  animations: Animation[];
}

export interface BuildImage {
  index: number;
  duration: number;
  x: number;
  y: number;
  width: number;
  height: number;
  vertexIndex: number;
  vertexCount: number;
  sampler?: number;
  bbx?: number;
  bby?: number;
  canvasWidth?: number;
  canvasHeight?: number;
}

export interface ParsedBuild {
  name: string;
  atlasNames: string[];
  symbols: Map<number, BuildImage[]>;
}

export interface BuildPackage {
  build: ParsedBuild;
  atlases: DecodedTexture[];
}

class BinaryReader {
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

  skip(size: number) {
    this.ensure(size);
    this.offset += size;
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

  string() {
    return new TextDecoder().decode(this.bytes(this.u32()));
  }

  u8() {
    this.ensure(1);
    return this.view.getUint8(this.offset++);
  }

  u32() {
    this.ensure(4);
    const result = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return result;
  }

  f32() {
    this.ensure(4);
    const result = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return result;
  }
}

export function smallHash(value: string) {
  let hash = 0;
  for (const character of value) {
    let code = character.codePointAt(0) ?? 0;
    if (code >= 65 && code <= 90) code += 32;
    hash = (Math.imul(hash, 65599) + code) >>> 0;
  }
  return hash;
}

function skipHashTable(reader: BinaryReader) {
  const count = reader.u32();
  for (let index = 0; index < count; index++) {
    reader.u32();
    reader.string();
  }
}

function parseAnim(data: Uint8Array, label: string): ParsedAnim {
  const reader = new BinaryReader(data, label);
  if (reader.ascii(4) !== 'ANIM') throw new Error(`${label}: invalid ANIM signature`);
  reader.skip(16);
  const animationCount = reader.u32();
  const animations: Animation[] = [];

  for (let animationIndex = 0; animationIndex < animationCount; animationIndex++) {
    const name = reader.string();
    const facing = reader.u8();
    const bankHash = reader.u32();
    const frameRate = reader.f32();
    const frameCount = reader.u32();
    const frames: Animation['frames'] = [];

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      reader.skip(16);
      reader.skip(reader.u32() * 4);
      const elementCount = reader.u32();
      const elements: AnimElement[] = [];
      for (let elementIndex = 0; elementIndex < elementCount; elementIndex++) {
        elements.push({
          imageHash: reader.u32(),
          imageIndex: reader.u32(),
          layerHash: reader.u32(),
          matrix: [reader.f32(), reader.f32(), reader.f32(), reader.f32(), reader.f32(), reader.f32()],
          z: reader.f32(),
        });
      }
      frames.push({ elements });
    }

    animations.push({ name, facing, bankHash, frameRate, frames });
  }
  skipHashTable(reader);
  return { animations };
}

function median(values: number[]) {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function parseBuild(data: Uint8Array, label: string): ParsedBuild {
  const reader = new BinaryReader(data, label);
  if (reader.ascii(4) !== 'BILD') throw new Error(`${label}: invalid BILD signature`);
  reader.skip(4);
  const symbolCount = reader.u32();
  reader.skip(4);
  const name = reader.string();
  const atlasNames = Array.from({ length: reader.u32() }, () => reader.string());
  const symbols = new Map<number, BuildImage[]>();
  const images: BuildImage[] = [];

  for (let symbolIndex = 0; symbolIndex < symbolCount; symbolIndex++) {
    const hash = reader.u32();
    const symbolImages: BuildImage[] = [];
    for (let imageIndex = 0, count = reader.u32(); imageIndex < count; imageIndex++) {
      const image: BuildImage = {
        index: reader.u32(), duration: reader.u32(), x: reader.f32(), y: reader.f32(),
        width: reader.f32(), height: reader.f32(), vertexIndex: reader.u32(), vertexCount: reader.u32(),
      };
      symbolImages.push(image);
      images.push(image);
    }
    symbols.set(hash, symbolImages);
  }

  const vertexCount = reader.u32();
  const vertexBytes = reader.bytes(vertexCount * 24);
  const vertices = new DataView(vertexBytes.buffer, vertexBytes.byteOffset, vertexBytes.byteLength);
  const vertexFloat = (vertex: number, component: number) =>
    vertices.getFloat32(vertex * 24 + component * 4, true);

  for (const image of images) {
    if (!image.vertexCount) continue;
    const samplers: number[] = [];
    const bbxs: number[] = [];
    const bbys: number[] = [];
    const widths: number[] = [];
    const heights: number[] = [];
    for (let group = 0; group < image.vertexCount / 6; group++) {
      const start = image.vertexIndex + group * 6;
      const left = vertexFloat(start, 0);
      const top = vertexFloat(start, 1);
      const right = vertexFloat(start + 1, 0);
      const bottom = vertexFloat(start + 2, 1);
      const uMin = vertexFloat(start, 3);
      const uMax = vertexFloat(start + 1, 3);
      const vMin = 1 - vertexFloat(start, 4);
      const vMax = 1 - vertexFloat(start + 2, 4);
      const canvasWidth = (right - left) / Math.max(uMax - uMin, 0.00001);
      const canvasHeight = (bottom - top) / Math.max(vMax - vMin, 0.00001);
      samplers.push(vertexFloat(start, 5));
      bbxs.push(uMin * canvasWidth - (left - (image.x - image.width / 2)));
      bbys.push(vMin * canvasHeight - (top - (image.y - image.height / 2)));
      widths.push(canvasWidth);
      heights.push(canvasHeight);
    }
    image.sampler = Math.round(median(samplers));
    image.bbx = median(bbxs);
    image.bby = median(bbys);
    image.canvasWidth = median(widths);
    image.canvasHeight = median(heights);
  }

  skipHashTable(reader);
  return { name, atlasNames, symbols };
}

function findEntry(entries: Record<string, Uint8Array>, wanted: string) {
  const normalized = wanted.toLowerCase();
  const key = Object.keys(entries).find((entry) => {
    const candidate = entry.replaceAll('\\', '/').toLowerCase();
    return candidate === normalized || candidate.endsWith(`/${normalized}`);
  });
  return key ? entries[key] : undefined;
}

async function loadEntries(file: string, assetBaseUrl: string) {
  const response = await fetch(`${assetBaseUrl.replace(/\/$/, '')}/${file}`);
  if (!response.ok) throw new Error(`Unable to load animation asset ${file}: HTTP ${response.status}`);
  return unzipSync(new Uint8Array(await response.arrayBuffer()));
}

async function buildPackageFromEntries(
  entries: Record<string, Uint8Array>,
  file: string,
  assetBaseUrl: string,
): Promise<BuildPackage> {
  const data = findEntry(entries, 'build.bin');
  if (!data) throw new Error(`${file} does not contain build.bin`);
  const build = parseBuild(data, `${file}:build.bin`);
  let atlasEntries = entries;
  if (file.startsWith('dynamic/') && build.atlasNames.some((name) => !findEntry(entries, name))) {
    const atlasFile = file.replace(/\.zip$/, '.dyn');
    const response = await fetch(`${assetBaseUrl.replace(/\/$/, '')}/${atlasFile}`);
    if (!response.ok) throw new Error(`Unable to load animation asset ${atlasFile}: HTTP ${response.status}`);
    atlasEntries = unzipSync(decodeDyn(new Uint8Array(await response.arrayBuffer())));
  }
  const atlases = build.atlasNames.map((name) => {
    const atlas = findEntry(entries, name) ?? findEntry(atlasEntries, name);
    if (!atlas) throw new Error(`${file} does not contain ${name}`);
    return parseKtex(atlas, `${file}:${name}`);
  });
  return { build, atlases };
}

export interface AnimationArchiveParts {
  animation: ParsedAnim | undefined;
  build: BuildPackage;
}

// Only retain ZIP contents while consumers are parsing them. The caller caches
// parsed results, so compressed entries need not remain alongside RGBA pixels.
const pendingEntries = new Map<string, {
  request: Promise<Record<string, Uint8Array>>;
  users: number;
}>();

export async function readAnimationArchivePart<Kind extends keyof AnimationArchiveParts>(
  file: string, assetBaseUrl: string, kind: Kind,
): Promise<AnimationArchiveParts[Kind]> {
  const key = `${assetBaseUrl.replace(/\/$/, '')}/${file}`;
  let pending = pendingEntries.get(key);
  if (!pending) {
    pending = { request: loadEntries(file, assetBaseUrl), users: 0 };
    pendingEntries.set(key, pending);
  }
  pending.users++;
  try {
    const entries = await pending.request;
    if (kind === 'build') {
      return await buildPackageFromEntries(entries, file, assetBaseUrl) as AnimationArchiveParts[Kind];
    }
    const data = findEntry(entries, 'anim.bin');
    return (data ? parseAnim(data, `${file}:anim.bin`) : undefined) as AnimationArchiveParts[Kind];
  } finally {
    if (--pending.users === 0) pendingEntries.delete(key);
  }
}
