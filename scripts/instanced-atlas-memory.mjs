#!/usr/bin/env node
/**
 * GPU memory of the instanced sprite pass after a save has loaded: the atlas pages composed for every instanced
 * appearance, plus the per-instance attribute buffers of the InstancedMesh batches.
 *
 *     node scripts/instanced-atlas-memory.mjs
 *     node scripts/instanced-atlas-memory.mjs --save Cluster_1/Caves.json --top 40
 *     node scripts/instanced-atlas-memory.mjs --json > instanced-memory.json
 *
 * Options:
 *   --save <path>    a save below public/saves (default: the cluster's active session, like the game)
 *   --top <n>        appearances to list, largest first (default 25; 0 lists all)
 *   --settle <ms>    time to keep running after the game has loaded, so late appearances compose (default 5000)
 *   --port <n>       port of the vite test server this script starts (default 4199)
 *   --json           print the whole measurement as JSON instead of tables
 *   --headed         show the browser
 *
 * Appearances are decided at runtime (bank, build, clip, symbol overrides, hidden symbols), so the script loads the
 * real game in headless Chromium rather than estimating from the art. Before the game modules load it wraps
 * InstancedSpriteAtlases.prototype.request to see every appearance; once the game has loaded it reads each
 * appearance's composed pages (RGBA8, 4 bytes per texel) and the InstancedBufferAttributes of the scene's batches.
 *
 * Figures are what WebGL is asked to allocate. Drivers and ANGLE add their own copies (the headless SwiftShader GPU
 * process used about 2.2 times the request in docs/gpu-process-oom.md). Composing a page also takes a half-float
 * accumulation target (8 bytes per texel) for that page only; the largest one is reported as the transient peak.
 * The "世界生成中" page's OffscreenCanvas worker is stubbed out: a GPU process crash while it renders takes the tab
 * down, which would end the measurement instead of reporting it.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const uiDir = `${root}packages/ui`;
const requireUi = createRequire(`${uiDir}/package.json`);

function parseArgs(argv) {
  const options = { save: undefined, top: 25, settle: 5000, port: 4199, json: false, headed: false };
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
      options.save = value();
    } else if (arg === '--top') {
      options.top = Number(value());
    } else if (arg === '--settle') {
      options.settle = Number(value());
    } else if (arg === '--port') {
      options.port = Number(value());
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--headed') {
      options.headed = true;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${readUsage()}\n`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option ${arg}`);
    }
  }
  return options;
}

function readUsage() {
  return 'node scripts/instanced-atlas-memory.mjs [--save Cluster_1/Master.json] [--top 25] [--settle 5000] [--port 4199] [--json] [--headed]';
}

/** Starts the UI package's vite test server on `port` and resolves once it serves the test page. */
async function startServer(port) {
  const vite = spawn(
    `${uiDir}/node_modules/.bin/vite`,
    ['--config', 'vite.test.config.ts', '--port', String(port), '--strictPort'],
    {
      cwd: uiDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
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

async function measure(options, baseUrl) {
  const { chromium } = requireUi('@playwright/test');
  const browser = await chromium.launch({ headless: !options.headed });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const problems = [];
    page.on('crash', () => problems.push('page crashed'));
    page.on('pageerror', error => problems.push(`page error: ${error.message}`));
    page.on('console', message => {
      if (/context lost|Unable to start/i.test(message.text())) {
        problems.push(`console: ${message.text()}`);
      }
    });
    await page.route(/stage\.worker\.ts/, route =>
      route.fulfill({ contentType: 'text/javascript', body: 'self.onmessage = () => {};' }),
    );
    const query = options.save ? `?save=${encodeURIComponent(options.save)}` : '';
    await page.goto(`${baseUrl}/tests/dst-lighting.html${query}`);
    const fsUrl = path => `/@fs${root}${path}`;
    const started = Date.now();
    await page.evaluate(
      async ({ atlasesUrl, bootstrapUrl }) => {
        const { InstancedSpriteAtlases } = await import(atlasesUrl);
        const appearances = new Map();
        const request = InstancedSpriteAtlases.prototype.request;
        InstancedSpriteAtlases.prototype.request = function (key, animation, resolve) {
          const appearance = request.call(this, key, animation, resolve);
          const record = appearances.get(key) ?? { key, appearance, requests: 0 };
          record.requests++;
          appearances.set(key, record);
          return appearance;
        };
        window.__instancedAppearances = appearances;
        const app = document.createElement('div');
        app.id = 'app';
        document.body.append(app);
        void import(bootstrapUrl);
      },
      {
        atlasesUrl: fsUrl('packages/animation/src/instancedSpriteAtlases.ts'),
        bootstrapUrl: fsUrl('src/bootstrap.tsx'),
      },
    );
    await page.locator('canvas[data-game-canvas][data-loaded="true"]').waitFor({ timeout: 600_000 });
    const loadMs = Date.now() - started;
    await page.waitForTimeout(options.settle);
    const result = await page.evaluate(
      async ({ universalUrl }) => {
        const appearances = [];
        for (const { key, appearance, requests } of window.__instancedAppearances.values()) {
          const pages = (appearance.pages ?? []).map(({ width, height }) => ({ width, height }));
          // Shared sprite materials are named "<prefix>:<build name>" (ArchiveSpriteAssets.loadBuild).
          const builds = new Set();
          for (const frame of appearance.frames) {
            for (const sprite of frame ?? []) {
              for (const material of sprite.materials) {
                if (material?.name) {
                  builds.add(material.name.split(':').pop());
                }
              }
            }
          }
          appearances.push({
            key,
            builds: [...builds],
            animation: appearance.animation.name,
            frames: appearance.animation.frames.length,
            requests,
            composed: Boolean(appearance.pages),
            pages,
            bytes: pages.reduce((sum, { width, height }) => sum + width * height * 4, 0),
            accumulationBytes: Math.max(0, ...pages.map(({ width, height }) => width * height * 8)),
          });
        }
        const { scene } = await import(universalUrl);
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
        return { appearances, batches: { meshes, instances, capacity, attributeBytes } };
      },
      { universalUrl: fsUrl('src/universal.ts') },
    );
    return { ...result, loadMs, problems };
  } finally {
    await browser.close();
  }
}

function report(options, { appearances, batches, loadMs, problems }) {
  appearances.sort((a, b) => b.bytes - a.bytes);
  const total = appearances.reduce((sum, { bytes }) => sum + bytes, 0);
  const pageCount = appearances.reduce((sum, { pages }) => sum + pages.length, 0);
  const pending = appearances.filter(({ composed }) => !composed).length;
  const accumulation = Math.max(0, ...appearances.map(({ accumulationBytes }) => accumulationBytes));
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ save: options.save ?? '(active session)', loadMs, total, pageCount, accumulation, batches, problems, appearances }, null, 2)}\n`,
    );
    return;
  }
  const lines = [
    `save: ${options.save ?? '(active session)'}   loaded in ${(loadMs / 1000).toFixed(1)} s`,
    `composed atlas pages: ${size(total)} in ${pageCount} pages for ${appearances.length} appearances` +
      (pending ? ` (${pending} not composed yet)` : ''),
    `transient accumulation target while composing the largest page: ${size(accumulation)}`,
    `InstancedMesh batches: ${batches.meshes} meshes, ${batches.instances} drawn of ${batches.capacity} slots, ` +
      `${size(batches.attributeBytes)} of instance attributes (drawn: in view now)`,
    `total requested: ${size(total + batches.attributeBytes)} (+ driver copies; + the transient target while composing)`,
    '',
    'shows: how many times entities asked for the appearance; page size: the largest of its pages',
    `${'MB'.padStart(8)} ${'share'.padStart(6)} ${'pages'.padStart(5)} ${'page size'.padStart(11)} ${'frames'.padStart(6)} ${'shows'.padStart(5)}  build / clip  (key)`,
  ];
  const listed = options.top > 0 ? appearances.slice(0, options.top) : appearances;
  for (const { key, builds, animation, frames, requests, pages, bytes, composed } of listed) {
    const largest = pages.reduce((best, page) => (page.width * page.height > best.width * best.height ? page : best), {
      width: 0,
      height: 0,
    });
    const pageSize = composed ? `${largest.width}x${largest.height}` : 'pending';
    const share = total ? `${((bytes / total) * 100).toFixed(1)}%` : '-';
    const label = key.length > 60 ? `${key.slice(0, 57)}...` : key;
    lines.push(
      `${mb(bytes).padStart(8)} ${share.padStart(6)} ${String(pages.length).padStart(5)} ${pageSize.padStart(11)} ` +
        `${String(frames).padStart(6)} ${String(requests).padStart(5)}  ${builds.join('+') || '?'} / ${animation}  (${label})`,
    );
  }
  if (listed.length < appearances.length) {
    lines.push(`... ${appearances.length - listed.length} more (--top 0 lists all)`);
  }
  if (problems.length) {
    lines.push('', 'problems while loading:', ...problems.map(problem => `  ${problem}`));
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

const options = parseArgs(process.argv.slice(2));
const server = await startServer(options.port);
try {
  report(options, await measure(options, server.url));
} finally {
  server.stop();
}
