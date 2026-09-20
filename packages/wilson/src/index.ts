import { unzipSync } from 'fflate';
import * as THREE from 'three';

type Matrix2D = [number, number, number, number, number, number];

interface AnimElement {
  imageHash: number;
  imageIndex: number;
  layerHash: number;
  matrix: Matrix2D;
  z: number;
}

interface Animation {
  name: string;
  facing: number;
  bankHash: number;
  frameRate: number;
  frames: Array<{ elements: AnimElement[] }>;
}

interface ParsedAnim {
  animations: Animation[];
}

interface BuildImage {
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

interface ParsedBuild {
  name: string;
  atlasNames: string[];
  symbols: Map<number, BuildImage[]>;
}

interface DecodedTexture {
  width: number;
  height: number;
  pixels: Uint8Array;
}

interface BuildPackage {
  build: ParsedBuild;
  atlases: DecodedTexture[];
}

export type WilsonFacing = 'up' | 'down' | 'side';

export interface WilsonAnimationController {
  start(state: 'idle' | 'walk' | 'run' | 'jump'): void;
  setFacing(facing: WilsonFacing, mirrored?: boolean): void;
  update(dt: number, jumpProgress?: number): void;
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

  f32() {
    this.ensure(4);
    const result = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return result;
  }
}

function smallHash(value: string) {
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
  const vertexFloat = (vertex: number, component: number) => vertices.getFloat32(vertex * 24 + component * 4, true);

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

function parseKtex(data: Uint8Array, label: string): DecodedTexture {
  const reader = new BinaryReader(data, label);
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
  if (!response.ok) throw new Error(`Unable to load Wilson asset ${file}: HTTP ${response.status}`);
  return unzipSync(new Uint8Array(await response.arrayBuffer()));
}

async function loadAnim(file: string, assetBaseUrl: string) {
  const entries = await loadEntries(file, assetBaseUrl);
  const data = findEntry(entries, 'anim.bin');
  if (!data) throw new Error(`${file} does not contain anim.bin`);
  return parseAnim(data, `${file}:anim.bin`);
}

async function loadBuild(file: string, assetBaseUrl: string): Promise<BuildPackage> {
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

function findImage(build: ParsedBuild, hash: number, frameIndex: number) {
  let result: BuildImage | undefined;
  for (const image of build.symbols.get(hash) ?? []) {
    if (image.index <= frameIndex && image.index + image.duration > frameIndex &&
      (!result || image.index > result.index)) result = image;
  }
  return result?.vertexCount ? result : undefined;
}

const facingValues: Record<WilsonFacing, number> = { down: 8, side: 5, up: 2 };
const unarmedHiddenLayers = new Set([smallHash('ARM_carry')]);

class WilsonController implements WilsonAnimationController {
  private readonly meshes: THREE.Mesh[] = [];
  private readonly geometries = new WeakMap<BuildImage, THREE.BufferGeometry>();
  private readonly materials: THREE.MeshBasicMaterial[];
  private state: 'idle' | 'walk' | 'run' | 'jump' = 'idle';
  private facing: WilsonFacing = 'down';
  private mirrored = false;
  private animation!: Animation;
  private elapsed = 0;
  private frameIndex = -1;
  private readonly visual: THREE.Group;
  private readonly build: ParsedBuild;
  private readonly animations: Record<'idle' | 'walk' | 'run' | 'jump', ParsedAnim>;

  constructor(
    visual: THREE.Group,
    build: ParsedBuild,
    animations: Record<'idle' | 'walk' | 'run' | 'jump', ParsedAnim>,
    materials: THREE.MeshBasicMaterial[],
  ) {
    this.visual = visual;
    this.build = build;
    this.animations = animations;
    this.materials = materials;
    this.selectAnimation();
  }

  start(state: 'idle' | 'walk' | 'run' | 'jump') {
    if (state === this.state) return;
    this.state = state;
    this.selectAnimation();
  }

  setFacing(facing: WilsonFacing, mirrored = false) {
    if (facing === this.facing && mirrored === this.mirrored) return;
    this.facing = facing;
    this.mirrored = mirrored;
    this.visual.scale.x = Math.abs(this.visual.scale.x) * (mirrored ? -1 : 1);
    this.selectAnimation();
  }

  update(dt: number, jumpProgress?: number) {
    if (this.state === 'jump' && jumpProgress !== undefined) {
      const progress = THREE.MathUtils.clamp(jumpProgress, 0, 1);
      const nextFrame = Math.min(
        this.animation.frames.length - 1,
        Math.floor(progress * this.animation.frames.length),
      );
      this.showFrame(nextFrame);
      return;
    }
    this.elapsed += Math.min(dt, 0.1);
    const speed = this.state === 'walk' ? 16 : this.animation.frameRate;
    const nextFrame = Math.floor(this.elapsed * speed) % this.animation.frames.length;
    this.showFrame(nextFrame);
  }

  private selectAnimation() {
    const name = this.state === 'idle' ? 'idle_loop' : this.state === 'jump' ? 'jump' : 'run_loop';
    const parsed = this.animations[this.state];
    const bankHash = smallHash('wilson');
    const facing = facingValues[this.facing];
    const candidates = parsed.animations.filter((animation) =>
      animation.name === name && animation.bankHash === bankHash);
    this.animation = candidates.find((animation) => animation.facing === facing) ??
      candidates.find((animation) => (animation.facing & facing) !== 0) ?? candidates[0];
    if (!this.animation) throw new Error(`Wilson animation ${name} is unavailable`);
    this.elapsed = 0;
    this.frameIndex = -1;
    this.showFrame(0);
  }

  private showFrame(index: number) {
    if (index === this.frameIndex) return;
    this.frameIndex = index;
    const sprites = this.animation.frames[index].elements
      .filter((element) => !unarmedHiddenLayers.has(element.layerHash))
      .sort((a, b) => b.z - a.z)
      .map((element) => ({ element, image: findImage(this.build, element.imageHash, element.imageIndex) }))
      .filter((sprite): sprite is { element: AnimElement; image: BuildImage } => Boolean(sprite.image));

    for (let spriteIndex = 0; spriteIndex < sprites.length; spriteIndex++) {
      const { element, image } = sprites[spriteIndex];
      let mesh = this.meshes[spriteIndex];
      if (!mesh) {
        mesh = new THREE.Mesh();
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        this.meshes.push(mesh);
        this.visual.add(mesh);
      }
      mesh.visible = true;
      mesh.geometry = this.geometryFor(image);
      mesh.material = this.materials[image.sampler ?? 0];
      const [a, b, c, d, x, y] = element.matrix;
      mesh.matrix.set(a, c, 0, x, b, d, 0, y, 0, 0, 1, 0, 0, 0, 0, 1);
      mesh.renderOrder = spriteIndex;
    }
    for (let indexToHide = sprites.length; indexToHide < this.meshes.length; indexToHide++) {
      this.meshes[indexToHide].visible = false;
    }
  }

  private geometryFor(image: BuildImage) {
    const cached = this.geometries.get(image);
    if (cached) return cached;
    const x0 = image.x - image.width / 2;
    const y0 = image.y - image.height / 2;
    const x1 = x0 + image.width;
    const y1 = y0 + image.height;
    const u0 = image.bbx! / image.canvasWidth!;
    const v0 = image.bby! / image.canvasHeight!;
    const u1 = (image.bbx! + image.width) / image.canvasWidth!;
    const v1 = (image.bby! + image.height) / image.canvasHeight!;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0,
    ], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
      u0, v0, u1, v0, u1, v1, u0, v1,
    ], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometries.set(image, geometry);
    return geometry;
  }
}

export async function createWilsonPlayer(assetBaseUrl: string): Promise<THREE.Group> {
  const [buildPackage, idle, movement, jump] = await Promise.all([
    loadBuild('wilson.zip', assetBaseUrl),
    loadAnim('player_idles.zip', assetBaseUrl),
    loadAnim('player_basic.zip', assetBaseUrl),
    loadAnim('player_jump.zip', assetBaseUrl),
  ]);
  if (buildPackage.build.name.toLowerCase() !== 'wilson') {
    throw new Error(`Expected Wilson build, received ${buildPackage.build.name}`);
  }

  const textures = buildPackage.atlases.map((atlas) => {
    const texture = new THREE.DataTexture(atlas.pixels, atlas.width, atlas.height, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  });
  const materials = textures.map((map) => new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    alphaTest: 0.01,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  }));

  const player = new THREE.Group();
  player.name = 'Wilson';
  player.position.set(0, 30, 0);
  player.userData.billboard = true;

  const visual = new THREE.Group();
  const assetToWorldScale = 0.02;
  visual.scale.set(assetToWorldScale, -assetToWorldScale, assetToWorldScale);
  player.add(visual);

  const controller = new WilsonController(visual, buildPackage.build, {
    idle,
    walk: movement,
    run: movement,
    jump,
  }, materials);
  player.userData.animationController = controller;
  return player;
}
