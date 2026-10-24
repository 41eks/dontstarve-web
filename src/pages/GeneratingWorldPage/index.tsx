import { useEffect, useRef, useState } from "react"
import { assetUrl } from "../../assetUrl"
import AtlasSprite from "../MainScreenPage/AtlasSprite"
import type { StageWorkerRequest, StageWorkerResponse } from "./stage.worker"
import styles from "./style.module.css"

const WORLDGEN_PURPLE: [number, number, number] = [202 / 255, 48 / 255, 209 / 255]

type GeneratingWorldPageProps = {
  loadError?: string
}

export default function GeneratingWorldPage({ loadError }: GeneratingWorldPageProps) {
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    document.title = "世界生成中"
    const stage = stageRef.current
    const host = canvasHostRef.current
    if (!stage || !host) return
    // transferControlToOffscreen is one-shot per canvas, so create it per effect run.
    const canvas = document.createElement("canvas")
    canvas.className = styles.animationCanvas
    host.appendChild(canvas)
    const offscreen = canvas.transferControlToOffscreen()
    const worker = new Worker(new URL("./stage.worker.ts", import.meta.url), { type: "module" })
    worker.onmessage = ({ data }: MessageEvent<StageWorkerResponse>) => {
      if (data.type === "ready") setLoading(false)
      else {
        setError(data.message)
        setLoading(false)
      }
    }
    const toAbsolute = (path: string) => new URL(assetUrl(path), window.location.href).href
    worker.postMessage({
      type: "init",
      canvas: offscreen,
      worldRoot: toAbsolute("generating-world"),
      handsRoot: toAbsolute("creepy-hands"),
      width: Math.max(1, stage.clientWidth),
      height: Math.max(1, stage.clientHeight),
      pixelRatio: window.devicePixelRatio || 1,
    } satisfies StageWorkerRequest, [offscreen])
    const observer = new ResizeObserver(([entry]) => {
      worker.postMessage({
        type: "resize",
        width: Math.max(1, entry.contentRect.width),
        height: Math.max(1, entry.contentRect.height),
      } satisfies StageWorkerRequest)
    })
    observer.observe(stage)
    return () => {
      observer.disconnect()
      worker.terminate()
      canvas.remove()
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || loading) return
    audio.volume = 0.72
    void audio.play().catch(() => undefined)
    return () => audio.pause()
  }, [loading])

  return (
    <main className={styles.page} aria-label="世界生成中" aria-busy={!loadError}>
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
        <div className={styles.canvasHost} ref={canvasHostRef} />
        {loading && !loadError && <div className={styles.loader}><i /><span>世界正在生成</span></div>}
        {(loadError || error) && <div className={styles.error}><b>{loadError ? "游戏载入失败" : "资源载入失败"}</b><span>{loadError || error}</span></div>}
      </div>
    </main>
  )
}
