import { loadImageAtlasFiles } from '@three-roaming/animation/imageAtlas';
import { WILSON_EMOTES, type EmoteGroup, type WilsonEmote } from '@three-roaming/prefab/emotes';
import { AssetElement } from './assets';
import styles from './styles/emote-wheel.css?inline';

export interface EmoteRequestDetail { emote: WilsonEmote }
export interface EmoteWheelToggleDetail { isOpen: boolean }
interface WheelItem { label: string; icon: WilsonEmote; group?: EmoteGroup; emote?: WilsonEmote }

const GROUPS: readonly WheelItem[] = [
  { label: '情绪', icon: 'wave', group: 'emotion' },
  { label: '动作', icon: 'pose', group: 'action' },
];

/** WheelItem.EmoteItem + Wheel: clockwise icons, focus labels and nested datasets. */
export class DstEmoteWheelElement extends AssetElement {
  private initialized = false;
  private opened = false;
  private group: EmoteGroup | null = null;
  private selected = -1;
  private items: readonly WheelItem[] = GROUPS;
  private iconRequest = 0;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get isOpen(): boolean { return this.opened; }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this.handleKeyDown, true);
    window.addEventListener('blur', this.close);
    window.addEventListener('game:debug-console-toggle', this.handleConsoleToggle);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  disconnectedCallback(): void {
    this.close();
    window.removeEventListener('keydown', this.handleKeyDown, true);
    window.removeEventListener('blur', this.close);
    window.removeEventListener('game:debug-console-toggle', this.handleConsoleToggle);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.setGroup(null);
    this.overlay.hidden = false;
    this.overlay.focus({ preventScroll: true });
    this.emit('game:emote-wheel-toggle', { isOpen: true });
  }

  readonly close = (): void => {
    if (!this.opened) return;
    this.opened = false;
    this.overlay.hidden = true;
    (this.shadowRoot!.activeElement as HTMLElement | null)?.blur();
    this.emit('game:emote-wheel-toggle', { isOpen: false });
  };

  protected render(): void {
    if (!this.initialized) {
      this.initialized = true;
      this.shadowRoot!.innerHTML = `
        <style>${styles}</style>
        <section class="emote-overlay" role="dialog" aria-modal="true" aria-label="表情轮盘" tabindex="-1" hidden>
          <div class="emote-wheel">
            <div class="emote-wheel__items"></div>
            <div class="emote-wheel__center">
              <span class="emote-wheel__title">表情</span>
              <span class="emote-wheel__label" aria-live="polite">选择分类</span>
              <button class="emote-wheel__back" type="button" hidden>返回分类</button>
            </div>
          </div>
          <p class="emote-wheel__help">鼠标选择 · 左键确认 · G / Esc / 右键关闭</p>
        </section>`;
      this.overlay.addEventListener('pointermove', this.handlePointerMove);
      this.overlay.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.button === 2) this.close();
      });
      this.overlay.addEventListener('click', (event) => {
        event.stopPropagation();
        if (event.composedPath().some((node) => node instanceof HTMLElement && node.classList.contains('emote-wheel__back'))) {
          this.setGroup(null);
          return;
        }
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-index]');
        if (button) this.select(Number(button.dataset.index));
        this.executeSelection();
      });
      this.overlay.addEventListener('contextmenu', (event) => { event.preventDefault(); event.stopPropagation(); });
      this.overlay.addEventListener('wheel', (event) => { event.preventDefault(); event.stopPropagation(); }, { passive: false });
      this.setGroup(null);
    } else {
      void this.renderIcons();
    }
  }

  private get overlay(): HTMLElement { return this.shadowRoot!.querySelector<HTMLElement>('.emote-overlay')!; }

  private setGroup(group: EmoteGroup | null): void {
    this.group = group;
    this.items = group === null ? GROUPS : (Object.keys(WILSON_EMOTES) as WilsonEmote[])
      .filter((id) => WILSON_EMOTES[id].group === group)
      .map((id) => ({ label: WILSON_EMOTES[id].label, icon: id, emote: id }));
    const container = this.shadowRoot!.querySelector<HTMLElement>('.emote-wheel__items')!;
    container.replaceChildren(...this.items.map((item, index) => {
      const angle = index * Math.PI * 2 / this.items.length;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'emote-wheel__item';
      button.dataset.index = String(index);
      if (item.emote) button.dataset.emote = item.emote;
      if (item.group) button.dataset.group = item.group;
      button.setAttribute('aria-label', item.label);
      button.setAttribute('aria-pressed', 'false');
      button.style.left = `${50 + Math.sin(angle) * 38}%`;
      button.style.top = `${50 - Math.cos(angle) * 38}%`;
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      canvas.dataset.element = `gesture_wilson_${item.icon}.tex`;
      const text = document.createElement('span');
      text.textContent = item.label;
      button.append(canvas, text);
      button.addEventListener('pointerenter', () => this.select(index));
      button.addEventListener('focus', () => this.select(index));
      return button;
    }));
    this.shadowRoot!.querySelector<HTMLElement>('.emote-wheel__back')!.hidden = group === null;
    this.selected = -1;
    this.select(-1);
    void this.renderIcons();
  }

  private select(index: number): void {
    this.selected = index;
    this.shadowRoot!.querySelectorAll<HTMLButtonElement>('[data-index]').forEach((button, i) => {
      button.classList.toggle('is-selected', index === i);
      button.setAttribute('aria-pressed', String(index === i));
    });
    this.shadowRoot!.querySelector<HTMLElement>('.emote-wheel__label')!.textContent = this.items[index]?.label
      ?? (this.group === null ? '选择分类' : this.group === 'emotion' ? '情绪' : '动作');
  }

  private executeSelection(): void {
    const item = this.items[this.selected];
    if (!item) return;
    if (item.group) {
      this.setGroup(item.group);
    } else if (item.emote) {
      this.close();
      this.emit<EmoteRequestDetail>('game:emote-request', { emote: item.emote });
    }
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const bounds = this.shadowRoot!.querySelector<HTMLElement>('.emote-wheel')!.getBoundingClientRect();
    const x = event.clientX - bounds.left - bounds.width / 2;
    const y = event.clientY - bounds.top - bounds.height / 2;
    const distance = Math.hypot(x, y);
    if (distance < bounds.width * 0.16 || distance > bounds.width * 0.56) {
      this.select(-1);
      return;
    }
    const angle = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2);
    this.select(Math.round(angle * this.items.length / (Math.PI * 2)) % this.items.length);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    // KeyboardEvent.target is retargeted to a host for inputs inside shadow DOM.
    if (event.composedPath().some((node) => node instanceof HTMLInputElement
      || node instanceof HTMLTextAreaElement || (node instanceof HTMLElement && node.isContentEditable))) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    if (event.code === 'KeyG' || (this.opened && event.code === 'Escape')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (this.opened) this.close();
      else this.open();
    }
  };

  private readonly handleConsoleToggle = (event: Event): void => {
    if ((event as CustomEvent<{ isOpen: boolean }>).detail.isOpen) this.close();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) this.close();
  };

  private emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
  }

  private async renderIcons(): Promise<void> {
    const request = ++this.iconRequest;
    const canvases = [...this.shadowRoot!.querySelectorAll<HTMLCanvasElement>('[data-element]')];
    const url = this.dataAsset('images/emotes_wilson.xml');
    try {
      const atlas = await loadImageAtlasFiles(url);
      if (request !== this.iconRequest || !this.isConnected) return;
      for (const canvas of canvases) {
        const sprite = atlas.require(canvas.dataset.element!);
        canvas.width = sprite.width;
        canvas.height = sprite.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas 2D context is unavailable');
        context.putImageData(new ImageData(Uint8ClampedArray.from(sprite.pixels), sprite.width, sprite.height), 0, 0);
        canvas.dataset.loaded = 'true';
      }
    } catch (error) {
      if (request !== this.iconRequest) return;
      for (const canvas of canvases) canvas.dataset.error = error instanceof Error ? error.message : String(error);
    }
  }
}
