import { createMemo, createSignal, readonlySignal } from '@dontstarve-web/signals';

const movementKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'] as const;
const supportedKeys = new Set<string>([...movementKeys, 'ShiftLeft', 'Space']);

export class InputManager {
    private readonly keysState = createSignal<ReadonlySet<Key>>(new Set());
    readonly keys = readonlySignal(this.keysState);
    isPressed = (code: Key) => this.keys.get().has(code);
    readonly isManualMovement = createMemo(() => {
        const keys = this.keys.get();
        return movementKeys.some(key => keys.has(key));
    });
    readonly isActionInterrupting = createMemo(() =>
        this.isManualMovement() || this.isPressed('Space'));
    private blocked = false;
    private disposed = false;
    private readonly target = window;

    constructor() {
        this.target.addEventListener('keydown', this.handleKeyDown);
        this.target.addEventListener('keyup', this.handleKeyUp);
        this.target.addEventListener('blur', this.clearKeys);
    }

    setBlocked(blocked: boolean): void {
        if (this.disposed) return;
        this.blocked = blocked;
        this.clearKeys();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.target.removeEventListener('keydown', this.handleKeyDown);
        this.target.removeEventListener('keyup', this.handleKeyUp);
        this.target.removeEventListener('blur', this.clearKeys);
        this.clearKeys();
        this.isActionInterrupting.dispose();
        this.isManualMovement.dispose();
    }

    private readonly handleKeyDown = (event: KeyboardEvent) => {
        if (this.blocked || !supportedKeys.has(event.code) || event.composedPath().some(isTextInput)) return;
        const key = event.code as Key;
        const keys = this.keysState.peek();
        if (keys.has(key)) return;
        this.keysState.set(new Set([...keys, key]));
    };

    private readonly handleKeyUp = (event: KeyboardEvent) => {
        const key = event.code as Key;
        const keys = this.keysState.peek();
        if (!keys.has(key)) return;
        const next = new Set(keys);
        next.delete(key);
        this.keysState.set(next);
    };

    private readonly clearKeys = () => {
        if (this.keysState.peek().size) this.keysState.set(new Set());
    };
}

export const input = new InputManager();

export type Key = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'ShiftLeft' | 'Space';

function isTextInput(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable);
}
