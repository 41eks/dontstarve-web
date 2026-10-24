import { useEffect, useRef, useState } from "react"
import { assetUrl } from "../../assetUrl"
import AtlasSprite from "../MainScreenPage/AtlasSprite"
import { loadGeneratingWorldAsset, loadKleiAnimationAsset, type KleiAnimationAsset } from "./kleiAnimation"
import { createGeneratingWorldThreeStage, type GeneratingWorldThreeStage } from "./threeStage"
import styles from "./style.module.css"

const WORLDGEN_PURPLE: [number, number, number] = [202 / 255, 48 / 255, 209 / 255]

type GeneratingWorldPageProps = {
  onReady?: () => void
}

export default function GeneratingWorldPage({ onReady }: GeneratingWorldPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const threeStageRef = useRef<GeneratingWorldThreeStage>()
  const audioRef = useRef<HTMLAudioElement>(null)
  const worldRef = useRef<KleiAnimationAsset>()
  const handsRef = useRef<KleiAnimationAsset>()
  const frameRef = useRef(0)
  const handsFrameRef = useRef<[number, number]>([0, 0])
  const readyRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [stageSize, setStageSize] = useState({ width: window.innerWidth, height: window.innerHeight })

  useEffect(() => {
    document.title = "世界生成中"
    Promise.all([
      loadGeneratingWorldAsset(),
      loadKleiAnimationAsset(assetUrl("creepy-hands")),
    ]).then(([world, hands]) => {
      worldRef.current = world
      handsRef.current = hands
      handsFrameRef.current = [0, Math.floor(hands.animation.frames.length / 2)]
      setLoading(false)
    }).catch(reason => {
      setError(reason instanceof Error ? reason.message : String(reason))
      setLoading(false)
      onReady?.()
    })
  }, [onReady])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      })
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const world = worldRef.current
    const hands = handsRef.current
    if (loading || !canvas || !world || !hands) return
    const stage = createGeneratingWorldThreeStage(canvas, world, hands)
    stage.resize(stageSize.width, stageSize.height)
    threeStageRef.current = stage
    if (!readyRef.current) {
      readyRef.current = true
      onReady?.()
    }
    return () => {
      stage.dispose()
      if (threeStageRef.current === stage) threeStageRef.current = undefined
    }
  }, [loading, onReady])

  useEffect(() => {
    threeStageRef.current?.resize(stageSize.width, stageSize.height)
  }, [stageSize])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || loading) return
    audio.volume = 0.72
    void audio.play().catch(() => undefined)
    return () => audio.pause()
  }, [loading])

  useEffect(() => {
    let request = 0
    let previous = performance.now()
    let worldAccumulator = 0
    let handsAccumulator = 0
    const tick = (time: number) => {
      const world = worldRef.current
      const hands = handsRef.current
      const stage = threeStageRef.current
      const elapsed = Math.min(100, time - previous)
      if (world && hands && stage) {
        worldAccumulator += elapsed * world.animation.framerate / 1000
        handsAccumulator += elapsed * hands.animation.framerate / 1000
        if (worldAccumulator >= 1) {
          const advanced = Math.floor(worldAccumulator)
          worldAccumulator -= advanced
          frameRef.current = (frameRef.current + advanced) % world.animation.frames.length
        }
        if (handsAccumulator >= 1) {
          const advanced = Math.floor(handsAccumulator)
          handsAccumulator -= advanced
          handsFrameRef.current = handsFrameRef.current.map(frame => (
            (frame + advanced) % hands.animation.frames.length
          )) as [number, number]
        }
        stage.render(frameRef.current, handsFrameRef.current, true)
      }
      previous = time
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [loading])

  return (
    <main className={styles.page} aria-label="世界生成中">
      <audio ref={audioRef} src={assetUrl("audio/worldgen.wav")} preload="auto" loop />
      <div className={styles.stage} ref={stageRef}>
        <AtlasSprite
          assetRoot={assetUrl("hamlet-assets/ui")}
          atlas="ui"
          sprite="bg_plain.tex"
          className={styles.stageBackground}
          tint={WORLDGEN_PURPLE}
          alt="世界生成界面的紫色纹理背景"
        />
        <canvas className={styles.animationCanvas} ref={canvasRef} />
        {loading && <div className={styles.loader}><i /><span>世界正在生成</span></div>}
        {error && <div className={styles.error}><b>资源载入失败</b><span>{error}</span></div>}
      </div>
    </main>
  )
}
