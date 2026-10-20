import { parseKtex } from "@dontstarve-web/animation/parseKtex"

export type Matrix = [number, number, number, number, number, number]

export type AnimElement = {
  imghash: number
  imgindex: number
  layerhash: number
  matrix: Matrix
  z: number
}

export type AnimFrame = {
  x: number
  y: number
  width: number
  height: number
  elements: AnimElement[]
}

export type Animation = {
  name: string
  facing: number
  bankhash: number
  framerate: number
  frames: AnimFrame[]
  bounds: { left: number; right: number; top: number; bottom: number }
}

export type BuildImage = {
  index: number
  duration: number
  x: number
  y: number
  width: number
  height: number
  sampler: number
  bbx: number
  bby: number
  canvasWidth: number
  canvasHeight: number
  vertexIndex: number
  vertexCount: number
}

export type Build = {
  name: string
  atlasNames: string[]
  symbols: Map<number, BuildImage[]>
}

export type KleiAnimationAsset = {
  animation: Animation
  animations: Animation[]
  build: Build
  atlas: DecodedTexture
}

export type DecodedTexture = {
  width: number
  height: number
  pixels: Uint8Array
}

class BinaryReader {
  private view: DataView
  private bytes: Uint8Array
  offset = 0

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer)
    this.bytes = new Uint8Array(buffer)
  }

  skip(length: number) { this.offset += length }
  u8() { const value = this.view.getUint8(this.offset); this.offset += 1; return value }
  u16() { const value = this.view.getUint16(this.offset, true); this.offset += 2; return value }
  u32() { const value = this.view.getUint32(this.offset, true); this.offset += 4; return value }
  f32() { const value = this.view.getFloat32(this.offset, true); this.offset += 4; return value }

  string(length: number) {
    const value = new TextDecoder().decode(this.bytes.subarray(this.offset, this.offset + length))
    this.offset += length
    return value
  }

  sizedString() { return this.string(this.u32()) }
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

export function parseBuild(buffer: ArrayBuffer): Build {
  const reader = new BinaryReader(buffer)
  if (reader.string(4) !== "BILD") throw new Error("不是有效的 Klei BILD 文件")
  reader.skip(4)
  const symbolCount = reader.u32()
  reader.skip(4)
  const name = reader.sizedString()
  const atlasCount = reader.u32()
  const atlasNames = Array.from({ length: atlasCount }, () => reader.sizedString())
  const symbols = new Map<number, BuildImage[]>()
  const allImages: BuildImage[] = []

  for (let i = 0; i < symbolCount; i += 1) {
    const hash = reader.u32()
    const imageCount = reader.u32()
    const images: BuildImage[] = []
    for (let j = 0; j < imageCount; j += 1) {
      const image: BuildImage = {
        index: reader.u32(),
        duration: reader.u32(),
        x: reader.f32(),
        y: reader.f32(),
        width: reader.f32(),
        height: reader.f32(),
        vertexIndex: reader.u32(),
        vertexCount: reader.u32(),
        sampler: 0,
        bbx: 0,
        bby: 0,
        canvasWidth: 0,
        canvasHeight: 0,
      }
      images.push(image)
      allImages.push(image)
    }
    symbols.set(hash, images)
  }

  reader.u32() // total vertex count
  for (const image of allImages) {
    const samplers: number[] = []
    const bbxs: number[] = []
    const bbys: number[] = []
    const canvasWidths: number[] = []
    const canvasHeights: number[] = []

    for (let group = 0; group < image.vertexCount / 6; group += 1) {
      const vertex = Array.from({ length: 36 }, () => reader.f32())
      const left = vertex[0]
      const top = vertex[1]
      const right = vertex[6]
      const bottom = vertex[13]
      const uMin = vertex[3]
      const uMax = vertex[9]
      const vMin = 1 - vertex[4]
      const vMax = 1 - vertex[16]
      const canvasWidth = (right - left) / Math.max(uMax - uMin, 0.00001)
      const canvasHeight = (bottom - top) / Math.max(vMax - vMin, 0.00001)
      samplers.push(vertex[5])
      canvasWidths.push(canvasWidth)
      canvasHeights.push(canvasHeight)
      bbxs.push(uMin * canvasWidth - (left - (image.x - image.width / 2)))
      bbys.push(vMin * canvasHeight - (top - (image.y - image.height / 2)))
    }

    if (samplers.length) {
      image.sampler = Math.floor(median(samplers) + 0.5)
      image.bbx = median(bbxs)
      image.bby = median(bbys)
      image.canvasWidth = median(canvasWidths)
      image.canvasHeight = median(canvasHeights)
    }
  }

  return { name, atlasNames, symbols }
}

export function parseAnimations(buffer: ArrayBuffer): Animation[] {
  const reader = new BinaryReader(buffer)
  if (reader.string(4) !== "ANIM") throw new Error("不是有效的 Klei ANIM 文件")
  reader.skip(16)
  const animationCount = reader.u32()
  if (!animationCount) throw new Error("动画文件不包含任何片段")

  const animations: Animation[] = []
  for (let animationIndex = 0; animationIndex < animationCount; animationIndex += 1) {
    const name = reader.sizedString()
    const facing = reader.u8()
    const bankhash = reader.u32()
    const framerate = reader.f32()
    const frameCount = reader.u32()
    const frames: AnimFrame[] = []
    const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const x = reader.f32()
      const y = reader.f32()
      const width = reader.f32()
      const height = reader.f32()
      bounds.left = Math.min(bounds.left, x - width / 2)
      bounds.right = Math.max(bounds.right, x + width / 2)
      bounds.top = Math.min(bounds.top, y - height / 2)
      bounds.bottom = Math.max(bounds.bottom, y + height / 2)
      const eventCount = reader.u32()
      reader.skip(eventCount * 4)
      const elementCount = reader.u32()
      const elements: AnimElement[] = []
      for (let elementIndex = 0; elementIndex < elementCount; elementIndex += 1) {
        const imghash = reader.u32()
        const imgindex = reader.u32()
        const layerhash = reader.u32()
        const matrix = Array.from({ length: 6 }, () => reader.f32()) as Matrix
        const z = reader.f32()
        elements.push({ imghash, imgindex, layerhash, matrix, z })
      }
      elements.sort((a, b) => b.z - a.z)
      frames.push({ x, y, width, height, elements })
    }

    animations.push({ name, facing, bankhash, framerate, frames, bounds })
  }

  return animations
}

export function parseAnimation(buffer: ArrayBuffer): Animation {
  return parseAnimations(buffer)[0]
}

export function parseAtlas(buffer: ArrayBuffer): DecodedTexture {
  const pixelFormat = Math.floor(new DataView(buffer).getUint32(4, true) / 16) % 32
  if (pixelFormat !== 2) throw new Error(`当前展示仅支持 DXT5 图集（收到格式 ${pixelFormat}）`)
  return parseKtex(new Uint8Array(buffer), "atlas")
}

export async function loadKleiAnimationAsset(root: string): Promise<KleiAnimationAsset> {
  const [animationBuffer, buildBuffer, atlasBuffer] = await Promise.all([
    fetch(`${root}/anim.bin`).then(response => {
      if (!response.ok) throw new Error("无法读取 anim.bin")
      return response.arrayBuffer()
    }),
    fetch(`${root}/build.bin`).then(response => {
      if (!response.ok) throw new Error("无法读取 build.bin")
      return response.arrayBuffer()
    }),
    fetch(`${root}/atlas-0.tex`).then(response => {
      if (!response.ok) throw new Error("无法读取 atlas-0.tex")
      return response.arrayBuffer()
    }),
  ])

  const animations = parseAnimations(animationBuffer)
  const animation = animations[0]
  const build = parseBuild(buildBuffer)
  const atlas = parseAtlas(atlasBuffer)
  return { animation, animations, build, atlas }
}

