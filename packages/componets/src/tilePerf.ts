/**
 * Diagnostic timing for tile activity changes, enabled with `?tileperf` in the page URL (or `globalThis.__tilePerf = true`).
 * It only logs: no state is read or written, and it does nothing when disabled.
 */
const enabled = (): boolean => {
  const flag = (globalThis as { __tilePerf?: boolean }).__tilePerf;
  if (flag !== undefined) return flag;
  try { return typeof location !== 'undefined' && new URLSearchParams(location.search).has('tileperf'); } catch { return false; }
};

let observing = false;
function observeLongTasks(): void {
  if (observing || typeof PerformanceObserver === 'undefined') return;
  observing = true;
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) console.info(`[tileperf] longtask ${entry.duration.toFixed(1)}ms at ${entry.startTime.toFixed(0)}ms`);
    }).observe({ entryTypes: ['longtask'] });
  } catch { /* longtask is not supported in every browser */ }
}

/** Marks an event such as a teleport on the same clock as the long-task log. */
export function tilePerfMark(label: string): void {
  if (!enabled()) return;
  observeLongTasks();
  console.info(`[tileperf] ${label} at ${performance.now().toFixed(0)}ms`);
}

/**
 * Times a synchronous tile-grid write, then the effects it queued (next microtask checkpoint) and everything that
 * follows from them (next macrotask), so the cost of subscribers is separated from the write itself.
 */
export function tilePerfMeasure<T>(label: string, detail: () => string, fn: () => T): T {
  if (!enabled()) return fn();
  observeLongTasks();
  const start = performance.now();
  const result = fn();
  const written = performance.now();
  queueMicrotask(() => {
    const microtasks = performance.now();
    setTimeout(() => {
      const end = performance.now();
      console.info(`[tileperf] ${label} ${detail()} write=${(written - start).toFixed(1)}ms effects>=${(microtasks - written).toFixed(1)}ms total-to-macrotask=${(end - written).toFixed(1)}ms`);
    }, 0);
  });
  return result;
}
