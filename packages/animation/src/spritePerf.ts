/** Opt-in sprite timing: ?perf aggregates; ?perf=trace also emits User Timing entries. */
export interface SpritePerfRecord { phase: string; key: string; ms: number; at: number }
interface SpritePerfSummary { count: number; total: number; max: number }

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : undefined;
const enabled = params?.has('perf') ?? false;
const trace = params?.get('perf') === 'trace';
const MAX_RECORDS = 4096;
const records: SpritePerfRecord[] = [];
const summaries = new Map<string, SpritePerfSummary>();
let nextRecord = 0;
let generation = 0;
const noop = () => {};

if (enabled) (globalThis as { __spritePerf?: unknown }).__spritePerf = {
  // Chronological bounded snapshot; summary counts include the entire interval since clear().
  get records() { return [...records.slice(nextRecord), ...records.slice(0, nextRecord)].sort((a, b) => a.at - b.at); },
  summary: () => Object.fromEntries([...summaries].map(([phase, summary]) => [phase, { ...summary }])),
  clear: () => { generation++; records.length = 0; nextRecord = 0; summaries.clear(); },
};

function record(phase: string, key: string, start: number, capture: number): void {
  if (capture !== generation) return;
  const ms = performance.now() - start;
  let summary = summaries.get(phase);
  if (!summary) summaries.set(phase, summary = { count: 0, total: 0, max: 0 });
  summary.count++; summary.total += ms; summary.max = Math.max(summary.max, ms);
  // Keep preparation details and slow frames; sample routine manager renders to avoid recording every frame.
  if (phase !== 'render' || ms > 4 || summary.count % 60 === 0 || trace) {
    records[nextRecord] = { phase, key, ms, at: start };
    nextRecord = (nextRecord + 1) % MAX_RECORDS;
  }
  if (trace) performance.measure(`sprite:${phase}`, { start, duration: ms, detail: key });
}

export function spritePerf<T>(phase: string, key: string, run: () => T): T {
  if (!enabled) return run();
  const start = performance.now(), capture = generation;
  try { return run(); } finally { record(phase, key, start, capture); }
}

export async function spritePerfAsync<T>(phase: string, key: string, run: () => Promise<T>): Promise<T> {
  if (!enabled) return run();
  const start = performance.now(), capture = generation;
  try { return await run(); } finally { record(phase, key, start, capture); }
}

/** A manual span for generator steps; ending it still records work when the caller exits exceptionally. */
export function spritePerfSpan(phase: string, key: string): () => void {
  if (!enabled) return noop;
  const start = performance.now(), capture = generation;
  return () => record(phase, key, start, capture);
}
