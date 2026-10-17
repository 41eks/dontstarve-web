import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const dist = resolve(import.meta.dirname, '../../../dist');
const mime: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.wav': 'audio/wav',
};
let server: Server;
let baseUrl: string;
let generatedWorker: string;
let workerSource: string;
const requests: string[] = [];

test.beforeAll(async () => {
  generatedWorker = await readFile(resolve(dist, 'sw.js'), 'utf8');
  server = createServer(async (request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname;
    requests.push(path);
    response.setHeader('Cache-Control', 'no-store');
    if (!path.startsWith('/dontstarve-web/')) {
      response.writeHead(404).end();
      return;
    }
    const relative = decodeURIComponent(path.slice('/dontstarve-web/'.length));
    if (relative === 'cache-test.html') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Cache lifecycle</title>');
      return;
    }
    if (relative === 'sw.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(workerSource);
      return;
    }
    if (relative === 'dst/data/html-fallback.zip') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Fallback</title>');
      return;
    }
    const file = resolve(dist, relative || 'index.html');
    if (!file.startsWith(`${dist}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const data = await readFile(file);
      response.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
      response.end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  baseUrl = `http://127.0.0.1:${address.port}/dontstarve-web/`;
});

test.beforeEach(() => {
  workerSource = generatedWorker;
  requests.length = 0;
});

test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function waitForControl(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

test('production entry registers caching; binary assets persist across reload and work offline', async ({ page, context }) => {
  await page.goto(baseUrl);
  await waitForControl(page);
  const assetUrl = `${baseUrl}dst/data/anim/swap_torch.zip`;
  const expected = Array.from(await readFile(resolve(dist, 'dst/data/anim/swap_torch.zip')));
  const fetchBytes = () => page.evaluate(async url => {
    const response = await fetch(url);
    return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
  }, assetUrl);

  expect(await fetchBytes()).toEqual({ status: 200, bytes: expected });
  expect(requests.filter(path => path.endsWith('/anim/swap_torch.zip'))).toHaveLength(1);
  await page.reload();
  await waitForControl(page);
  expect(await fetchBytes()).toEqual({ status: 200, bytes: expected });
  expect(requests.filter(path => path.endsWith('/anim/swap_torch.zip'))).toHaveLength(1);
  await context.setOffline(true);
  expect(await fetchBytes()).toEqual({ status: 200, bytes: expected });
});

test('audio range requests cache the full file; failures, HTML fallbacks and saves stay uncached', async ({ page, context }) => {
  await page.goto(`${baseUrl}cache-test.html`);
  await page.evaluate(() => navigator.serviceWorker.register('./sw.js'));
  await waitForControl(page);
  const audioUrl = `${baseUrl}audio/worldgen.wav`;
  const audio = await readFile(resolve(dist, 'audio/worldgen.wav'));
  const fetchRange = (range: string) => page.evaluate(async ({ url, range }) => {
    const response = await fetch(url, { headers: { Range: range } });
    return {
      status: response.status, range: response.headers.get('content-range'),
      bytes: Array.from(new Uint8Array(await response.arrayBuffer())),
    };
  }, { url: audioUrl, range });

  expect(await fetchRange('bytes=0-15')).toEqual({
    status: 206, range: `bytes 0-15/${audio.length}`, bytes: Array.from(audio.subarray(0, 16)),
  });
  await page.evaluate(async () => {
    await fetch('./dst/data/missing.zip');
    await fetch('./dst/data/html-fallback.zip');
    await fetch('./saves/initial-world.json');
  });
  const keys = await page.evaluate(async () => {
    const name = (await caches.keys()).find(name => name.startsWith('dontstarve-assets:'))!;
    return (await (await caches.open(name)).keys()).map(request => request.url);
  });
  expect(keys).toEqual([audioUrl]);

  await context.setOffline(true);
  expect(await fetchRange('bytes=-8')).toEqual({
    status: 206, range: `bytes ${audio.length - 8}-${audio.length - 1}/${audio.length}`,
    bytes: Array.from(audio.subarray(-8)),
  });
  expect(await fetchRange(`bytes=${audio.length}-`)).toEqual({
    status: 416, range: `bytes */${audio.length}`, bytes: [],
  });
});

test('updates wait for existing pages, then remove only this application’s old cache', async ({ page, context }) => {
  await page.goto(`${baseUrl}cache-test.html`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('./sw.js');
    await caches.open('unrelated-application');
  });
  await waitForControl(page);
  await page.evaluate(() => fetch('./dst/data/anim/swap_torch.zip'));
  const oldName = await page.evaluate(async () => (await caches.keys()).find(name => name.startsWith('dontstarve-assets:'))!);

  workerSource = generatedWorker.replace('const cacheName = `${cachePrefix}', 'const cacheName = `${cachePrefix}updated-');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
  await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting));
  expect(await page.evaluate(() => caches.keys())).toContain(oldName);

  // All old controlled pages must close before the replacement can activate.
  await page.close();
  const next = await context.newPage();
  await next.goto(`${baseUrl}cache-test.html`);
  await waitForControl(next);
  await expect.poll(() => next.evaluate(() => caches.keys())).not.toContain(oldName);
  expect(await next.evaluate(() => caches.keys())).toContain('unrelated-application');
  await next.evaluate(() => fetch('./dst/data/anim/swap_torch.zip'));
  const names = await next.evaluate(() => caches.keys());
  expect(names.some(name => name.includes(':updated-'))).toBe(true);
});
