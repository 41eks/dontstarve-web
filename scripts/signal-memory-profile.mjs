import { writeHeapSnapshot } from './main-thread-heap-profile.mjs';

export async function installSignalMemoryProbe(page) {
  await page.addInitScript(() => {
    const widths = { plain: 1, watched: 1, memo: 1, lazy: 1 };
    const references = { plain: [], watched: [], memo: [], lazy: [] };
    globalThis.__signalMemoryProbe = (kind, ...members) => {
      if (members.length !== widths[kind]) {
        throw new Error(`Unexpected signal probe registration for ${kind}`);
      }
      for (const member of members) {
        references[kind].push(new WeakRef(member));
      }
    };
    globalThis.__countLiveSignals = () => {
      const count = kind => {
        const refs = references[kind];
        const width = widths[kind];
        let alive = 0;
        for (let i = 0; i < refs.length; i += width) {
          for (let j = i; j < i + width; j++) {
            if (refs[j].deref()) {
              alive++;
              break;
            }
          }
        }
        return alive;
      };
      let lazyDeclared = 0;
      let lazyUndeclared = 0;
      for (const ref of references.lazy) {
        const lazy = ref.deref();
        if (lazy?.declared) {
          lazyDeclared++;
        } else if (lazy) {
          lazyUndeclared++;
        }
      }
      // A declared LazySignal owns an ordinary backing signal in addition to its public API; a memo holds its own value.
      return {
        plain: count('plain') - lazyDeclared,
        watched: count('watched'),
        memo: count('memo'),
        lazyDeclared,
        lazyUndeclared,
      };
    };
  });
}

export async function countLiveSignals(page) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('HeapProfiler.collectGarbage');
    const counts = await page.evaluate(() => globalThis.__countLiveSignals());
    if (Object.values(counts).some(count => !Number.isSafeInteger(count) || count < 0) || !counts.plain) {
      throw new Error('Invalid live signal counts from the fixture');
    }
    return counts;
  } finally {
    await session.detach();
  }
}

export async function captureSignalCalibration(page, { baseUrl, signalUrl, lazyUrl, snapshotPath }) {
  const url = baseUrl + '/signal-memory-calibration';
  await page.route(url, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto(url);
  await page.evaluate(
    async ({ signalUrl, lazyUrl }) => {
      const { createSignal, createMemo, watchSignal } = await import(signalUrl);
      const { LazySignal } = await import(lazyUrl);
      const stop = () => {};
      const source = { get: () => 0, value: 0 };
      // Populate enough instances for V8 to settle the object layout used by the factories.
      globalThis.__signalCalibration = Array.from({ length: 256 }, () => {
        const declared = new LazySignal(0);
        declared.get();
        return [createSignal(0), watchSignal(source, stop), createMemo(source.get), declared, new LazySignal(0)];
      });
    },
    { signalUrl, lazyUrl },
  );
  const session = await page.context().newCDPSession(page);
  try {
    await writeHeapSnapshot(session, snapshotPath);
  } finally {
    await session.detach();
  }
}

export function summarizeSignalMemory(counts, calibration, sites) {
  const kinds = {};
  let count = 0;
  let estimatedBytes = 0;
  for (const [kind, live] of Object.entries(counts)) {
    const sample = calibration.kinds[kind];
    if (sample?.count !== 256 || !(sample.p50Bytes > 0)) {
      throw new Error(`Unexpected signal calibration for ${kind}`);
    }
    const representativeBytes = sample.p50Bytes;
    kinds[kind] = { count: live, representativeBytes, estimatedBytes: live * representativeBytes };
    count += live;
    estimatedBytes += kinds[kind].estimatedBytes;
  }
  // The uninstrumented game profile gives an independent estimate of direct allocations in the signal implementation.
  const sampledModuleBytes = sites
    .filter(({ site }) => /\bpackages\/signals\/src\/(?:lazySignal|signal)\.(?:js|ts):\d/.test(site))
    .reduce((sum, { bytes }) => sum + bytes, 0);
  return { total: { count, estimatedBytes }, kinds, sampledModuleBytes };
}
