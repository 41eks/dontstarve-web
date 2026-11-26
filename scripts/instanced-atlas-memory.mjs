#!/usr/bin/env node
/**
 * GPU memory of the instanced sprite pass while a save loads and once it runs, plus scene frame timing after load.
 *
 *     node scripts/instanced-atlas-memory.mjs
 *     node scripts/instanced-atlas-memory.mjs --save Cluster_1/Caves.json --top 40
 *     node scripts/instanced-atlas-memory.mjs --save Cluster_1/Master.json --save Cluster_1/Caves.json \
 *       --report analysis/instanced-mesh-vram.md
 *     node scripts/instanced-atlas-memory.mjs --json > instanced-memory.json
 *
 * Options:
 *   --save <path>    a save below public/saves; repeat to measure several (default: the active session, like the game)
 *   --top <n>        appearances to list, largest first (default 25; 0 lists all)
 *   --settle <ms>    time to keep running after the game has loaded (default 15000: unused appearances are released
 *                    after 10 s, see InstancedSpriteAtlases.releaseUnused)
 *   --port <n>       port of the vite test server this script starts (default 4199)
 *   --report <file>  also write a Markdown report (environment, timeline peaks, appearances, builds)
 *   --json           print the whole measurement as JSON instead of tables
 *   --headed         show the browser
 *   --hardware       use Chromium with EGL hardware acceleration on Linux
 *   --trace-dir DIR  record 5 seconds of Chrome trace with JS samples per save, after the measurement
 *   --heap-profile-dir DIR  profile the main-thread heap in a separate browser run per save
 *   --heap-settle <ms>      time after load before GC in the heap run (default 40000, for delayed atlas releases)
 *
 * What it measures. Appearances are decided at runtime (bank, build, clip, symbol overrides, hidden symbols), so the
 * script loads the real game in headless Chromium rather than estimating from the art. Before the game modules load
 * it wraps InstancedSpriteAtlases (every appearance, and after each compose step and release the bytes of all composed
 * pages, giving a timeline and its peak) and InstancedArchiveSprites (the entities each appearance is shown or drawn
 * for). After settling it reads every appearance's pages (RGBA8, 4 bytes per texel) and the InstancedBufferAttributes
 * of the scene's batches. Per appearance it also estimates a part-instanced alternative: one table row of 48 bytes
 * (matrix, UV rectangle, page) per drawn part per frame, from the frames it resolved while composing.
 *
 * After load, the script timestamps returned scene render calls during the settle window. On Linux it samples the
 * browser's GPU and renderer process RSS from /proc every 500 ms. With SwiftShader, GPU-process RSS includes textures
 * held in system memory. With hardware acceleration, RSS and WebGL atlas allocation estimates describe different
 * memory measurements.
 *
 * Once settled it requests a Chrome memory-infra dump and splits the renderer process by allocator: the main V8 heap,
 * ArrayBuffer backing stores (`partition_alloc/partitions/array_buffer`, including freed space not yet returned),
 * Blink's buffer partition, decoded images (`cc/image_memory`), 2D canvases, malloc and shared memory. The renderer
 * process also runs the workers, so their heaps count there.
 *
 * Composing a page also takes a half-float accumulation target (8 bytes per texel) for that page only; the largest is
 * reported as the transient peak. The "世界生成中" page's OffscreenCanvas worker is stubbed out: a GPU process crash
 * while it renders takes the tab down, which would end the measurement instead of reporting it.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { profileMainThreadHeap } from './main-thread-heap-profile.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const uiDir = `${root}packages/ui`;
const fsUrl = path => `/@fs${root}${path}`;
const requireUi = createRequire(`${uiDir}/package.json`);
const gameCanvas = 'canvas[data-game-canvas][data-loaded="true"]';
const USAGE =
  'node scripts/instanced-atlas-memory.mjs [--save Cluster_1/Master.json]... [--top 25] [--settle 15000] ' +
  '[--port 4199] [--report FILE.md] [--json] [--headed] [--hardware] [--trace-dir DIR] ' +
  '[--heap-profile-dir DIR] [--heap-settle 40000]';

function parseArgs(argv) {
  const options = {
    saves: [],
    top: 25,
    settle: 15_000,
    port: 4199,
    report: undefined,
    json: false,
    headed: false,
    hardware: false,
    traceDir: undefined,
    heapProfileDir: undefined,
    heapSettle: 40_000,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined) {
        throw new Error(`${arg} needs a value`);
      }
      return next;
    };
    if (arg === '--save') {
      options.saves.push(value());
    } else if (arg === '--top') {
      options.top = Number(value());
    } else if (arg === '--settle') {
      options.settle = Number(value());
    } else if (arg === '--port') {
      options.port = Number(value());
    } else if (arg === '--report') {
      options.report = value();
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--headed') {
      options.headed = true;
    } else if (arg === '--hardware') {
      options.hardware = true;
    } else if (arg === '--trace-dir') {
      options.traceDir = value();
    } else if (arg === '--heap-profile-dir') {
      options.heapProfileDir = value();
    } else if (arg === '--heap-settle') {
      options.heapSettle = Number(value());
      if (!Number.isInteger(options.heapSettle) || options.heapSettle < 0) {
        throw new Error('--heap-settle needs a non-negative integer in milliseconds');
      }
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option ${arg}`);
    }
  }
  if (!options.saves.length) {
    options.saves.push(undefined);
  }
  return options;
}

/** Starts the UI package's vite test server on `port` and resolves once it serves the test page. */
async function startServer(port) {
  const vite = spawn(
    `${uiDir}/node_modules/.bin/vite`,
    ['--config', 'vite.test.config.ts', '--port', String(port), '--strictPort'],
    { cwd: uiDir, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  vite.stdout.on('data', chunk => (output += chunk));
  vite.stderr.on('data', chunk => (output += chunk));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (vite.exitCode !== null) {
      throw new Error(`vite exited (${vite.exitCode}):\n${output}`);
    }
    try {
      const response = await fetch(`${url}/tests/fixture.html`);
      if (response.ok) {
        return { url, stop: () => vite.kill() };
      }
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      vite.kill();
      throw new Error(`vite did not start on ${url}:\n${output}`);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

const MB = 1024 * 1024;
const mb = bytes => (bytes / MB).toFixed(1);
const size = bytes => (bytes >= MB ? `${mb(bytes)} MB` : `${(bytes / 1024).toFixed(1)} KB`);
const seconds = ms => `${(ms / 1000).toFixed(1)} s`;
const HEAP_METRICS = [
  ['usedSize', 'V8 已用堆'],
  ['totalSize', 'V8 已分配堆'],
  ['backingStorageSize', 'ArrayBuffer 与外部字符串后备存储'],
  ['embedderHeapUsedSize', 'Blink 已用 GC 堆'],
];

/** Chromium processes below this node process, by `--type` (the browser itself is "browser"), with their RSS. */
function chromiumProcesses() {
  if (process.platform !== 'linux') {
    return undefined;
  }
  const parents = new Map(),
    info = new Map();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) {
      continue;
    }
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      // The command name may hold spaces and parentheses: fields start after the last ")".
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const pid = Number(name);
      parents.set(pid, Number(fields[1]));
      const cmdline = readFileSync(`/proc/${name}/cmdline`, 'utf8');
      const rss = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${name}/status`, 'utf8'));
      info.set(pid, { cmdline, rssBytes: rss ? Number(rss[1]) * 1024 : 0 });
    } catch {
      // Exited while reading.
    }
  }
  const byType = {};
  for (const [pid, { cmdline, rssBytes }] of info) {
    let ancestor = parents.get(pid);
    while (ancestor && ancestor !== process.pid) {
      ancestor = parents.get(ancestor);
    }
    if (ancestor !== process.pid || !/chrom/i.test(cmdline)) {
      continue;
    }
    const type = /--type=([a-z-]+)/.exec(cmdline)?.[1] ?? 'browser';
    byType[type] = (byType[type] ?? 0) + rssBytes;
  }
  return byType;
}

/** Samples the Chromium processes every `interval` ms until stopped; returns the timeline and per-type peaks. */
function sampleProcesses(started, interval = 500) {
  const timeline = [],
    peaks = {};
  const sample = () => {
    const byType = chromiumProcesses();
    if (!byType) {
      return;
    }
    timeline.push({ ms: Date.now() - started, ...byType });
    for (const [type, bytes] of Object.entries(byType)) {
      if (!peaks[type] || bytes > peaks[type].bytes) {
        peaks[type] = { bytes, ms: Date.now() - started };
      }
    }
  };
  const timer = setInterval(sample, interval);
  sample();
  return {
    stop() {
      clearInterval(timer);
      sample();
      return { timeline, peaks, final: timeline.at(-1) };
    },
  };
}

async function recordChromeTrace(browser, page, path) {
  const session = await browser.newBrowserCDPSession();
  try {
    await session.send('Tracing.start', {
      transferMode: 'ReturnAsStream',
      streamFormat: 'json',
      streamCompression: 'gzip',
      traceConfig: {
        recordMode: 'recordUntilFull',
        includedCategories: [
          'toplevel',
          'devtools.timeline',
          'blink.user_timing',
          'disabled-by-default-devtools.timeline',
          'disabled-by-default-devtools.timeline.frame',
          'disabled-by-default-v8.cpu_profiler',
          'v8',
          'cc',
          'viz',
          'gpu',
        ],
      },
    });
    // Starting the V8 sampler can stall the renderer on a loaded world.
    await page.waitForFunction(
      async () => {
        await new Promise(requestAnimationFrame);
        return true;
      },
      undefined,
      { timeout: 15_000 },
    );
    await page.evaluate(() => performance.mark('instanced-atlas-profile-start'));
    await delay(5000);
    await page.evaluate(() => {
      performance.mark('instanced-atlas-profile-end');
      performance.measure(
        'Instanced atlas frame profile',
        'instanced-atlas-profile-start',
        'instanced-atlas-profile-end',
      );
    });
    const [[{ stream, dataLossOccurred }]] = await Promise.all([
      once(session, 'Tracing.tracingComplete', { signal: AbortSignal.timeout(30_000) }),
      session.send('Tracing.end'),
    ]);
    if (!stream) {
      throw new Error('Chrome returned no trace stream');
    }
    try {
      if (dataLossOccurred) {
        throw new Error('Chrome lost events during tracing');
      }
      const chunks = [];
      for (;;) {
        const { data, base64Encoded, eof } = await session.send('IO.read', { handle: stream, size: 1024 ** 2 });
        chunks.push(Buffer.from(data, base64Encoded ? 'base64' : 'utf8'));
        if (eof) {
          break;
        }
      }
      writeFileSync(path, Buffer.concat(chunks));
    } finally {
      await session.send('IO.close', { handle: stream });
    }
  } finally {
    await session.detach();
  }
}

/** Renderer allocators reported by memory-infra, in this order; the size is what each allocator holds from the OS. */
const RENDERER_ALLOCATORS = [
  ['v8/main/heap', 'V8 主线程堆'],
  ['v8/workers', 'V8 worker 堆'],
  ['partition_alloc/partitions/array_buffer', 'ArrayBuffer 分区'],
  ['partition_alloc/partitions/buffer', 'Blink buffer 分区'],
  ['partition_alloc/partitions/fast_malloc', 'Blink fast_malloc 分区'],
  ['partition_alloc/partitions/layout', 'Blink layout 分区'],
  ['cc/image_memory', '已解码图片（cc）'],
  ['canvas', '2D canvas'],
  ['malloc', 'malloc'],
  ['shared_memory', '共享内存'],
  ['gpu', 'GPU 客户端'],
  ['web_cache', 'Blink 资源缓存'],
  ['blink_gc', 'Blink GC 堆'],
];

/** After a full GC, a detailed memory-infra dump of the renderer process: its private footprint and RENDERER_ALLOCATORS. */
async function rendererAllocators(browser, page) {
  // Garbage left by loading would hide what is retained.
  const pageSession = await page.context().newCDPSession(page);
  await pageSession.send('HeapProfiler.collectGarbage');
  await pageSession.detach();
  const session = await browser.newBrowserCDPSession();
  try {
    const events = [];
    session.on('Tracing.dataCollected', ({ value }) => events.push(...value));
    await session.send('Tracing.start', {
      transferMode: 'ReportEvents',
      traceConfig: { includedCategories: ['disabled-by-default-memory-infra'], memoryDumpConfig: { triggers: [] } },
    });
    const { success } = await session.send('Tracing.requestMemoryDump', {
      deterministic: true,
      levelOfDetail: 'detailed',
    });
    const done = once(session, 'Tracing.tracingComplete', { signal: AbortSignal.timeout(30_000) });
    await session.send('Tracing.end');
    await done;
    if (!success) {
      throw new Error('Chrome did not complete the memory dump');
    }
    const renderers = new Set(
      events
        .filter(event => event.ph === 'M' && event.name === 'process_name' && event.args?.name === 'Renderer')
        .map(event => event.pid),
    );
    const allocators = {},
      totals = {};
    for (const event of events) {
      if (event.ph === 'v' && renderers.has(event.pid)) {
        for (const [path, value] of Object.entries(event.args.dumps.allocators ?? {})) {
          allocators[path] = value;
        }
        for (const [name, value] of Object.entries(event.args.dumps.process_totals ?? {})) {
          totals[name] = value;
        }
      }
    }
    const hex = value => (typeof value === 'string' ? parseInt(value, 16) : 0);
    return {
      privateFootprint: hex(totals.private_footprint_bytes),
      allocators: RENDERER_ALLOCATORS.map(([path, name]) => ({
        path,
        name,
        bytes: hex(allocators[path]?.attrs?.size?.value),
      })),
    };
  } finally {
    await session.detach();
  }
}

function launchBrowser(options) {
  const { chromium } = requireUi('@playwright/test');
  return chromium.launch({
    headless: !options.headed,
    ...(options.hardware && {
      channel: 'chromium',
      env: { ...process.env, EGL_PLATFORM: 'surfaceless' },
      args: [
        '--enable-gpu',
        '--ignore-gpu-blocklist',
        '--disable-software-rasterizer',
        '--use-gl=angle',
        '--use-angle=gles-egl',
      ],
    }),
  });
}

async function openGameFixture(page, save, baseUrl) {
  await page.route(/stage\.worker\.ts/, route =>
    route.fulfill({ contentType: 'text/javascript', body: 'self.onmessage = () {};' }),
  );
  const query = save ? `?save=${encodeURIComponent(save)}` : '';
  await page.goto(`${baseUrl}/tests/dst-lighting.html${query}`);
}

async function startGame(page) {
  await page.evaluate(async bootstrapUrl => {
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    await import(bootstrapUrl);
  }, fsUrl('src/bootstrap.tsx'));
}

function watchGameProblems(page) {
  const problems = [];
  page.on('crash', () => problems.push('page crashed'));
  page.on('pageerror', error => problems.push(`page error: ${error.message}`));
  page.on('console', message => {
    if (/context lost|Unable to start/i.test(message.text())) {
      problems.push(`console: ${message.text()}`);
    }
  });
  return problems;
}

async function measureHeap(options, save, baseUrl, path) {
  const browser = await launchBrowser(options);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const problems = watchGameProblems(page);
    await openGameFixture(page, save, baseUrl);
    const heap = await profileMainThreadHeap({
      page,
      start: () => startGame(page),
      loaded: () => page.locator(gameCanvas).waitFor({ timeout: 600_000 }),
      settle: options.heapSettle,
      path,
      root,
    });
    if (problems.length) {
      throw new Error(problems.join('; '));
    }
    return heap;
  } finally {
    await browser.close();
  }
}

async function measure(options, save, baseUrl, tracePath) {
  const browser = await launchBrowser(options);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const problems = watchGameProblems(page);
    await openGameFixture(page, save, baseUrl);
    const started = Date.now();
    const processes = sampleProcesses(started);
    await page.evaluate(
      async ({ atlasesUrl, passUrl }) => {
        const { InstancedSpriteAtlases } = await import(atlasesUrl);
        const { InstancedArchiveSprites } = await import(passUrl);
        const probe = {
          appearances: new Map(),
          timeline: [],
          peak: { bytes: 0, ms: 0 },
          atlases: undefined,
          pass: undefined,
          frameTimes: undefined,
        };
        window.__instancedProbe = probe;
        const t0 = performance.now();
        // The bytes of every composed page and part table in the cache, after each compose step and release.
        const record = atlases => {
          let bytes = 0,
            pages = 0;
          for (const appearance of atlases.appearances.values()) {
            for (const { width, height } of appearance.pages ?? []) {
              bytes += width * height * 4;
              pages++;
            }
            bytes += appearance.parts?.bytes ?? 0;
          }
          const ms = performance.now() - t0;
          if (bytes > probe.peak.bytes) {
            probe.peak = { bytes, ms, pages };
          }
          const last = probe.timeline.at(-1);
          if (!last || last.bytes !== bytes || ms - last.ms >= 1000) {
            probe.timeline.push({ ms, bytes, pages, queued: atlases.composing.size });
          }
        };
        const { request, step, releaseUnused } = InstancedSpriteAtlases.prototype;
        InstancedSpriteAtlases.prototype.request = function (key, animation, resolve) {
          probe.atlases = this;
          const appearance = request.call(this, key, animation, resolve);
          const seen = probe.appearances.get(key) ?? { key, appearance, requests: 0 };
          seen.appearance = appearance;
          seen.requests++;
          probe.appearances.set(key, seen);
          return appearance;
        };
        InstancedSpriteAtlases.prototype.step = function (...args) {
          const result = step.apply(this, args);
          record(this);
          return result;
        };
        InstancedSpriteAtlases.prototype.releaseUnused = function (...args) {
          const released = releaseUnused.apply(this, args);
          if (released.length) {
            record(this);
          }
          return released;
        };
        const { render } = InstancedArchiveSprites.prototype;
        InstancedArchiveSprites.prototype.render = function (...args) {
          probe.pass = this;
          return render.apply(this, args);
        };
        window.addEventListener(
          'game:lighting-ready',
          ({ detail: lighting }) => {
            const render = lighting.render;
            lighting.render = function (...args) {
              const result = render.apply(this, args);
              probe.frameTimes?.push(performance.now());
              return result;
            };
          },
          { once: true },
        );
      },
      {
        atlasesUrl: fsUrl('packages/animation/src/instancedSpriteAtlases.ts'),
        passUrl: fsUrl('packages/animation/src/instancedArchiveSprites.ts'),
      },
    );
    let loadMs, frameTiming;
    try {
      await startGame(page);
      await page.locator(gameCanvas).waitFor({ timeout: 600_000 });
      loadMs = Date.now() - started;
      if (options.settle > 0) {
        frameTiming = await page.evaluate(async settle => {
          const probe = window.__instancedProbe;
          const canvas = document.querySelector('canvas[data-game-canvas]');
          const frames = [];
          const start = performance.now();
          probe.frameTimes = frames;
          await new Promise(resolve => setTimeout(resolve, settle));
          probe.frameTimes = undefined;
          const sampleMs = performance.now() - start;
          const intervals = frames.slice(1).map((time, index) => time - frames[index]);
          const sorted = [...intervals].sort((a, b) => a - b);
          return {
            width: canvas.width,
            height: canvas.height,
            frames: frames.length,
            sampleMs,
            fps: (frames.length * 1000) / sampleMs,
            p95FrameMs: sorted[Math.ceil(sorted.length * 0.95) - 1],
            intervals,
          };
        }, options.settle);
        if (!frameTiming.frames) {
          problems.push('no scene frames rendered during the sampling window');
        }
      }
    } catch (error) {
      const phase = loadMs === undefined ? 'did not finish loading' : 'could not sample scene frames';
      problems.push(`${phase}: ${String(error).split('\n')[0]}`);
    }
    const pageResult = await page
      .evaluate(
        async ({ universalUrl }) => {
          const probe = window.__instancedProbe;
          // Entities that show or still draw each appearance now (InstancedArchiveSprites.usedAppearances).
          const users = new Map();
          for (const entry of probe.pass?.retained ?? []) {
            for (const appearance of new Set([entry.appearance, entry.ready])) {
              if (appearance) {
                users.set(appearance, (users.get(appearance) ?? 0) + 1);
              }
            }
          }
          const cached = new Set(probe.atlases?.appearances.values() ?? []);
          const appearances = [];
          for (const { key, appearance, requests } of probe.appearances.values()) {
            const pages = (appearance.pages ?? []).map(({ width, height }) => ({ width, height }));
            // Shared sprite materials are named "<prefix>:<build name>" (ArchiveSpriteAssets.loadBuild).
            const builds = new Set();
            let resolvedFrames = 0,
              parts = 0,
              maxParts = 0;
            for (const frame of appearance.frames) {
              if (!frame) {
                continue;
              }
              resolvedFrames++;
              parts += frame.length;
              maxParts = Math.max(maxParts, frame.length);
              for (const sprite of frame) {
                for (const material of sprite.materials) {
                  if (material?.name) {
                    builds.add(material.name.split(':').pop());
                  }
                }
              }
            }
            const frames = appearance.animation.frames.length;
            appearances.push({
              key,
              builds: [...builds],
              animation: appearance.animation.name,
              frames,
              requests,
              entities: users.get(appearance) ?? 0,
              cached: cached.has(appearance),
              composed: Boolean(appearance.pages),
              // Drawn from a part table instead (PART_TABLE_COMPOSED_BYTES): its real bytes, and what composing it
              // would have taken.
              partTable: Boolean(appearance.parts),
              avoidedBytes: appearance.parts?.composedBytes ?? 0,
              pages,
              bytes:
                pages.reduce((sum, { width, height }) => sum + width * height * 4, 0) + (appearance.parts?.bytes ?? 0),
              accumulationBytes: Math.max(0, ...pages.map(({ width, height }) => width * height * 8)),
              maxParts: appearance.parts?.slots ?? maxParts,
              // Scaled to every frame when only some were resolved.
              partTableBytes:
                appearance.parts?.bytes ?? (resolvedFrames ? Math.round((parts / resolvedFrames) * frames * 48) : 0),
            });
          }
          const { scene, renderer } = await import(universalUrl);
          let meshes = 0,
            instances = 0,
            capacity = 0,
            attributeBytes = 0;
          scene.traverse(object => {
            if (!object.isInstancedMesh) {
              return;
            }
            meshes++;
            instances += object.count;
            capacity += object.instanceMatrix.count;
            attributeBytes += object.instanceMatrix.array.byteLength;
            for (const attribute of Object.values(object.geometry.attributes)) {
              if (attribute.isInstancedBufferAttribute) {
                attributeBytes += attribute.array.byteLength;
              }
            }
          });
          const gl = renderer.getContext();
          const debug = gl.getExtension('WEBGL_debug_renderer_info');
          return {
            appearances,
            queued: probe.atlases?.composing.size ?? 0,
            retained: probe.pass?.retained.size ?? 0,
            timeline: probe.timeline,
            peak: probe.peak,
            batches: { meshes, instances, capacity, attributeBytes },
            gl: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          };
        },
        { universalUrl: fsUrl('src/universal.ts') },
      )
      .catch(error => {
        problems.push(`could not read the page: ${String(error).split('\n')[0]}`);
        return undefined;
      });
    const memory = processes.stop();
    let renderer;
    if (loadMs !== undefined) {
      try {
        renderer = await rendererAllocators(browser, page);
        // RSS samples during the settle window include garbage; this one follows the full GC.
        renderer.rssAfterGc = chromiumProcesses()?.renderer;
      } catch (error) {
        problems.push(`could not dump renderer memory: ${String(error).split('\n')[0]}`);
      }
    }
    // Profiling has its own window so it does not affect the frame timing or RSS samples above.
    if (tracePath && loadMs !== undefined && pageResult) {
      try {
        await recordChromeTrace(browser, page, tracePath);
      } catch (error) {
        problems.push(`could not record Chrome trace: ${String(error).split('\n')[0]}`);
      }
    }
    return {
      save: save ?? '(active session)',
      browser: browser.version(),
      loadMs,
      frameTiming,
      processes: memory,
      renderer,
      problems,
      ...(pageResult ?? { appearances: [], timeline: [], peak: { bytes: 0, ms: 0 }, batches: {}, queued: 0 }),
    };
  } finally {
    await browser.close();
  }
}

function summarize(result) {
  const appearances = [...result.appearances].sort((a, b) => b.bytes - a.bytes);
  const total = appearances.reduce((sum, { bytes }) => sum + bytes, 0);
  const builds = new Map();
  for (const appearance of appearances) {
    const name = appearance.builds.join('+') || '?';
    const build = builds.get(name) ?? { name, bytes: 0, pages: 0, appearances: 0, entities: 0, partTableBytes: 0 };
    build.bytes += appearance.bytes;
    build.pages += appearance.pages.length;
    build.appearances += appearance.composed || appearance.partTable ? 1 : 0;
    build.entities += appearance.entities;
    build.partTableBytes += appearance.composed || appearance.partTable ? appearance.partTableBytes : 0;
    builds.set(name, build);
  }
  const partTables = appearances.filter(({ partTable }) => partTable);
  return {
    appearances,
    total,
    partTables,
    avoided: partTables.reduce((sum, { avoidedBytes }) => sum + avoidedBytes, 0),
    pageCount: appearances.reduce((sum, { pages }) => sum + pages.length, 0),
    composed: appearances.filter(({ composed }) => composed).length,
    accumulation: Math.max(0, ...appearances.map(({ accumulationBytes }) => accumulationBytes)),
    builds: [...builds.values()].filter(({ bytes }) => bytes > 0).sort((a, b) => b.bytes - a.bytes),
  };
}

function largestPage(pages) {
  const largest = pages.reduce((best, page) => (page.width * page.height > best.width * best.height ? page : best), {
    width: 0,
    height: 0,
  });
  return largest.width ? `${largest.width}x${largest.height}` : '-';
}

function printText(options, result) {
  const { appearances, total, pageCount, composed, accumulation, partTables, avoided } = summarize(result);
  const { batches, frameTiming, processes, peak } = result;
  const lines = [
    `save: ${result.save}   loaded in ${result.loadMs === undefined ? '(not loaded)' : seconds(result.loadMs)}`,
    `composed atlas pages and part tables now: ${size(total)} in ${pageCount} pages for ${composed} appearances ` +
      `and ${partTables.length} part tables ` +
      `(${result.appearances.length - composed - partTables.length} seen without either, ${result.queued} queued)`,
    `part tables: ${size(partTables.reduce((sum, { bytes }) => sum + bytes, 0))} instead of ${size(avoided)} composed` +
      (partTables.length
        ? ` (${partTables.map(({ builds, animation }) => `${builds.join('+') || '?'} / ${animation}`).join(', ')})`
        : ''),
    `composed atlas pages at the peak: ${size(peak.bytes)} at ${seconds(peak.ms)}`,
    `transient accumulation target while composing the largest page: ${size(accumulation)}`,
    `InstancedMesh batches: ${batches.meshes} meshes, ${batches.instances} drawn of ${batches.capacity} slots, ` +
      `${size(batches.attributeBytes ?? 0)} of instance attributes`,
  ];
  if (frameTiming) {
    lines.push(
      `${frameTiming.frames} rendered frames in ${seconds(frameTiming.sampleMs)} (${frameTiming.fps.toFixed(1)} FPS)`,
    );
  }
  if (processes.final) {
    for (const type of ['gpu-process', 'renderer']) {
      if (processes.peaks[type]) {
        lines.push(
          `${type} RSS: peak ${size(processes.peaks[type].bytes)} at ${seconds(processes.peaks[type].ms)}, ` +
            `final ${size(processes.final[type] ?? 0)}`,
        );
      }
    }
  }
  if (result.renderer) {
    lines.push(
      `renderer after GC: RSS ${result.renderer.rssAfterGc ? size(result.renderer.rssAfterGc) : '?'}, ` +
        `private footprint ${size(result.renderer.privateFootprint)}: ` +
        result.renderer.allocators.map(({ path, bytes }) => `${path} ${size(bytes)}`).join(', '),
    );
  }
  if (result.mainThreadHeap) {
    const { afterGc, peaks, sites, profile } = result.mainThreadHeap;
    lines.push(
      `main-thread V8 used heap: sampled peak ${size(peaks.usedSize.bytes)} at ${seconds(peaks.usedSize.ms)}, ` +
        `after full GC ${size(afterGc.usedSize)}; live allocation profile: ${profile}`,
      ...sites.slice(0, 5).map(({ site, bytes }) => `  ${size(bytes)}  ${site}`),
    );
  }
  lines.push(
    '',
    `${'MB'.padStart(8)} ${'pages'.padStart(5)} ${'page size'.padStart(11)} ${'frames'.padStart(6)} ` +
      `${'ents'.padStart(5)} ${'parts'.padStart(5)} ${'table KB'.padStart(8)}  build / clip`,
  );
  const listed = appearances.filter(({ composed }) => composed);
  for (const appearance of options.top > 0 ? listed.slice(0, options.top) : listed) {
    lines.push(
      `${mb(appearance.bytes).padStart(8)} ${String(appearance.pages.length).padStart(5)} ` +
        `${largestPage(appearance.pages).padStart(11)} ${String(appearance.frames).padStart(6)} ` +
        `${String(appearance.entities).padStart(5)} ${String(appearance.maxParts).padStart(5)} ` +
        `${(appearance.partTableBytes / 1024).toFixed(0).padStart(8)}  ` +
        `${appearance.builds.join('+') || '?'} / ${appearance.animation}`,
    );
  }
  if (result.problems.length) {
    lines.push('', 'problems:', ...result.problems.map(problem => `  ${problem}`));
  }
  process.stdout.write(`${lines.join('\n')}\n\n`);
}

function mainThreadHeapMarkdown(heap, settle) {
  const { profile, pollMs, samplingInterval, sampleCount, baseline, load, beforeGc, afterGc, peaks, sites } = heap;
  return [
    '### 主线程内存',
    '',
    `独立启动同一存档，每 ${pollMs} ms 查询页面主线程 isolate，加载完成后继续采样 ${seconds(settle)}。峰值取游戏 bootstrap 开始后的观测值。后台 worker、GPU 与渲染进程 RSS 由其他指标衡量。`,
    '',
    '| 指标（MiB） | 启动前 | 加载完成 | 观测峰值（启动后时间） | 稳定后 GC 前 | 完整 GC 后 |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...HEAP_METRICS.map(
      ([metric, name]) =>
        `| ${name} | ${mb(baseline[metric])} | ${mb(load[metric])} | ${mb(peaks[metric].bytes)}（${seconds(peaks[metric].ms)}） | ` +
        `${mb(beforeGc[metric])} | ${mb(afterGc[metric])} |`,
    ),
    '',
    `完整 GC 后的 V8 存活对象分配位置按估算字节排序，平均采样间隔为 ${samplingInterval / 1024} KiB，共 ${sampleCount} 个样本。完整分配栈见 \`${profile}\`。`,
    '',
    '| 分配位置 | 估算存活大小（MiB） |',
    '| --- | ---: |',
    ...sites.slice(0, 15).map(({ site, bytes }) => `| ${site.replaceAll('|', '&#124;')} | ${mb(bytes)} |`),
    '',
  ];
}

function markdown(options, results) {
  const cpu = os.cpus()[0]?.model ?? 'unknown CPU';
  const lines = [
    '# InstancedMesh 帧率与内存分析',
    '',
    `由 \`node scripts/instanced-atlas-memory.mjs ${process.argv.slice(2).join(' ')}\` 生成。`,
    '',
    '## 环境',
    '',
    `- 主机：${os.hostname()}，${cpu} × ${os.cpus().length}，内存 ${(os.totalmem() / 1024 ** 3).toFixed(1)} GB，${os.platform()} ${os.release()}`,
    `- 浏览器：${options.headed ? 'Chromium' : 'headless Chromium'} ${results[0]?.browser ?? '?'}，GL：${results[0]?.gl ?? '?'}`,
    `- 报告生成时间（UTC）：${new Date().toISOString()}`,
    `- 使用 Vite 测试服务。加载存档后原地采样 ${seconds(options.settle)}，按游戏场景的渲染调用次数计算 FPS。`,
    '- 合成页按 WebGL RGBA8 每纹素 4 字节估算。浏览器进程 RSS 是驻留系统内存，单独列出。',
    '- “零件表”：合成页达到 16 MB（`PART_TABLE_COMPOSED_BYTES`）的外观改为按零件实例化，每帧每个零件槽一行 48 字节（矩阵、UV 矩形、页号）；其余外观的零件表是估算值。',
    '',
    '## 概览',
    '',
    '| 存档 | 加载 | 分辨率 | 帧数／采样时长 | 平均 FPS | P95 帧时 | 合成页与零件表（稳定后） | 零件表（代替的合成页） | 峰值 | 合成中临时目标 | 实例属性 | GPU 进程 RSS 峰值／稳定 | 渲染进程 RSS 峰值／稳定 | 问题 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const result of results) {
    const summary = summarize(result);
    const { frameTiming } = result;
    const p95 = frameTiming?.p95FrameMs;
    const rss = type =>
      result.processes.peaks?.[type]
        ? `${size(result.processes.peaks[type].bytes)}（${seconds(result.processes.peaks[type].ms)}）／${size(result.processes.final?.[type] ?? 0)}`
        : '-';
    lines.push(
      `| ${result.save} | ${result.loadMs === undefined ? '未完成' : seconds(result.loadMs)} | ` +
        (frameTiming
          ? `${frameTiming.width} × ${frameTiming.height} | ${frameTiming.frames}／${seconds(frameTiming.sampleMs)} | ` +
            `${frameTiming.fps.toFixed(1)} | ${p95 === undefined ? '-' : `${p95.toFixed(1)} ms`} | `
          : '- | - | - | - | ') +
        `${size(summary.total)}，${summary.pageCount} 页，${summary.composed} 个外观 | ` +
        `${summary.partTables.length} 个，${size(summary.partTables.reduce((sum, { bytes }) => sum + bytes, 0))}（${size(summary.avoided)}） | ` +
        `${size(result.peak.bytes)}（${seconds(result.peak.ms)}） | ${size(summary.accumulation)} | ` +
        `${size(result.batches.attributeBytes ?? 0)} | ${rss('gpu-process')} | ${rss('renderer')} | ` +
        `${result.problems.length ? result.problems.join('；') : '无'} |`,
    );
  }
  for (const result of results) {
    const summary = summarize(result);
    lines.push(
      '',
      `## ${result.save}`,
      '',
      `稳定后：${summary.composed} 个外观有合成页，${summary.partTables.length} 个按零件表绘制，另有 ${result.appearances.length - summary.composed - summary.partTables.length} 个只出现过、两者都没有；合成队列剩余 ${result.queued} 个；` +
        `实例化通道保留 ${result.retained ?? '?'} 个实体，当前绘制 ${result.batches.instances ?? 0} 个实例。`,
      '',
    );
    if (result.renderer) {
      lines.push(
        '### 渲染进程内存（按分配器，稳定后）',
        '',
        `完整 GC 之后：RSS ${result.renderer.rssAfterGc ? size(result.renderer.rssAfterGc) : '?'}，私有内存 ${size(result.renderer.privateFootprint)}。各分配器向系统占用的大小（memory-infra \`size\`）；ArrayBuffer 分区包含已释放但未归还系统的空间，worker 也在渲染进程内。`,
        '',
        '| 分配器 | 大小 | memory-infra 路径 |',
        '| --- | --- | --- |',
        ...result.renderer.allocators.map(({ path, name, bytes }) => `| ${name} | ${size(bytes)} | \`${path}\` |`),
        '',
      );
    }
    if (result.mainThreadHeap) {
      lines.push(...mainThreadHeapMarkdown(result.mainThreadHeap, options.heapSettle));
    }
    lines.push(
      '### 按 build 汇总',
      '',
      '| build | 合成页 | 页数 | 外观数 | 使用实体 | 零件表估算 |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const build of summary.builds.slice(0, options.top > 0 ? options.top : undefined)) {
      lines.push(
        `| ${build.name} | ${size(build.bytes)} | ${build.pages} | ${build.appearances} | ${build.entities} | ${size(build.partTableBytes)} |`,
      );
    }
    if (summary.partTables.length) {
      lines.push(
        '',
        '### 按零件表绘制的外观',
        '',
        '| 零件表 | 代替的合成页 | 帧数 | 零件槽 | 使用实体 | build／clip |',
        '| --- | --- | --- | --- | --- | --- |',
        ...[...summary.partTables]
          .sort((a, b) => b.avoidedBytes - a.avoidedBytes)
          .map(
            appearance =>
              `| ${size(appearance.bytes)} | ${size(appearance.avoidedBytes)} | ${appearance.frames} | ` +
              `${appearance.maxParts} | ${appearance.entities} | ${appearance.builds.join('+') || '?'}／${appearance.animation} |`,
          ),
      );
    }
    lines.push(
      '',
      '### 外观（按合成页大小）',
      '',
      '| 合成页 | 占比 | 页数 | 最大页 | 帧数 | 使用实体 | 每实体 | 每帧零件 | 零件表估算 | build／clip |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    const composed = summary.appearances.filter(({ composed }) => composed);
    for (const appearance of composed.slice(0, options.top > 0 ? options.top : undefined)) {
      lines.push(
        `| ${size(appearance.bytes)} | ${summary.total ? ((appearance.bytes / summary.total) * 100).toFixed(1) : 0}% | ` +
          `${appearance.pages.length} | ${largestPage(appearance.pages)} | ${appearance.frames} | ${appearance.entities} | ` +
          `${appearance.entities ? size(appearance.bytes / appearance.entities) : '无人使用'} | ${appearance.maxParts} | ` +
          `${size(appearance.partTableBytes)} | ${appearance.builds.join('+') || '?'}／${appearance.animation} |`,
      );
    }
    const changes = result.timeline.filter(
      (sample, index, all) => index === 0 || sample.bytes !== all[index - 1].bytes,
    );
    lines.push(
      '',
      '### 合成页总量时间线（变化点）',
      '',
      '| 时间 | 合成页 | 页数 | 排队 |',
      '| --- | --- | --- | --- |',
      ...changes
        .slice(0, 40)
        .map(({ ms, bytes, pages, queued }) => `| ${seconds(ms)} | ${size(bytes)} | ${pages} | ${queued} |`),
    );
    if (changes.length > 40) {
      lines.push(`| … | 共 ${changes.length} 个变化点 | | |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

const options = parseArgs(process.argv.slice(2));
for (const directory of [options.traceDir, options.heapProfileDir]) {
  if (directory) {
    mkdirSync(directory, { recursive: true });
  }
}
const server = await startServer(options.port);
const results = [];
try {
  for (const save of options.saves) {
    const prefix = `${results.length + 1}-${basename(save ?? 'active-session', '.json')}`;
    const tracePath = options.traceDir && join(options.traceDir, `${prefix}.trace.json.gz`);
    const result = await measure(options, save, server.url, tracePath);
    if (options.heapProfileDir && result.loadMs !== undefined) {
      try {
        result.mainThreadHeap = await measureHeap(
          options,
          save,
          server.url,
          join(options.heapProfileDir, `${prefix}.heapprofile`),
        );
      } catch (error) {
        result.problems.push(`could not profile the main-thread heap: ${String(error).split('\n')[0]}`);
      }
    }
    results.push(result);
    if (!options.json) {
      printText(options, result);
    }
  }
} finally {
  server.stop();
}
if (options.json) {
  process.stdout.write(`${JSON.stringify(results.length === 1 ? results[0] : results, null, 2)}\n`);
}
if (options.report) {
  writeFileSync(options.report, markdown(options, results));
  (options.json ? process.stderr : process.stdout).write(`report written to ${options.report}\n`);
}
