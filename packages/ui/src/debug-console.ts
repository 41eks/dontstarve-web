import { loadImageAtlas } from '@three-roaming/wilson/imageAtlas';
import { AssetElement } from './assets';
import styles from './styles/debug-console.css?inline';

const CONSOLE_ATLAS = 'images/textboxes.xml';
const CONSOLE_BACKGROUND = 'textbox_long.tex';
const MAX_HISTORY = 50;

export interface DebugCommandDetail {
  command: string;
}

export class DstDebugConsoleElement extends AssetElement {
  private readonly history: string[] = [];
  private historyIndex = 0;
  private initialized = false;
  private opened = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get isOpen(): boolean {
    return this.opened;
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this.handleGlobalKeyDown, { capture: true });
  }

  disconnectedCallback(): void {
    window.removeEventListener('keydown', this.handleGlobalKeyDown, { capture: true });
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.historyIndex = this.history.length;
    const consoleElement = this.requireConsole();
    consoleElement.hidden = false;
    consoleElement.setAttribute('aria-hidden', 'false');
    const input = this.requireInput();
    input.value = '';
    requestAnimationFrame(() => input.focus());
    this.dispatchToggle();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    const consoleElement = this.requireConsole();
    consoleElement.hidden = true;
    consoleElement.setAttribute('aria-hidden', 'true');
    this.requireInput().blur();
    this.dispatchToggle();
  }

  protected render(): void {
    if (this.initialized) {
      void this.renderBackground();
      return;
    }
    this.initialized = true;

    this.shadowRoot!.innerHTML = `
      <style>${styles}</style>
      <section class="debug-console" aria-label="调试控制台" aria-hidden="true" hidden>
        <canvas class="debug-console__background" aria-hidden="true"></canvas>
        <form class="debug-console__form" autocomplete="off">
          <label class="debug-console__label" for="debug-command">调试命令</label>
          <input
            id="debug-command"
            class="debug-console__input"
            name="command"
            type="text"
            aria-label="调试命令"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />
        </form>
      </section>
    `;

    this.shadowRoot!
      .querySelector<HTMLFormElement>('.debug-console__form')!
      .addEventListener('submit', this.handleSubmit);
    this.requireInput().addEventListener('keydown', this.handleInputKeyDown);
    void this.renderBackground();
  }

  private readonly handleGlobalKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Backquote' || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (this.opened) this.close();
    else this.open();
  };

  private readonly handleInputKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    if (event.key === 'ArrowUp') {
      this.historyIndex = Math.max(0, this.historyIndex - 1);
    } else {
      this.historyIndex = Math.min(this.history.length, this.historyIndex + 1);
    }
    this.requireInput().value = this.history[this.historyIndex] ?? '';
  };

  private readonly handleSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    const command = this.requireInput().value.trim();
    if (!command) return;

    if (this.history.at(-1) !== command) {
      this.history.push(command);
      if (this.history.length > MAX_HISTORY) this.history.shift();
    }
    this.historyIndex = this.history.length;
    this.dispatchEvent(new CustomEvent<DebugCommandDetail>('game:debug-command', {
      bubbles: true,
      composed: true,
      detail: { command },
    }));
    this.close();
  };

  private dispatchToggle(): void {
    this.dispatchEvent(new CustomEvent('game:debug-console-toggle', {
      bubbles: true,
      composed: true,
      detail: { isOpen: this.opened },
    }));
  }

  private requireConsole(): HTMLElement {
    return this.shadowRoot!.querySelector<HTMLElement>('.debug-console')!;
  }

  private requireInput(): HTMLInputElement {
    return this.shadowRoot!.querySelector<HTMLInputElement>('.debug-console__input')!;
  }

  private async renderBackground(): Promise<void> {
    const canvas = this.shadowRoot!.querySelector<HTMLCanvasElement>('.debug-console__background');
    if (!canvas) return;
    canvas.dataset.archive = this.dataAsset('databundles/images.zip');
    canvas.dataset.atlas = CONSOLE_ATLAS;
    canvas.dataset.element = CONSOLE_BACKGROUND;
    delete canvas.dataset.loaded;
    delete canvas.dataset.error;

    try {
      const atlas = await loadImageAtlas(canvas.dataset.archive, CONSOLE_ATLAS);
      if (!canvas.isConnected) return;
      const sprite = atlas.require(CONSOLE_BACKGROUND);
      canvas.width = sprite.width;
      canvas.height = sprite.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D context is unavailable');
      context.putImageData(
        new ImageData(Uint8ClampedArray.from(sprite.pixels), sprite.width, sprite.height),
        0,
        0,
      );
      canvas.dataset.loaded = 'true';
    } catch (error: unknown) {
      canvas.dataset.error = error instanceof Error ? error.message : String(error);
    }
  }
}
