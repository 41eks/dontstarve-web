import { afterEach, expect, it, vi } from 'vitest';

interface PerfView {
  records: { phase: string; key: string; ms: number; at: number }[];
  summary(): Record<string, { count: number; total: number; max: number }>;
  clear(): void;
}

async function load(search: string) {
  vi.resetModules();
  vi.stubGlobal('location', { search });
  vi.stubGlobal('__spritePerf', undefined);
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => ++now);
  const measure = vi.spyOn(performance, 'measure');
  const methods = await import('../src/spritePerf');
  const view = (globalThis as { __spritePerf?: PerfView }).__spritePerf;
  return { ...methods, measure, view };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('aggregates routine render calls without User Timing or unbounded frame records, and resets the complete capture interval', async () => {
  const { spritePerf, spritePerfAsync, spritePerfSpan, view, measure } = await load('?perf');
  for (let i = 0; i < 120; i++) expect(spritePerf('render', 'trees', () => i)).toBe(i);
  await spritePerfAsync('preload', 'build', async () => 'loaded');
  spritePerfSpan('resolve', 'clip')();
  expect(view!.summary()).toEqual({ render: { count: 120, total: 120, max: 1 },
    preload: { count: 1, total: 1, max: 1 }, resolve: { count: 1, total: 1, max: 1 } });
  expect(view!.records.map(record => record.phase)).toEqual(['render', 'render', 'preload', 'resolve']);
  expect(measure).not.toHaveBeenCalled();
  const snapshot = view!.summary(); snapshot.render.count = 0;
  expect(view!.summary().render.count).toBe(120);
  view!.clear(); expect(view!.records).toEqual([]); expect(view!.summary()).toEqual({});
  let finish!: () => void;
  const loading = spritePerfAsync('preload', 'old capture', () => new Promise<void>(resolve => { finish = resolve; }));
  const span = spritePerfSpan('resolve', 'old capture');
  view!.clear(); finish(); await loading; span();
  expect(view!.records).toEqual([]); expect(view!.summary()).toEqual({});
});

it('bounds detailed preparation records while retaining aggregate totals and chronological order', async () => {
  const { spritePerf, view } = await load('?perf');
  for (let i = 0; i < 5000; i++) spritePerf('resolve', `${i}`, () => {});
  expect(view!.records).toHaveLength(4096);
  expect(view!.records[0].key).toBe('904'); expect(view!.records.at(-1)!.key).toBe('4999');
  expect(view!.summary().resolve).toEqual({ count: 5000, total: 5000, max: 1 });
});

it('emits explicit trace events and records failed calls without changing their error', async () => {
  const { spritePerf, view, measure } = await load('?perf=trace');
  const error = new Error('render failed');
  expect(() => spritePerf('render', 'trees', () => { throw error; })).toThrow(error);
  expect(measure).toHaveBeenCalledWith('sprite:render', { start: 1, duration: 1, detail: 'trees' });
  expect(view!.records).toHaveLength(1);
  expect(view!.summary().render.count).toBe(1);
});
