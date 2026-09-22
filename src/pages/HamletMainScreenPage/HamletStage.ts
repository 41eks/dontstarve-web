import * as THREE from "three"
import type { Animation, BuildImage, KleiAnimationAsset } from "../GeneratingWorldPage/kleiAnimation"

type AnimationObject = {
  group: THREE.Group
  showFrame: (animation: Animation, frameIndex: number) => void
  dispose: () => void
}

export type HamletStage = {
  resize: (width: number, height: number) => void
  render: (titleFrame: number, characterAnimation: Animation, characterFrame: number) => void
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

function createAnimationObject(asset: KleiAnimationAsset, renderOrderBase: number): AnimationObject {
  const texture = new THREE.DataTexture(asset.atlas.pixels, asset.atlas.width, asset.atlas.height, THREE.RGBAFormat)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.generateMipmaps = false
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.01,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
  const group = new THREE.Group()
  group.name = asset.build.name
  const meshes: THREE.Mesh[] = []
  const geometries = new Map<BuildImage, THREE.BufferGeometry>()
  let currentAnimation: Animation | undefined
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

  const showFrame = (animation: Animation, frameIndex: number) => {
    if (animation === currentAnimation && frameIndex === currentFrame) return
    currentAnimation = animation
    currentFrame = frameIndex
    const frame = animation.frames[frameIndex]
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

  showFrame(asset.animation, 0)
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

export function createHamletStage(
  canvas: HTMLCanvasElement,
  titleAsset: KleiAnimationAsset,
  characterAsset: KleiAnimationAsset,
): HamletStage {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0xffffff, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-640, 640, 360, -360, 0.1, 2000)
  camera.position.z = 1000

  const title = createAnimationObject(titleAsset, 0)
  title.group.position.set(0, -360, 0)
  title.group.scale.set(.98, -.98, .98)
  scene.add(title.group)

  const character = createAnimationObject(characterAsset, 1000)
  character.group.position.set(-470, -450, 0)
  character.group.scale.set(1, -1, 1)
  scene.add(character.group)

  const resize = (width: number, height: number) => {
    renderer.setSize(width, height, false)
    const viewportAspect = width / height
    const referenceAspect = 16 / 9
    if (viewportAspect > referenceAspect) {
      const viewWidth = 720 * viewportAspect
      camera.left = -viewWidth / 2
      camera.right = viewWidth / 2
      camera.top = 360
      camera.bottom = -360
    } else {
      const viewHeight = 1280 / viewportAspect
      camera.left = -640
      camera.right = 640
      camera.top = viewHeight / 2
      camera.bottom = -viewHeight / 2
    }
    camera.updateProjectionMatrix()
  }

  return {
    resize,
    render: (titleFrame, characterAnimation, characterFrame) => {
      title.showFrame(titleAsset.animation, titleFrame)
      character.showFrame(characterAnimation, characterFrame)
      renderer.render(scene, camera)
    },
    dispose: () => {
      title.dispose()
      character.dispose()
      renderer.dispose()
    },
  }
}
