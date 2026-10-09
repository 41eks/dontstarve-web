import { loadBitmapFont, type BitmapFont } from '@dontstarve-web/animation/bitmapFont';
import { getActionString, type PlayerActionPicker, type ActionDescription } from '@dontstarve-web/stategraphs';
import type { CursorLabel } from '@dontstarve-web/prefab/buildCursor';
import styles from './styles/cursor-label.css?inline';

export interface CursorPointer {
  readonly hasPointer: boolean;
  readonly pointerClientX: number;
  readonly pointerClientY: number;
  readonly isOverGround: boolean;
}
interface Tooltip { pointer: CursorPointer; text: string; button: 'left' | 'right'; }
interface Row { element: HTMLDivElement; canvas: HTMLCanvasElement; text: HTMLSpanElement; drawnButton?: string; }

/** widgets/hoverer.lua: tooltip override, otherwise the selected LMB/RMB action strings. */
export class CursorLabelUi {
  readonly element = document.createElement('div');
  readonly ready: Promise<void>;
  private readonly rows: readonly Row[];
  private readonly gameCanvas: HTMLCanvasElement;
  private readonly tooltips = new Map<object, Tooltip>();
  private handAction?: { pointer: CursorPointer; action: ActionDescription };
  private unregisterHand?: () => void;
  private picker?: PlayerActionPicker;
  private font?: BitmapFont;
  private disposed = false;

  constructor(gameCanvas: HTMLCanvasElement, fontUrl: string, target: ParentNode = document.body) {
    this.gameCanvas = gameCanvas;
    this.element.className = 'cursor-label-ui';
    this.element.setAttribute('aria-hidden', 'true');
    this.element.hidden = true;
    const shadow = this.element.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${styles}</style><div class="label" data-role="primary"><canvas class="button"></canvas><span></span></div><div class="label" data-role="secondary"><canvas class="button"></canvas><span></span></div>`;
    this.rows = [...shadow.querySelectorAll<HTMLDivElement>('.label')].map(element => ({
      element, canvas: element.querySelector('canvas')!, text: element.querySelector('span')!,
    }));
    target.appendChild(this.element);
    this.ready = loadBitmapFont(fontUrl).then(font => { this.font = font; this.update(); });
    void this.ready.catch((error: unknown) => console.error('Unable to load cursor font', error));
  }

  setMouseActions(picker: PlayerActionPicker): void {
    this.unregisterHand?.();
    this.picker = picker;
    this.unregisterHand = picker.register(() => this.handAction?.pointer.isOverGround
      ? [{ action: this.handAction.action, button: 'right' }] : []);
    this.update();
  }

  /** Explicit HUD/placement tooltips take precedence over world action prompts. */
  createLabel(pointer: CursorPointer): CursorLabel {
    const key = {};
    return {
      show: (text, button = 'left') => {
        this.tooltips.delete(key);
        this.tooltips.set(key, { text, button, pointer });
        this.update();
      },
      hide: () => { this.tooltips.delete(key); this.update(); },
      update: () => this.update(),
    };
  }

  setHandAction(action: ActionDescription | null, pointer: CursorPointer): void {
    this.handAction = action === null ? undefined : { action, pointer };
    this.update();
  }

  private primaryText(action: ActionDescription): string {
    const name = !action.invobject && action.target?.getDisplayName?.();
    return getActionString(action) + (name ? ` ${name}` : '');
  }

  update(): void {
    if (this.disposed) return;
    const tooltip = [...this.tooltips.values()].at(-1);
    const actions = tooltip ? undefined : this.picker?.getMouseActions();
    const pointer = tooltip?.pointer ?? this.picker?.pointer ?? this.handAction?.pointer;
    const hand = !tooltip && !this.picker && this.handAction?.pointer.isOverGround ? this.handAction : undefined;
    const hasText = tooltip ? tooltip.pointer.isOverGround : !!actions?.left || !!actions?.right || !!hand;
    const visible = hasText && !!pointer?.hasPointer
      && document.elementFromPoint(pointer.pointerClientX, pointer.pointerClientY) === this.gameCanvas;
    this.element.hidden = !visible;
    if (!visible || !pointer) return;
    if (tooltip) {
      this.setRow(this.rows[0], tooltip.text, tooltip.button);
      this.setRow(this.rows[1]);
    } else {
      // Pair each action with its source controller glyph; retain the secondary ': ' prefix.
      this.setRow(this.rows[0], actions?.left ? this.primaryText(actions.left) : undefined, 'left');
      const secondary = actions?.right ?? hand?.action;
      this.setRow(this.rows[1], secondary ? `: ${getActionString(secondary)}` : undefined, 'right');
    }
    this.element.style.left = `${pointer.pointerClientX}px`;
    this.element.style.top = `${pointer.pointerClientY}px`;
    const rect = this.element.getBoundingClientRect();
    const dx = rect.left < 10 ? 10 - rect.left : rect.right > window.innerWidth - 10 ? window.innerWidth - 10 - rect.right : 0;
    const dy = rect.top < 10 ? 10 - rect.top : rect.bottom > window.innerHeight - 10 ? window.innerHeight - 10 - rect.bottom : 0;
    this.element.style.left = `${pointer.pointerClientX + dx}px`;
    this.element.style.top = `${pointer.pointerClientY + dy}px`;
  }

  private setRow(row: Row, text?: string, button?: 'left' | 'right'): void {
    row.element.hidden = text === undefined;
    if (row.text.textContent !== (text ?? '')) row.text.textContent = text ?? '';
    if (text === undefined) { row.canvas.hidden = true; return; }
    if (button) row.element.dataset.button = button; else delete row.element.dataset.button;
    if (this.font && button && row.drawnButton !== button) {
      this.font.drawGlyph(row.canvas, button === 'right' ? 0xe101 : 0xe100);
      row.canvas.dataset.glyph = button === 'right' ? 'U+E101' : 'U+E100';
      row.drawnButton = button;
    }
    row.canvas.hidden = !this.font || !button;
  }

  dispose(): void {
    this.disposed = true;
    this.tooltips.clear();
    this.unregisterHand?.();
    this.handAction = undefined;
    this.element.remove();
  }
}
