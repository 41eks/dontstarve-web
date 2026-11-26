import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { writeHeapSnapshot } from 'node:v8';
import { createEffect, createMemo, createSignal, readonlySignal, watchSignal } from '../packages/signals/src/signal.ts';

test('counts live signal implementations once and excludes their application payloads', async () => {
  const lazyUrl = new URL('../packages/signals/src/lazySignal.ts', import.meta.url).href;
  // The application's bundler resolves the extensionless import in LazySignal.
  const hook = registerHooks({
    resolve(specifier, context, next) {
      return next(context.parentURL === lazyUrl && specifier === './signal' ? './signal.ts' : specifier, context);
    },
  });
  let LazySignal;
  try {
    ({ LazySignal } = await import(lazyUrl));
  } finally {
    hook.deregister();
  }
  const source = createSignal({ largePayload: new Uint8Array(4 * 1024 * 1024) });
  const watched = watchSignal(source, () => {});
  const memo = createMemo(() => watched.get());
  createEffect(() => memo.get());
  const readonly = readonlySignal(createSignal(false));
  const unused = new LazySignal(0);
  const declared = new LazySignal(0);
  declared.get();
  globalThis.signalHeapFixture = {
    source,
    sameSource: readonlySignal(source),
    readonly,
    watched,
    memo,
    unused,
    declared,
  };

  const dir = mkdtempSync(join(tmpdir(), 'dontstarve-signal-heap-'));
  try {
    const snapshot = writeHeapSnapshot(join(dir, 'fixture.heapsnapshot'));
    const analyzer = fileURLToPath(new URL('../scripts/heap-snapshot-analyze.mjs', import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, [analyzer, snapshot, '--signals']);
    const { total, kinds } = JSON.parse(stdout);
    assert.deepEqual(Object.fromEntries(Object.entries(kinds).map(([kind, { count }]) => [kind, count])), {
      plain: 2,
      watched: 1,
      memo: 1,
      lazyDeclared: 1,
      lazyUndeclared: 1,
    });
    assert.equal(total.count, 6);
    assert.equal(
      total.totalBytes,
      Object.values(kinds).reduce((sum, { totalBytes }) => sum + totalBytes, 0),
    );
    assert.ok(total.totalBytes > 0 && total.totalBytes < 4096, 'signal sizes exclude their stored value');
    assert.ok(kinds.lazyDeclared.totalBytes > kinds.lazyUndeclared.totalBytes);
  } finally {
    delete globalThis.signalHeapFixture;
    rmSync(dir, { recursive: true, force: true });
  }
});
