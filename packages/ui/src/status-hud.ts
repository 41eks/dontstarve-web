import { AssetElement } from './assets';
import { WorldClock } from './world-clock';
import { StatusDisplays, loadStatusArt, type StatusArt } from './badge/status-displays';
import type { Badge } from './badge/badge';
import type { BadgeOwner } from './badge/owner';
import styles from './styles/status-hud.css?inline';
import { proportionalHudScale } from './hud-scale';
import { createEffect, createSignal } from '@dontstarve-web/signals';

export type { BadgeOwner, StatDeltaData } from './badge/owner';

// controls.lua: topright_root → sidepanel(-80, -60) → clock(0, 0) and StatusDisplays(0, -110);
// statusdisplays.lua: stomach (column2 -40, 20), heart (column4 40, 20), brain (column3 0, -40). Lua +y is up.
const SIDEPANEL = { x: -80, y: -60 };
const STATUS = { x: SIDEPANEL.x, y: SIDEPANEL.y - 110 };
type BadgeName = 'brain' | 'stomach' | 'heart';
/** Each badge canvas is a square `size` UI units wide, centred on the badge. */
const BADGES: Record<BadgeName, { x: number; y: number; size: number; label: string }> = {
  brain: { x: STATUS.x, y: STATUS.y - 40, size: 150, label: '精神值' },
  stomach: { x: STATUS.x - 40, y: STATUS.y + 20, size: 100, label: '饱食度' },
  heart: { x: STATUS.x + 40, y: STATUS.y + 20, size: 130, label: '生命值' },
};
// StatusDisplays adds brain, stomach, heart in that order, and is added to the sidepanel before the clock.
const BADGE_ORDER: BadgeName[] = ['brain', 'stomach', 'heart'];
/** WorldClock draws in a 182×144 unit canvas whose centre sits 20 units left of the clock's. */
const CLOCK = { x: SIDEPANEL.x - 20, y: SIDEPANEL.y, width: 182, height: 144 };
const BADGE_RADIUS = 34;

/** The vanilla top-right HUD: UIClock above StatusDisplays' sanity, hunger and health badges. */
export class DstStatusHudElement extends AssetElement {
  private clock?: WorldClock;
  private owner?: BadgeOwner;
  private status?: StatusDisplays;
  private art?: Promise<StatusArt>;
  private observer?: ResizeObserver;
  private readonly canvases = new Map<BadgeName, HTMLCanvasElement>();
  private readonly hits = new Map<BadgeName, HTMLElement>();
  /** Bumped when layout resizes (and so clears) the badge canvases. */
  private readonly canvasLayout = createSignal(0);
  private stopBadges: (() => void)[] = [];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  disconnectedCallback(): void {
    this.dispose();
  }

  dispose(): void {
    this.clock?.dispose();
    this.clock = undefined;
    this.disposeStatus();
    this.observer?.disconnect();
    this.observer = undefined;
  }

  /** The HUD's owner: StatusDisplays listens to its stat events and the badges read its components. */
  setOwner(owner: BadgeOwner | undefined): void {
    this.owner = owner;
    this.disposeStatus();
    const art = this.art;
    if (!owner || !art) {
      return;
    }
    void art.then(loaded => {
      if (this.owner === owner && this.art === art && !this.status) {
        this.status = new StatusDisplays(loaded, owner);
        this.bindBadges(this.status);
        this.shadowRoot!.querySelector('.survival-hud')!.setAttribute('data-state', 'ready');
      }
    });
  }

  /** Only active game frames advance the HUD's animation (dont_update_while_paused), never clock progress. */
  advanceAnimation(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) {
      return;
    }
    this.clock?.advanceAnimation(dt);
    if (this.status) {
      this.status.advance(dt * 1000);
    }
  }

  private badge(name: BadgeName): Badge | undefined {
    return this.status?.[name];
  }

  private disposeStatus(): void {
    this.stopBadges.splice(0).forEach(stop => stop());
    this.status?.dispose();
    this.status = undefined;
  }

  /**
   * Each badge's canvas repaints in an effect that reads the badge's signals, so it reruns only when the picture
   * changes (a new animation frame, percent, tint, warning or focus) or layout resizes the canvas, not every frame.
   */
  private bindBadges(status: StatusDisplays): void {
    for (const name of BADGE_ORDER) {
      const badge = status[name];
      const canvas = this.canvases.get(name)!;
      const hit = this.hits.get(name)!;
      this.stopBadges.push(
        createEffect(() => {
          this.canvasLayout.get();
          const context = canvas.getContext('2d')!;
          const pixels = canvas.width / BADGES[name].size;
          context.resetTransform();
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.setTransform(pixels, 0, 0, pixels, canvas.width / 2, canvas.height / 2);
          badge.draw(context);
          canvas.dataset.arrow = badge.arrow;
          canvas.dataset.warning = badge.warningVisible ? 'on' : 'off';
        }),
        createEffect(() => {
          hit.setAttribute('aria-label', `${BADGES[name].label} ${badge.numberSignal.get()}`);
        }),
      );
    }
  }

  /** SCALEMODE_PROPORTIONAL with SetMaxPropUpscale(MAX_HUD_SCALE), positioned from the top-right anchor. */
  private layout(): void {
    const root = this.shadowRoot!.querySelector<HTMLElement>('.survival-hud')!;
    const width = root.clientWidth,
      height = root.clientHeight;
    const k = proportionalHudScale(width, height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const place = (element: HTMLElement, x: number, y: number, w: number, h: number) => {
      element.style.left = `${width + x * k - (w * k) / 2}px`;
      element.style.top = `${-y * k - (h * k) / 2}px`;
      element.style.width = `${w * k}px`;
      element.style.height = `${h * k}px`;
    };
    place(root.querySelector<HTMLElement>('.world-clock')!, CLOCK.x, CLOCK.y, CLOCK.width, CLOCK.height);
    for (const name of BADGE_ORDER) {
      const { x, y, size } = BADGES[name];
      const canvas = this.canvases.get(name)!;
      place(canvas, x, y, size, size);
      canvas.width = canvas.height = Math.max(1, Math.round(size * k * ratio));
      place(this.hits.get(name)!, x, y, BADGE_RADIUS * 2, BADGE_RADIUS * 2);
    }
    this.canvasLayout.set(this.canvasLayout.value + 1);
  }

  protected render(): void {
    this.dispose();
    const root = this.shadowRoot!;
    const canvases = BADGE_ORDER.map(
      name => `<canvas class="status-badge status-badge--${name}" aria-hidden="true"></canvas>`,
    ).join('');
    const hits = BADGE_ORDER.map(
      name => `<div class="status-badge__hit status-badge__hit--${name}" role="img" tabindex="0"></div>`,
    ).join('');
    root.innerHTML = `
      <style>${styles}</style>
      <section class="survival-hud" aria-label="生存状态" data-state="loading">
        ${canvases}
        <div class="world-clock" role="img" tabindex="0">
          <canvas class="world-clock__animation" aria-hidden="true"></canvas>
        </div>
        ${hits}
      </section>
    `;
    this.canvases.clear();
    this.hits.clear();
    for (const name of BADGE_ORDER) {
      this.canvases.set(name, root.querySelector<HTMLCanvasElement>(`.status-badge--${name}`)!);
      const hit = root.querySelector<HTMLElement>(`.status-badge__hit--${name}`)!;
      this.hits.set(name, hit);
      // Badge:OnGainFocus / OnLoseFocus show and hide the number.
      const focus = (focused: boolean) => () => {
        const badge = this.badge(name);
        if (badge) {
          badge.focused = focused;
        }
      };
      hit.addEventListener('mouseenter', focus(true));
      hit.addEventListener('mouseleave', focus(false));
      hit.addEventListener('focus', focus(true));
      hit.addEventListener('blur', focus(false));
    }
    this.clock = new WorldClock(root.querySelector<HTMLCanvasElement>('.world-clock__animation')!, this.dataAsset(''));
    const art = loadStatusArt(this.dataAsset('anim'));
    this.art = art;
    art.catch((error: unknown) => {
      if (this.art === art) {
        const hud = root.querySelector('.survival-hud')!;
        hud.setAttribute('data-state', 'error');
        hud.setAttribute('data-error', error instanceof Error ? error.message : String(error));
      }
    });
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(root.querySelector('.survival-hud')!);
    this.setOwner(this.owner);
  }
}
