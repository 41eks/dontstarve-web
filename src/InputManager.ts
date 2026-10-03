// src/InputManager.ts

export class InputManager {
    keys = new Set<Key>();
    private blocked = false;

    constructor() {
        window.addEventListener('keydown', (e) => {
            if (this.blocked || e.composedPath().some(isTextInput)) return;
            this.keys.add(e.code as Key)
        });
        window.addEventListener('keyup', (e) => this.keys.delete(e.code as Key));
        window.addEventListener('blur', () => this.keys.clear());
    }

    isPressed = (code:Key) => {
        return this.keys.has(code);
    }

    setBlocked(blocked: boolean): void {
        this.blocked = blocked;
        this.keys.clear();
    }
}



export const input = new InputManager();

export type Key = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'ShiftLeft'| 'Space';

function isTextInput(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable);
}
