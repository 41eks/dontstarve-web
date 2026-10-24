/** Development-only presentation, sampled by the existing render loop. */
export function createDebugFpsDisplay() {
    const display = document.createElement('output');
    display.dataset.debugFps = '';
    display.setAttribute('aria-label', '帧率');
    display.textContent = 'FPS —';
    Object.assign(display.style, {
        position: 'fixed', top: '12px', left: '12px', zIndex: '10000',
        padding: '4px 8px', borderRadius: '4px', background: 'rgba(0, 0, 0, 0.7)',
        color: '#fff', font: '12px/1.4 monospace', fontVariantNumeric: 'tabular-nums',
        pointerEvents: 'none', userSelect: 'none',
    });
    document.body.append(display);
    let sampleStart: number | undefined;
    let frames = 0;
    const reset = () => { sampleStart = undefined; frames = 0; display.textContent = 'FPS —'; };
    document.addEventListener('visibilitychange', reset);
    return {
        update(timestamp: number): void {
            if (sampleStart === undefined) { sampleStart = timestamp; return; }
            frames++;
            const elapsed = timestamp - sampleStart;
            if (elapsed < 500) return;
            display.textContent = `FPS ${Math.round(frames * 1000 / elapsed)}`;
            sampleStart = timestamp;
            frames = 0;
        },
        dispose(): void {
            document.removeEventListener('visibilitychange', reset);
            display.remove();
        },
    };
}
