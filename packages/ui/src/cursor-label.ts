import { loadBitmapFont, type BitmapFont } from '@dontstarve-web/animation/bitmapFont';
import type { CursorLabel } from '@dontstarve-web/prefab/buildCursor';
import styles from './styles/cursor-label.css?inline';

export interface CursorPointer {
  readonly hasPointer: boolean;
  readonly pointerClientX: number;
  readonly pointerClientY: number;
  readonly isOverGround: boolean;
}

interface Action {
  pointer: CursorPointer;
  text: string;
  button: 'left' | 'right';
}

/** DOM overlay drawn after the world, outside lighting and seasonal grading. */
export class CursorLabelUi {
  readonly element = document.createElement('div');
  readonly ready: Promise<void>;
  private readonly canvas: HTMLCanvasElement;
  private readonly text: HTMLSpanElement;
  private readonly gameCanvas: HTMLCanvasElement;
  private readonly actions = new Map<object, Action>();
  private handAction?: Action;
  private font?: BitmapFont;
  private drawnButton?: 'left' | 'right';

  constructor(gameCanvas: HTMLCanvasElement, fontUrl: string, target: ParentNode = document.body) {
    this.gameCanvas = gameCanvas;
    this.element.className = 'cursor-label-ui';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.hidden = true;
    const shadow = this.element.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${styles}</style><div class="label"><canvas class="button"></canvas><span></span></div>`;
    this.canvas = shadow.querySelector('canvas')!;
    this.text = shadow.querySelector('span')!;
    target.appendChild(this.element);
    this.ready = loadBitmapFont(fontUrl).then((font) => { this.font = font; this.update(); });
    void this.ready.catch((error: unknown) => console.error('Unable to load cursor font', error));
  }

  createLabel(pointer: CursorPointer): CursorLabel {
    const key = {};
    return {
      show: (text, button = 'left') => {
        this.actions.delete(key);
        this.actions.set(key, { text, button, pointer });
        this.update();
      },
      hide: () => { this.actions.delete(key); this.update(); },
      update: () => this.update(),
    };
  }

  setHandAction(text: string | null, pointer: CursorPointer): void {
    this.handAction = text === null ? undefined : { text, pointer, button: 'right' };
    this.update();
  }

  update(): void {
    const actions = [...this.actions.values()];
    const action = actions.at(-1) ?? this.handAction;
    const pointer = action?.pointer;
    const visible = !!pointer?.hasPointer && pointer.isOverGround
      && document.elementFromPoint(pointer.pointerClientX, pointer.pointerClientY) === this.gameCanvas;
    this.element.hidden = !visible;
    if (!visible || !action) return;
    this.element.style.left = `${pointer.pointerClientX}px`;
    this.element.style.top = `${pointer.pointerClientY}px`;
    this.text.textContent = action.text;
    if (this.font && this.drawnButton !== action.button) {
      this.font.drawGlyph(this.canvas, action.button === 'right' ? 0xe101 : 0xe100);
      this.canvas.dataset.glyph = action.button === 'right' ? 'U+E101' : 'U+E100';
      this.drawnButton = action.button;
    }
    this.canvas.hidden = !this.font;
  }

  dispose(): void {
    this.actions.clear();
    this.handAction = undefined;
    this.element.remove();
  }
}
