// src/InputManager.ts

export class InputManager {
    keys = new Set<Key>();

    constructor() {
        window.addEventListener('keydown', (e) => {
            if (isTextInput(e.target)) return;
            this.keys.add(e.code as Key)
        });
        window.addEventListener('keyup', (e) => this.keys.delete(e.code as Key));
        window.addEventListener('blur', () => this.keys.clear());
    }

    isPressed = (code:Key) => {
        return this.keys.has(code);
    }
}



export const input = new InputManager();

export type Key = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD' | 'ShiftLeft'| 'Space';

function isTextInput(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable);
}
