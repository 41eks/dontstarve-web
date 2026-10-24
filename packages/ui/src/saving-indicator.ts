import { AssetElement } from './assets';
import { AnimatedBackground } from './animated-background';
import styles from './styles/saving-indicator.css?inline';

type SavingStage = 'hidden' | 'pre' | 'loop' | 'post';

/** savingindicator.lua: saving bank/build, save_pre → save_loop → save_post. */
export class DstSavingIndicatorElement extends AssetElement {
  private background?: AnimatedBackground;
  private activeSaves = 0;
  private stage: SavingStage = 'hidden';
  private textTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  startSave(): void {
    this.activeSaves++;
    if (this.stage === 'pre' || this.stage === 'loop') return;
    this.startAnimation();
  }

  endSave(): void {
    this.activeSaves = Math.max(0, this.activeSaves - 1);
    if (this.activeSaves > 0) return;
    this.hideText();
    // Let the intro and one loop finish even when JSON export completes before
    // the browser's next paint. The outro then plays without delaying download.
  }

  async whileSaving<T>(save: () => T | Promise<T>): Promise<T> {
    this.startSave();
    try {
      return await save();
    } finally {
      this.endSave();
    }
  }

  disconnectedCallback(): void {
    this.hideText();
    this.background?.dispose();
    this.background = undefined;
    this.activeSaves = 0;
    this.stage = 'hidden';
  }

  protected render(): void {
    const wasVisible = this.stage !== 'hidden';
    this.hideText();
    this.background?.dispose();
    this.shadowRoot!.innerHTML = `
      <style>${styles}</style>
      <section class="saving-indicator" role="status" aria-live="polite" hidden>
        <canvas aria-hidden="true"></canvas>
        <span class="saving-indicator__text" hidden>正在保存…</span>
      </section>
    `;
    const panel = this.panel;
    this.background = new AnimatedBackground(
      this.shadowRoot!.querySelector('canvas')!, this.dataAsset('anim/saving.zip'),
      ({ width, height }) => {
        // The source widget applies a 0.5 scale to the animation.
        panel.style.width = `${width * 0.5}px`;
        panel.style.height = `${height * 0.5}px`;
      },
    );
    this.setStage('hidden');
    if (wasVisible || this.activeSaves > 0) this.startAnimation();
  }

  private get panel(): HTMLElement {
    return this.shadowRoot!.querySelector<HTMLElement>('.saving-indicator')!;
  }

  private setStage(stage: SavingStage): void {
    this.stage = stage;
    this.panel.dataset.state = stage;
    this.panel.hidden = stage === 'hidden';
  }

  private startAnimation(): void {
    this.hideText();
    this.setStage('pre');
    this.textTimer = setTimeout(() => {
      this.textTimer = undefined;
      if (this.activeSaves > 0) this.shadowRoot!.querySelector<HTMLElement>('.saving-indicator__text')!.hidden = false;
    }, 500);
    this.background?.playOnce('save_pre', () => this.playLoop());
  }

  private playLoop(): void {
    this.setStage('loop');
    this.background?.playOnce('save_loop', () => {
      if (this.activeSaves > 0) this.playLoop();
      else {
        this.hideText();
        this.setStage('post');
        this.background?.playOnce('save_post', () => this.setStage('hidden'));
      }
    });
  }

  private hideText(): void {
    if (this.textTimer !== undefined) clearTimeout(this.textTimer);
    this.textTimer = undefined;
    const text = this.shadowRoot!.querySelector<HTMLElement>('.saving-indicator__text');
    if (text) text.hidden = true;
  }
}
