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

  isBlocked(): boolean {
    return this.blocked;
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
  let primaryPointer: number | undefined;
  const releasePrimary = (): void => {
    if (primaryPointer !== undefined) {
      primaryPointer = undefined;
      controller.OnControl('PRIMARY', false);
    }
  };
  const pointerDown = (event: PointerEvent): void => {
    if (event.defaultPrevented || input.isBlocked() || (event.button !== 0 && event.button !== 2)) {
      return;
    }
    const { button, clientX, clientY, altKey } = event;
    if (controller.OnControl(button === 0 ? 'PRIMARY' : 'SECONDARY', true, { clientX, clientY, altKey })) {
      if (button === 0) {
        primaryPointer = event.pointerId;
      }
      event.preventDefault();
    }
  };
  const pointerEnd = (event: PointerEvent): void => {
    if (event.pointerId === primaryPointer) {
      releasePrimary();
    }
  };
  const pointerMove = (event: PointerEvent): void => {
    // A mouse can release the primary button while a secondary button is still down.
    if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
      pointerEnd(event);
    }
  };
  const pointerOut = (event: PointerEvent): void => {
    if (event.relatedTarget === null && event.pointerType === 'mouse') {
      pointerEnd(event);
    }
  };
  canvas.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointerup', pointerEnd, true);
  window.addEventListener('pointercancel', pointerEnd, true);
  window.addEventListener('pointermove', pointerMove, true);
  window.addEventListener('pointerout', pointerOut, true);
  window.addEventListener('blur', releasePrimary);
  return () => {
    canvas.removeEventListener('pointerdown', pointerDown);
    window.removeEventListener('pointerup', pointerEnd, true);
    window.removeEventListener('pointercancel', pointerEnd, true);
    window.removeEventListener('pointermove', pointerMove, true);
    window.removeEventListener('pointerout', pointerOut, true);
    window.removeEventListener('blur', releasePrimary);
    releasePrimary();
  };
}

export type Key = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'ShiftLeft' | 'Space';

function isTextInput(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
