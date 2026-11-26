import { closeSync, openSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const pollMs = 500;
const samplingInterval = 32 * 1024;
const measurements = ['usedSize', 'totalSize', 'backingStorageSize', 'embedderHeapUsedSize'];

function allocationSites(profile, root) {
  const sites = new Map();
  const visit = node => {
    if (node.selfSize) {
      const { functionName, url, lineNumber, columnNumber } = node.callFrame;
      const path = URL.canParse(url) ? new URL(url).pathname.replace(`/@fs${root}`, '') : url;
      const location = path && lineNumber >= 0 ? `${path}:${lineNumber + 1}:${columnNumber + 1}` : path;
      const site = `${functionName || '(anonymous)'}${location ? ` (${location})` : ''}`;
      sites.set(site, (sites.get(site) ?? 0) + node.selfSize);
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(profile.head);
  return [...sites].map(([site, bytes]) => ({ site, bytes })).sort((a, b) => b.bytes - a.bytes);
}

export async function writeHeapSnapshot(session, path) {
  const fd = openSync(path, 'wx');
  let writeError;
  const addChunk = ({ chunk }) => {
    if (!writeError) {
      try {
        writeFileSync(fd, chunk);
      } catch (error) {
        writeError = error;
      }
    }
  };
  session.on('HeapProfiler.addHeapSnapshotChunk', addChunk);
  try {
    await session.send('HeapProfiler.takeHeapSnapshot');
    if (writeError) {
      throw writeError;
    }
  } finally {
    session.off('HeapProfiler.addHeapSnapshotChunk', addChunk);
    closeSync(fd);
  }
}

/** Profile only the page target's isolate. Worker targets and GPU allocations are outside its heap. */
export async function profileMainThreadHeap({ page, start, loaded, settle, path, root }) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('HeapProfiler.startSampling', { samplingInterval });
    const started = performance.now();
    const timeline = [];
    const read = async phase => {
      const usage = await session.send('Runtime.getHeapUsage');
      const sample = { ms: Math.round(performance.now() - started), phase, ...usage };
      timeline.push(sample);
      return sample;
    };
    const baseline = await read('baseline');
    let phase = 'loading';
    let pending, pollError;
    const timer = setInterval(() => {
      if (!pending && !pollError) {
        pending = read(phase)
          .catch(error => {
            pollError = error;
          })
          .finally(() => {
            pending = undefined;
          });
      }
    }, pollMs);
    let load;
    try {
      await start();
      await loaded();
      phase = 'settling';
      load = await read('loaded');
      await delay(settle);
    } finally {
      clearInterval(timer);
      await pending;
    }
    if (pollError) {
      throw pollError;
    }
    const beforeGc = await read('beforeGc');
    const gameSamples = timeline.slice(1);
    const peaks = Object.fromEntries(
      measurements.map(metric => {
        const peak = gameSamples.reduce((best, point) => (point[metric] > best[metric] ? point : best));
        return [metric, { bytes: peak[metric], ms: peak.ms, phase: peak.phase }];
      }),
    );
    await session.send('HeapProfiler.collectGarbage');
    const afterGc = await read('afterGc');
    const { profile } = await session.send('HeapProfiler.stopSampling');
    const sites = allocationSites(profile, root);
    if (!sites.length) {
      throw new Error('Chrome returned no live heap allocation samples');
    }
    writeFileSync(path, JSON.stringify(profile));
    return {
      profile: basename(path),
      pollMs,
      samplingInterval,
      sampleCount: profile.samples.length,
      baseline,
      load,
      beforeGc,
      afterGc,
      peaks,
      sites,
      timeline,
    };
  } finally {
    await session.detach();
  }
}
