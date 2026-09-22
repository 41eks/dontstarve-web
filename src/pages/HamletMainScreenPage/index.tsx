import { useEffect, useRef, useState } from "react"
import elsewhereKeyArt from "../../assets/1920px-DSE_key_art.jpg"
import { assetUrl } from "../../assetUrl"
import { loadKleiAnimationAsset, type Animation, type KleiAnimationAsset } from "../GeneratingWorldPage/kleiAnimation"
import AtlasSprite from "../MainScreenPage/AtlasSprite"
import { createHamletStage, type HamletStage } from "./HamletStage"
import styles from "./style.module.css"

const ASSET_ROOT = assetUrl("hamlet-assets/ui")
const HAMLET_GREEN: [number, number, number] = [87 / 255, 164 / 255, 86 / 255]
const PIG_ACTIONS = ["idle_happy", "emote_hat", "emote_bow"]
const randomPigDelay = () => 2 + Math.floor(Math.random() * 4)

type HamletMainScreenPageProps = {
  onStart?: () => void
}

function HamletButton({ label, focused, onClick }: { label: string; focused?: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  const active = focused || hovered
  return (
    <button
      className={`${styles.gameButton} ${active ? styles.gameButtonFocused : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onClick={onClick}
    >
      <AtlasSprite assetRoot={ASSET_ROOT} atlas="ui" sprite={active ? "button_over.tex" : "button.tex"} />
      <span>{label}</span>
    </button>
  )
}

export default function HamletMainScreenPage({ onStart }: HamletMainScreenPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const stageRef = useRef<HamletStage>()
  const titleAssetRef = useRef<KleiAnimationAsset>()
  const characterAssetRef = useRef<KleiAnimationAsset>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [musicPlaying, setMusicPlaying] = useState(false)
  const [notice, setNotice] = useState("DLC0003 MainScreen:DoInit() · HAMLET FRONTEND")
  const [viewportSize, setViewportSize] = useState({ width: window.innerWidth, height: window.innerHeight })

  useEffect(() => {
    document.title = "Don't Starve: Hamlet"
    Promise.all([
      loadKleiAnimationAsset(assetUrl("hamlet-assets/hamlet-title")),
      loadKleiAnimationAsset(assetUrl("hamlet-assets/corner-dude")),
    ]).then(([titleAsset, characterAsset]) => {
      titleAssetRef.current = titleAsset
      characterAssetRef.current = characterAsset
      setLoading(false)
    }).catch(reason => {
      setError(reason instanceof Error ? reason.message : String(reason))
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = 0.68
    void audio.play().catch(() => setMusicPlaying(false))
    return () => {
      audio.pause()
      audio.currentTime = 0
    }
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(([entry]) => {
      setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const titleAsset = titleAssetRef.current
    const characterAsset = characterAssetRef.current
    if (loading || !canvas || !titleAsset || !characterAsset) return
    const stage = createHamletStage(canvas, titleAsset, characterAsset)
    stage.resize(viewportSize.width, viewportSize.height)
    stageRef.current = stage
    return () => {
      stage.dispose()
      if (stageRef.current === stage) stageRef.current = undefined
    }
  }, [loading])

  useEffect(() => {
    stageRef.current?.resize(viewportSize.width, viewportSize.height)
  }, [viewportSize])

  useEffect(() => {
    let request = 0
    let previous = performance.now()
    let titleFrame = 0
    let characterFrame = 0
    let titleAccumulator = 0
    let characterAccumulator = 0
    let characterAnimation: Animation | undefined
    let nextPigAction = randomPigDelay()
    const tick = (time: number) => {
      const titleAsset = titleAssetRef.current
      const characterAsset = characterAssetRef.current
      const stage = stageRef.current
      const elapsed = Math.min(100, time - previous)
      if (titleAsset && characterAsset && stage) {
        const idleAnimation = characterAsset.animations.find(animation => animation.name === "idle") || characterAsset.animation
        if (!characterAnimation) characterAnimation = idleAnimation
        nextPigAction -= elapsed / 1000
        if (nextPigAction <= 0) {
          const actionName = PIG_ACTIONS[Math.floor(Math.random() * PIG_ACTIONS.length)]
          characterAnimation = characterAsset.animations.find(animation => animation.name === actionName) || idleAnimation
          characterFrame = 0
          characterAccumulator = 0
          nextPigAction = randomPigDelay()
        }
        titleAccumulator += elapsed * titleAsset.animation.framerate / 1000
        characterAccumulator += elapsed * characterAnimation.framerate / 1000
        if (titleAccumulator >= 1) {
          const advanced = Math.floor(titleAccumulator)
          titleAccumulator -= advanced
          titleFrame = (titleFrame + advanced) % titleAsset.animation.frames.length
        }
        if (characterAccumulator >= 1) {
          const advanced = Math.floor(characterAccumulator)
          characterAccumulator -= advanced
          const nextFrame = characterFrame + advanced
          if (characterAnimation !== idleAnimation && nextFrame >= characterAnimation.frames.length) {
            const completedLength = characterAnimation.frames.length
            characterAnimation = idleAnimation
            characterFrame = (nextFrame - completedLength) % idleAnimation.frames.length
          } else {
            characterFrame = nextFrame % characterAnimation.frames.length
          }
        }
        stage.render(titleFrame, characterAnimation, characterFrame)
      }
      previous = time
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [loading])

  const runAction = (action: string) => {
    if (action === "开始游戏！") {
      onStart?.()
      return
    }
    const calls: Record<string, string> = {
      "模组": "TheFrontEnd:PushScreen(ModsScreen(...))",
      "选项": "MainScreen:DoOptionsMenu()",
      "退出": "网页展示不会真正关闭游戏",
      "论坛": "MainScreen:Forums() · Hamlet community forum",
    }
    setNotice(calls[action])
  }

  const toggleMusic = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      void audio.play().catch(() => setMusicPlaying(false))
    } else {
      audio.pause()
    }
  }

  return (
    <main className={styles.page}>
      <audio
        ref={audioRef}
        src={assetUrl("audio/hamlet-theme.wav")}
        preload="auto"
        autoPlay
        loop
        onPlaying={() => setMusicPlaying(true)}
        onPause={() => setMusicPlaying(false)}
      />
      <div className={styles.gameViewport} ref={viewportRef}>
        <AtlasSprite assetRoot={ASSET_ROOT} atlas="ui" sprite="bg_plain.tex" className={styles.gameBackground} tint={HAMLET_GREEN} />
        <div className={styles.paperNoise} />
        <canvas className={styles.animationCanvas} ref={canvasRef} aria-label="Hamlet 标题与城镇猪动画" />
        <div className={styles.watermark}>猪镇抢先体验 · 测试分支 · 正在开发中</div>
        <div className={styles.updateBanner}>
          <AtlasSprite assetRoot={ASSET_ROOT} atlas="ui" sprite="update_banner.tex" />
          <span>由死亡来定义冒险</span>
        </div>
        <section className={styles.motd} aria-label="Don't Starve: Elsewhere">
          <AtlasSprite assetRoot={ASSET_ROOT} atlas="globalpanels" sprite="panel.tex" />
          <img src={elsewhereKeyArt} alt="Don't Starve: Elsewhere" />
        </section>
        <nav className={styles.menu} aria-label="Hamlet 主菜单">
          {["开始游戏！", "模组", "选项", "退出"].map((label, index) => (
            <HamletButton key={label} label={label} focused={index === 0} onClick={() => runAction(label)} />
          ))}
        </nav>
        <div className={styles.forum}><HamletButton label="论坛" onClick={() => runAction("论坛")} /></div>
        <button
          className={`${styles.musicButton} ${musicPlaying ? styles.musicButtonPlaying : ""}`}
          type="button"
          onClick={toggleMusic}
          aria-label={musicPlaying ? "暂停 Hamlet 音乐" : "播放 Hamlet 音乐"}
          aria-pressed={musicPlaying}
        >
          <span aria-hidden="true">♫</span>{musicPlaying ? "音乐播放中" : "开启音乐"}
        </button>
        <div className={styles.runtime}>{notice}</div>
        {loading && <div className={styles.loading}><i /><span>LOADING DLC0003 ANIMATION ASSETS</span></div>}
        {error && <div className={styles.loading}><b>资源载入失败</b><span>{error}</span></div>}
      </div>
    </main>
  )
}
