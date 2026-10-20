import { loadKleiAnimationAsset } from "./kleiAnimation"
import { createGeneratingWorldThreeStage, type GeneratingWorldThreeStage } from "./threeStage"

export type StageWorkerRequest =
  | { type: "init"; canvas: OffscreenCanvas; worldRoot: string; handsRoot: string; width: number; height: number; pixelRatio: number }
  | { type: "resize"; width: number; height: number }

export type StageWorkerResponse =
  | { type: "ready" }
  | { type: "error"; message: string }

type WorkerScope = {
  onmessage: ((event: MessageEvent<StageWorkerRequest>) => void) | null
  postMessage: (message: StageWorkerResponse) => void
  requestAnimationFrame: (callback: (time: number) => void) => number
  cancelAnimationFrame: (handle: number) => void
}

const scope = self as unknown as WorkerScope

let stage: GeneratingWorldThreeStage | undefined
let size = { width: 1, height: 1 }

async function init(request: Extract<StageWorkerRequest, { type: "init" }>) {
  try {
    const [world, hands] = await Promise.all([
      loadKleiAnimationAsset(request.worldRoot),
      loadKleiAnimationAsset(request.handsRoot),
    ])
    const created = createGeneratingWorldThreeStage(request.canvas, world, hands, request.pixelRatio)
    stage = created
    created.resize(size.width, size.height)

    let worldFrame = 0
    let handFrames: [number, number] = [0, Math.floor(hands.animation.frames.length / 2)]
    let worldAccumulator = 0
    let handsAccumulator = 0
    let previous = performance.now()
    const tick = (time: number) => {
      const elapsed = Math.min(100, time - previous)
      previous = time
      worldAccumulator += elapsed * world.animation.framerate / 1000
      handsAccumulator += elapsed * hands.animation.framerate / 1000
      if (worldAccumulator >= 1) {
        const advanced = Math.floor(worldAccumulator)
        worldAccumulator -= advanced
        worldFrame = (worldFrame + advanced) % world.animation.frames.length
      }
      if (handsAccumulator >= 1) {
        const advanced = Math.floor(handsAccumulator)
        handsAccumulator -= advanced
        handFrames = handFrames.map(frame => (
          (frame + advanced) % hands.animation.frames.length
        )) as [number, number]
      }
      created.render(worldFrame, handFrames, true)
      scope.requestAnimationFrame(tick)
    }
    scope.requestAnimationFrame(tick)
    scope.postMessage({ type: "ready" })
  } catch (reason) {
    scope.postMessage({ type: "error", message: reason instanceof Error ? reason.message : String(reason) })
  }
}

scope.onmessage = ({ data }) => {
  if (data.type === "init") {
    size = { width: data.width, height: data.height }
    void init(data)
  } else if (data.type === "resize") {
    size = { width: data.width, height: data.height }
    stage?.resize(data.width, data.height)
  }
}
