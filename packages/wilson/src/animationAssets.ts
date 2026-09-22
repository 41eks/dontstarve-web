import { unzipSync } from 'fflate';
import * as THREE from 'three';
import { parseKtex, type DecodedTexture } from './parseKtex';

type Matrix2D = [number, number, number, number, number, number];

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

export interface ResolvedSprite {
  element: AnimElement;
  image: BuildImage;
  materials: THREE.MeshBasicMaterial[];
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

export async function loadAnim(file: string, assetBaseUrl: string) {
  const entries = await loadEntries(file, assetBaseUrl);
  const data = findEntry(entries, 'anim.bin');
  if (!data) throw new Error(`${file} does not contain anim.bin`);
  return parseAnim(data, `${file}:anim.bin`);
}

export async function loadBuild(file: string, assetBaseUrl: string): Promise<BuildPackage> {
  const entries = await loadEntries(file, assetBaseUrl);
  const data = findEntry(entries, 'build.bin');
  if (!data) throw new Error(`${file} does not contain build.bin`);
  const build = parseBuild(data, `${file}:build.bin`);
  const atlases = build.atlasNames.map((name) => {
    const atlas = findEntry(entries, name);
    if (!atlas) throw new Error(`${file} does not contain ${name}`);
    return parseKtex(atlas, `${file}:${name}`);
  });
  return { build, atlases };
}

export async function loadAnimationArchive(file: string, assetBaseUrl: string) {
  const entries = await loadEntries(file, assetBaseUrl);
  const animationData = findEntry(entries, 'anim.bin');
  const buildData = findEntry(entries, 'build.bin');
  if (!animationData) throw new Error(`${file} does not contain anim.bin`);
  if (!buildData) throw new Error(`${file} does not contain build.bin`);

  const build = parseBuild(buildData, `${file}:build.bin`);
  const atlases = build.atlasNames.map((name) => {
    const atlas = findEntry(entries, name);
    if (!atlas) throw new Error(`${file} does not contain ${name}`);
    return parseKtex(atlas, `${file}:${name}`);
  });
  return {
    buildPackage: { build, atlases },
    animations: parseAnim(animationData, `${file}:anim.bin`),
  };
}

export function findImage(build: ParsedBuild, hash: number, frameIndex: number) {
  let result: BuildImage | undefined;
  for (const image of build.symbols.get(hash) ?? []) {
    if (image.index <= frameIndex && image.index + image.duration > frameIndex &&
      (!result || image.index > result.index)) result = image;
  }
  return result?.vertexCount ? result : undefined;
}

export function createMaterials(buildPackage: BuildPackage) {
  return buildPackage.atlases.map((atlas) => {
    const texture = new THREE.DataTexture(atlas.pixels, atlas.width, atlas.height, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.01,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  });
}

export class SpriteFrameRenderer {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly materials: THREE.MeshBasicMaterial[] = [];
  private readonly materialIndices = new Map<THREE.MeshBasicMaterial, number>();
  private readonly mesh: THREE.Mesh;
  private positions = new Float32Array();
  private uvs = new Float32Array();
  private quadCapacity = 0;

  constructor(visual: THREE.Group) {
    this.mesh = new THREE.Mesh(this.geometry, this.materials);
    this.mesh.frustumCulled = false;
    visual.add(this.mesh);
  }

  show(sprites: ResolvedSprite[]) {
    if (sprites.length === 0) {
      this.mesh.visible = false;
      this.geometry.setDrawRange(0, 0);
      return;
    }
    if (sprites.length > 0x3fff) {
      throw new Error(`A sprite frame cannot contain more than ${0x3fff} parts`);
    }

    this.ensureCapacity(sprites.length);
    this.mesh.visible = true;
    this.materials.length = 0;
    this.materialIndices.clear();
    this.geometry.clearGroups();

    let currentMaterialIndex = -1;
    let groupStart = 0;
    let groupCount = 0;

    for (let spriteIndex = 0; spriteIndex < sprites.length; spriteIndex++) {
      const { element, image, materials } = sprites[spriteIndex];
      const material = materials[image.sampler ?? 0];
      if (!material) {
        throw new Error(`Sprite part ${spriteIndex} references a missing atlas material`);
      }

      let materialIndex = this.materialIndices.get(material);
      if (materialIndex === undefined) {
        materialIndex = this.materials.length;
        this.materials.push(material);
        this.materialIndices.set(material, materialIndex);
      }
      if (materialIndex !== currentMaterialIndex) {
        if (groupCount > 0) {
          this.geometry.addGroup(groupStart, groupCount, currentMaterialIndex);
        }
        currentMaterialIndex = materialIndex;
        groupStart = spriteIndex * 6;
        groupCount = 6;
      } else {
        groupCount += 6;
      }

      const [a, b, c, d, tx, ty] = element.matrix;
      const x0 = image.x - image.width / 2;
      const y0 = image.y - image.height / 2;
      const x1 = x0 + image.width;
      const y1 = y0 + image.height;
      const positionOffset = spriteIndex * 12;
      this.setPosition(positionOffset, x0, y0, a, b, c, d, tx, ty);
      this.setPosition(positionOffset + 3, x1, y0, a, b, c, d, tx, ty);
      this.setPosition(positionOffset + 6, x1, y1, a, b, c, d, tx, ty);
      this.setPosition(positionOffset + 9, x0, y1, a, b, c, d, tx, ty);

      const u0 = image.bbx! / image.canvasWidth!;
      const v0 = image.bby! / image.canvasHeight!;
      const u1 = (image.bbx! + image.width) / image.canvasWidth!;
      const v1 = (image.bby! + image.height) / image.canvasHeight!;
      const uvOffset = spriteIndex * 8;
      this.uvs[uvOffset] = u0;
      this.uvs[uvOffset + 1] = v0;
      this.uvs[uvOffset + 2] = u1;
      this.uvs[uvOffset + 3] = v0;
      this.uvs[uvOffset + 4] = u1;
      this.uvs[uvOffset + 5] = v1;
      this.uvs[uvOffset + 6] = u0;
      this.uvs[uvOffset + 7] = v1;
    }

    if (groupCount > 0) {
      this.geometry.addGroup(groupStart, groupCount, currentMaterialIndex);
    }
    this.geometry.setDrawRange(0, sprites.length * 6);
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('uv').needsUpdate = true;
  }

  private setPosition(
    offset: number,
    x: number,
    y: number,
    a: number,
    b: number,
    c: number,
    d: number,
    tx: number,
    ty: number,
  ) {
    this.positions[offset] = a * x + c * y + tx;
    this.positions[offset + 1] = b * x + d * y + ty;
    this.positions[offset + 2] = 0;
  }

  private ensureCapacity(quadCount: number) {
    if (quadCount <= this.quadCapacity) return;

    this.quadCapacity = THREE.MathUtils.ceilPowerOfTwo(Math.max(quadCount, 16));
    this.positions = new Float32Array(this.quadCapacity * 4 * 3);
    this.uvs = new Float32Array(this.quadCapacity * 4 * 2);
    const indices = new Uint16Array(this.quadCapacity * 6);
    for (let quadIndex = 0; quadIndex < this.quadCapacity; quadIndex++) {
      const vertexOffset = quadIndex * 4;
      const indexOffset = quadIndex * 6;
      indices.set([
        vertexOffset, vertexOffset + 1, vertexOffset + 2,
        vertexOffset, vertexOffset + 2, vertexOffset + 3,
      ], indexOffset);
    }

    const positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    const uvAttribute = new THREE.BufferAttribute(this.uvs, 2);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    uvAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', positionAttribute);
    this.geometry.setAttribute('uv', uvAttribute);
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  }
}
