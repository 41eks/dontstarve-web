/** Opt-in timing for first-use sprite preparation. Enable with `?perf` in the URL; read `window.__spritePerf`. */
export interface SpritePerfRecord { phase: string; key: string; ms: number; at: number }

const enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf');
const records: SpritePerfRecord[] = [];
if (enabled) (globalThis as { __spritePerf?: unknown }).__spritePerf = {
  records,
  summary: () => {
    const byPhase = new Map<string, { count: number; total: number; max: number }>();
    for (const r of records) {
      const s = byPhase.get(r.phase) ?? { count: 0, total: 0, max: 0 };
      s.count++; s.total += r.ms; s.max = Math.max(s.max, r.ms); byPhase.set(r.phase, s);
    }
    return Object.fromEntries(byPhase);
  },
  clear: () => { records.length = 0; },
};

export function spritePerf<T>(phase: string, key: string, run: () => T): T {
  if (!enabled) return run();
  const start = performance.now();
  try { return run(); } finally {
    const ms = performance.now() - start;
    records.push({ phase, key, ms, at: start });
    performance.measure(`sprite:${phase}`, { start, duration: ms, detail: key });
    if (ms > 4) console.warn(`[spritePerf] ${phase} ${ms.toFixed(1)}ms ${key}`);
  }
}

export async function spritePerfAsync<T>(phase: string, key: string, run: () => Promise<T>): Promise<T> {
  if (!enabled) return run();
  const start = performance.now();
  try { return await run(); } finally {
    const ms = performance.now() - start;
    records.push({ phase, key, ms, at: start });
    performance.measure(`sprite:${phase}`, { start, duration: ms, detail: key });
  }
}

/** Starts a manual span for code that cannot be wrapped in a callback, such as a block between generator yields. */
export function spritePerfSpan(phase: string, key: string): () => void {
  if (!enabled) return () => {};
  const start = performance.now();
  return () => {
    const ms = performance.now() - start;
    records.push({ phase, key, ms, at: start });
    performance.measure(`sprite:${phase}`, { start, duration: ms, detail: key });
  };
}
