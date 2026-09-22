import * as THREE from "three"
import type { BuildImage, KleiAnimationAsset } from "./kleiAnimation"

type AnimationObject = {
  group: THREE.Group
  showFrame: (frameIndex: number) => void
  dispose: () => void
}

export type GeneratingWorldThreeStage = {
  resize: (width: number, height: number) => void
  render: (worldFrame: number, handFrames: [number, number], handsVisible: boolean) => void
  dispose: () => void
}

function findImage(images: BuildImage[], requestedIndex: number) {
  let result: BuildImage | undefined
  for (const image of images) {
    if (image.index > requestedIndex) break
    if (image.index + image.duration > requestedIndex) result = image
  }
  return result?.vertexCount ? result : undefined
}

function createDataTexture(asset: KleiAnimationAsset) {
  const { atlas } = asset
  const texture = new THREE.DataTexture(atlas.pixels, atlas.width, atlas.height, THREE.RGBAFormat)
  texture.name = `${asset.build.name}:atlas-0`
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.generateMipmaps = false
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

function createAnimationObject(asset: KleiAnimationAsset, renderOrderBase: number): AnimationObject {
  const texture = createDataTexture(asset)
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.01,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
  material.name = `${asset.build.name}:material`

  const group = new THREE.Group()
  group.name = asset.build.name
  const meshes: THREE.Mesh[] = []
  const geometries = new Map<BuildImage, THREE.BufferGeometry>()
  let currentFrame = -1

  const geometryFor = (image: BuildImage) => {
    const cached = geometries.get(image)
    if (cached) return cached
    const x0 = image.x - image.width / 2
    const y0 = image.y - image.height / 2
    const x1 = x0 + image.width
    const y1 = y0 + image.height
    const u0 = image.bbx / image.canvasWidth
    const v0 = image.bby / image.canvasHeight
    const u1 = (image.bbx + image.width) / image.canvasWidth
    const v1 = (image.bby + image.height) / image.canvasHeight
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0,
    ], 3))
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
      u0, v0, u1, v0, u1, v1, u0, v1,
    ], 2))
    geometry.setIndex([0, 1, 2, 0, 2, 3])
    geometries.set(image, geometry)
    return geometry
  }

  const showFrame = (frameIndex: number) => {
    if (frameIndex === currentFrame) return
    currentFrame = frameIndex
    const frame = asset.animation.frames[frameIndex]
    if (!frame) return
    const sprites = frame.elements.map(element => ({
      element,
      image: findImage(asset.build.symbols.get(element.imghash) || [], element.imgindex),
    })).filter((sprite): sprite is typeof sprite & { image: BuildImage } => Boolean(sprite.image))

    sprites.forEach(({ element, image }, spriteIndex) => {
      let mesh = meshes[spriteIndex]
      if (!mesh) {
        mesh = new THREE.Mesh()
        mesh.matrixAutoUpdate = false
        mesh.frustumCulled = false
        mesh.material = material
        meshes.push(mesh)
        group.add(mesh)
      }
      mesh.visible = true
      mesh.geometry = geometryFor(image)
      const [a, b, c, d, x, y] = element.matrix
      mesh.matrix.set(a, c, 0, x, b, d, 0, y, 0, 0, 1, 0, 0, 0, 0, 1)
      mesh.renderOrder = renderOrderBase + spriteIndex
    })
    for (let index = sprites.length; index < meshes.length; index += 1) meshes[index].visible = false
  }

  showFrame(0)
  return {
    group,
    showFrame,
    dispose: () => {
      geometries.forEach(geometry => geometry.dispose())
      material.dispose()
      texture.dispose()
    },
  }
}

export function createGeneratingWorldThreeStage(
  canvas: HTMLCanvasElement,
  worldAsset: KleiAnimationAsset,
  handsAsset: KleiAnimationAsset,
): GeneratingWorldThreeStage {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0xffffff, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-500, 475, 390, -350, 0.1, 2000)
  camera.position.z = 1000

  const visual = new THREE.Group()
  visual.name = "WorldGenLuaComposite"
  // Keep the globe's equator at the bottom edge so only its upper hemisphere
  // is visible, while preserving the original world/hands composition.
  visual.position.y = -405
  visual.scale.y = -1
  scene.add(visual)

  const world = createAnimationObject(worldAsset, 0)
  const rightHand = createAnimationObject(handsAsset, 1000)
  const leftHand = createAnimationObject(handsAsset, 2000)
  rightHand.group.position.x = 400
  rightHand.group.scale.set(1.5, 1.5, 1.5)
  leftHand.group.position.x = -425
  leftHand.group.scale.set(-1.5, 1.5, 1.5)
  visual.add(world.group, rightHand.group, leftHand.group)

  const resize = (width: number, height: number) => {
    renderer.setSize(width, height, false)
    const bounds = { left: -500, right: 475, top: -390, bottom: 350 }
    const contentWidth = (bounds.right - bounds.left) * 1.14
    const contentHeight = (bounds.bottom - bounds.top) * 1.14
    const contentAspect = contentWidth / contentHeight
    const viewportAspect = width / height
    const viewWidth = viewportAspect > contentAspect ? contentHeight * viewportAspect : contentWidth
    const viewHeight = viewportAspect > contentAspect ? contentHeight : contentWidth / viewportAspect
    const centerX = (bounds.left + bounds.right) / 2
    const centerY = -(bounds.top + bounds.bottom) / 2
    camera.left = centerX - viewWidth / 2
    camera.right = centerX + viewWidth / 2
    camera.top = centerY + viewHeight / 2
    camera.bottom = centerY - viewHeight / 2
    camera.updateProjectionMatrix()
  }

  return {
    resize,
    render: (worldFrame, handFrames, handsVisible) => {
      world.showFrame(worldFrame)
      rightHand.showFrame(handFrames[0])
      leftHand.showFrame(handFrames[1])
      rightHand.group.visible = handsVisible
      leftHand.group.visible = handsVisible
      renderer.render(scene, camera)
    },
    dispose: () => {
      world.dispose()
      rightHand.dispose()
      leftHand.dispose()
      renderer.dispose()
    },
  }
}
