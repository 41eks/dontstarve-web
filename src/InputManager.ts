import { createMemo, createSignal, readonlySignal } from '@dontstarve-web/signals';
import type { PlayerController } from '@dontstarve-web/stategraphs';

const movementKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'] as const;
const supportedKeys = new Set<string>([...movementKeys, 'ShiftLeft', 'Space']);
const isKey = (code: string): code is Key => supportedKeys.has(code);

export class InputManager {
  private readonly keysState = createSignal<ReadonlySet<Key>>(new Set());
  readonly keys = readonlySignal(this.keysState);
  isPressed = (code: Key) => this.keys.get().has(code);
  readonly isManualMovement = createMemo(() => {
    const keys = this.keys.get();
    return movementKeys.some(key => keys.has(key));
  });
  readonly isActionInterrupting = createMemo(() => this.isManualMovement() || this.isPressed('Space'));
  private blocked = false;
  private disposed = false;
  private readonly target = window;

  constructor() {
    this.target.addEventListener('keydown', this.handleKeyDown);
    this.target.addEventListener('keyup', this.handleKeyUp);
    this.target.addEventListener('blur', this.clearKeys);
  }

  setBlocked(blocked: boolean): void {
    if (this.disposed) {
      return;
    }
    this.blocked = blocked;
    this.clearKeys();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.target.removeEventListener('keydown', this.handleKeyDown);
    this.target.removeEventListener('keyup', this.handleKeyUp);
    this.target.removeEventListener('blur', this.clearKeys);
    this.clearKeys();
    this.isActionInterrupting.dispose();
    this.isManualMovement.dispose();
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    const key = event.code;
    if (this.blocked || !isKey(key) || event.composedPath().some(isTextInput)) {
      return;
    }
    const keys = this.keysState.peek();
    if (keys.has(key)) {
      return;
    }
    this.keysState.set(new Set([...keys, key]));
  };

  private readonly handleKeyUp = (event: KeyboardEvent) => {
    const key = event.code;
    const keys = this.keysState.peek();
    if (!isKey(key) || !keys.has(key)) {
      return;
    }
    const next = new Set(keys);
    next.delete(key);
    this.keysState.set(next);
  };

  private readonly clearKeys = () => {
    if (this.keysState.peek().size) {
      this.keysState.set(new Set());
    }
  };
}

export const input = new InputManager();

/** UI elements receive their own DOM events. Only an unconsumed canvas press goes to the world. */
export function bindWorldControls(
  canvas: HTMLCanvasElement,
  controller: Pick<PlayerController, 'OnControl'>,
): () => void {
  const pointerDown = (event: PointerEvent): void => {
    if (event.defaultPrevented || (event.button !== 0 && event.button !== 2)) {
      return;
    }
    const { clientX, clientY, altKey } = event;
    if (controller.OnControl(event.button === 0 ? 'PRIMARY' : 'SECONDARY', { clientX, clientY, altKey })) {
      event.preventDefault();
    }
  };
  canvas.addEventListener('pointerdown', pointerDown);
  return () => canvas.removeEventListener('pointerdown', pointerDown);
}

export type Key = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'ShiftLeft' | 'Space';

function isTextInput(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
