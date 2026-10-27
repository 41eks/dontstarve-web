import type { WebGLRenderer } from 'three';

/**
 * Development-only stats-gl panel, shown by default; `?stats=gpu` also tracks GPU time. Callers create it only under
 * `import.meta.env.DEV`, and the library is loaded on demand, so it never reaches a production bundle. The returned
 * handle is inert until it has loaded.
 */
export function createDebugStats(renderer: WebGLRenderer) {
    const mode = new URLSearchParams(location.search).get('stats');
    let stats: import('stats-gl').default | undefined;
    let disposed = false;
    void import('stats-gl').then(({ default: Stats }) => {
        if (disposed) return;
        stats = new Stats({ trackGPU: mode === 'gpu' });
        stats.dom.dataset.debugStats = '';
        document.body.append(stats.dom);
        stats.init(renderer);
    });
    return {
        update(): void { stats?.update(); },
        dispose(): void {
            disposed = true;
            stats?.dom.remove();
            stats = undefined;
        },
    };
}
