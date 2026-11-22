#!/usr/bin/env node
/**
 * Analyse a V8 heap snapshot (DevTools Memory → Heap snapshot → Save) too large for DevTools or JSON.parse.
 * The file is streamed: node and edge fields go into typed arrays outside the V8 heap, so a 4 GB snapshot with
 * 50 M nodes needs about 6 GB of memory. Retained sizes come from the dominator tree over non-weak edges, as in
 * DevTools; a retainer path is one shortest path from the GC roots.
 *
 *   node scripts/heap-snapshot-analyze.mjs FILE [options]
 *     (default)            totals, self size by node type and by class, the largest objects by retained size
 *     --top N              how many objects / classes to list (default 30)
 *     --buffers            ArrayBuffer backing-store bytes grouped by their outermost owner (module variable or class)
 *     --caches a,b         entries of module-scope Maps with these variable names, by retained size
 *                          (default with --caches alone: requests,atlasRequests — the asset loaders' URL caches)
 *     --atlases            per-page CPU data (pixels, BC blocks, alpha masks) of the animation archive cache
 *
 * Wait until DevTools has finished writing the file: a snapshot still being saved ends inside an array.
 */
import { spawnSync } from 'node:child_process';
import { closeSync, createReadStream, openSync, readSync } from 'node:fs';
import { getHeapStatistics } from 'node:v8';

const HEAP_LIMIT_MB = 12_000;
if (getHeapStatistics().heap_size_limit < 8e9 && !process.env.HEAP_SNAPSHOT_ANALYZE_CHILD) {
  // Strings and per-class tables live on the V8 heap; restart with room for them.
  const child = spawnSync(
    process.execPath,
    [`--max-old-space-size=${HEAP_LIMIT_MB}`, ...process.execArgv, ...process.argv.slice(1)],
    { stdio: 'inherit', env: { ...process.env, HEAP_SNAPSHOT_ANALYZE_CHILD: '1' } },
  );
  process.exit(child.status ?? 1);
}

const args = process.argv.slice(2);
const file = args.find(arg => !arg.startsWith('--') && !/^\d+$/.test(arg));
const option = name => args.includes(`--${name}`);
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  const next = index >= 0 ? args[index + 1] : undefined;
  return next && !next.startsWith('--') ? next : fallback;
};
if (!file) {
  console.error('usage: node scripts/heap-snapshot-analyze.mjs FILE [--top N] [--buffers] [--caches a,b] [--atlases]');
  process.exit(2);
}
const TOP = Number(value('top', '30'));
const CACHE_NAMES = option('caches') ? value('caches', 'requests,atlasRequests').split(',') : [];

const started = Date.now();
const log = (...parts) => console.error(`[${((Date.now() - started) / 1000).toFixed(0)}s]`, ...parts);
const mb = bytes => `${(bytes / 1e6).toFixed(1).padStart(9)} MB`;

// ---- Parse. Everything before "nodes":[ is a small JSON header with the field layout and counts.
const head = Buffer.alloc(1 << 20);
const fd = openSync(file, 'r');
readSync(fd, head, 0, head.length, 0);
closeSync(fd);
const headText = head.toString('latin1');
const header = JSON.parse(`${headText.slice(0, headText.indexOf('"nodes":[')).replace(/,\s*$/, '')}}`);
const meta = header.snapshot.meta;
const nodeFields = meta.node_fields,
  edgeFields = meta.edge_fields;
const nodeTypes = meta.node_types[0],
  edgeTypes = meta.edge_types[0];
const N = nodeFields.length,
  E = edgeFields.length;
const nodeCount = header.snapshot.node_count,
  edgeCount = header.snapshot.edge_count;
log(`${nodeCount} nodes, ${edgeCount} edges`);

const nodes = new Uint32Array(nodeCount * N);
const edges = new Uint32Array(edgeCount * E);
const strings = [];
{
  let section = null,
    target = null,
    pos = 0,
    number = 0,
    inNumber = false,
    tail = '',
    inString = false,
    escaped = false,
    parts = null;
  const parseNumbers = (chunk, i) => {
    for (; i < chunk.length; i++) {
      const c = chunk[i];
      if (c >= 48 && c <= 57) {
        number = number * 10 + (c - 48);
        inNumber = true;
        continue;
      }
      if (inNumber) {
        target[pos++] = number;
        number = 0;
        inNumber = false;
      }
      if (c === 93) {
        log(`${section}: ${pos} values`);
        section = null;
        tail = '';
        return i + 1;
      }
    }
    return i;
  };
  const parseStrings = (chunk, i) => {
    for (; i < chunk.length; i++) {
      const c = chunk[i];
      if (!inString) {
        if (c === 34) {
          inString = true;
          escaped = false;
          parts = [];
        } else if (c === 93) {
          section = 'done';
          return chunk.length;
        }
        continue;
      }
      let j = i;
      for (; j < chunk.length; j++) {
        const d = chunk[j];
        if (escaped) {
          escaped = false;
        } else if (d === 92) {
          escaped = true;
        } else if (d === 34) {
          break;
        }
      }
      parts.push(chunk.subarray(i, j));
      if (j === chunk.length) {
        return j;
      }
      const raw = Buffer.concat(parts).toString('utf8');
      let text;
      try {
        text = JSON.parse(`"${raw}"`);
      } catch {
        text = raw;
      }
      // Only labels are needed; long source texts would fill the heap.
      strings.push(text.length > 300 ? text.slice(0, 300) : text);
      inString = false;
      parts = null;
      i = j;
    }
    return i;
  };
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file, { highWaterMark: 1 << 24 });
    stream.on('data', chunk => {
      let i = 0;
      while (i < chunk.length) {
        if (section === 'nodes' || section === 'edges') {
          i = parseNumbers(chunk, i);
        } else if (section === 'strings') {
          i = parseStrings(chunk, i);
        } else if (section === 'done') {
          i = chunk.length;
        } else {
          for (; i < chunk.length; i++) {
            tail = (tail + String.fromCharCode(chunk[i])).slice(-16);
            const key = ['nodes', 'edges', 'strings'].find(name => tail.endsWith(`"${name}":[`));
            if (key) {
              section = key;
              target = key === 'nodes' ? nodes : key === 'edges' ? edges : null;
              pos = 0;
              i++;
              break;
            }
          }
        }
      }
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  if (section !== 'done') {
    console.error(`${file} ends before its strings: is DevTools still writing it?`);
    process.exit(1);
  }
  log(`${strings.length} strings`);
}

const TYPE = nodeFields.indexOf('type'),
  NAME = nodeFields.indexOf('name'),
  SIZE = nodeFields.indexOf('self_size'),
  EDGES = nodeFields.indexOf('edge_count'),
  DETACHED = nodeFields.indexOf('detachedness');
const EDGE_TYPE = edgeFields.indexOf('type'),
  EDGE_NAME = edgeFields.indexOf('name_or_index'),
  EDGE_TO = edgeFields.indexOf('to_node');
const WEAK = edgeTypes.indexOf('weak'),
  ELEMENT = edgeTypes.indexOf('element');
const NAMED_EDGES = new Set(['context', 'property', 'internal', 'shortcut'].map(type => edgeTypes.indexOf(type)));

const first = new Uint32Array(nodeCount + 1);
for (let v = 0, total = 0; v <= nodeCount; v++) {
  first[v] = total;
  if (v < nodeCount) {
    total += nodes[v * N + EDGES];
  }
}
const typeOf = v => nodeTypes[nodes[v * N + TYPE]];
const nameOf = v => strings[nodes[v * N + NAME]] ?? '?';
const sizeOf = v => nodes[v * N + SIZE];
const targetOf = k => edges[k * E + EDGE_TO] / N;
const isString = type => type === 'string' || type === 'concatenated string' || type === 'sliced string';
const label = v => {
  const type = typeOf(v);
  if (isString(type) || ['number', 'code', 'hidden', 'object shape'].includes(type)) {
    return isString(type) ? 'string' : type;
  }
  return `${type} ${String(nameOf(v)).slice(0, 80).replace(/\s+/g, ' ')}`;
};
const edgeName = k =>
  NAMED_EDGES.has(edges[k * E + EDGE_TYPE])
    ? String(strings[edges[k * E + EDGE_NAME]]).slice(0, 60)
    : `[${edges[k * E + EDGE_NAME]}]`;
const childNamed = (v, name) => {
  for (let k = first[v]; k < first[v + 1]; k++) {
    if (edgeName(k) === name) {
      return targetOf(k);
    }
  }
  return -1;
};
const elementsOf = v => {
  const out = [];
  for (let k = v < 0 ? 0 : first[v]; v >= 0 && k < first[v + 1]; k++) {
    if (edges[k * E + EDGE_TYPE] === ELEMENT) {
      out.push(targetOf(k));
    }
  }
  return out;
};

// ---- Totals.
{
  let total = 0,
    detached = 0;
  const byType = new Map(),
    byLabel = new Map();
  for (let v = 0; v < nodeCount; v++) {
    const size = sizeOf(v);
    total += size;
    byType.set(typeOf(v), (byType.get(typeOf(v)) ?? 0) + size);
    const entry = byLabel.get(label(v)) ?? [0, 0];
    entry[0] += size;
    entry[1]++;
    byLabel.set(label(v), entry);
    if (DETACHED >= 0 && nodes[v * N + DETACHED] === 2) {
      detached++;
    }
  }
  console.log(`total self size ${mb(total).trim()}, ${nodeCount} nodes, ${detached} detached DOM nodes`);
  console.log('\n-- self size by node type');
  for (const [type, size] of [...byType].sort((a, b) => b[1] - a[1])) {
    console.log(mb(size), type);
  }
  console.log(`\n-- top ${TOP} self size by class`);
  for (const [name, [size, count]] of [...byLabel].sort((a, b) => b[1][0] - a[1][0]).slice(0, TOP)) {
    console.log(mb(size), String(count).padStart(9), name);
  }
}

// ---- Dominator tree (Cooper, Harvey and Kennedy) over a postorder from the synthetic root, ignoring weak edges.
const order = new Int32Array(nodeCount).fill(-1);
const post = new Uint32Array(nodeCount);
let reachable = 0;
{
  const stackNode = new Uint32Array(nodeCount),
    stackEdge = new Uint32Array(nodeCount),
    seen = new Uint8Array(nodeCount);
  let depth = 1;
  stackEdge[0] = first[0];
  seen[0] = 1;
  while (depth) {
    const v = stackNode[depth - 1],
      k = stackEdge[depth - 1];
    if (k < first[v + 1]) {
      stackEdge[depth - 1] = k + 1;
      const w = targetOf(k);
      if (edges[k * E + EDGE_TYPE] !== WEAK && !seen[w]) {
        seen[w] = 1;
        stackNode[depth] = w;
        stackEdge[depth] = first[w];
        depth++;
      }
    } else {
      depth--;
      order[v] = reachable;
      post[reachable++] = v;
    }
  }
}
const R = reachable,
  ROOT = order[0];
const predStart = new Uint32Array(R + 1);
const forEachStrongEdge = visit => {
  for (let v = 0; v < nodeCount; v++) {
    if (order[v] < 0) {
      continue;
    }
    for (let k = first[v]; k < first[v + 1]; k++) {
      if (edges[k * E + EDGE_TYPE] !== WEAK && order[targetOf(k)] >= 0) {
        visit(order[v], order[targetOf(k)], k);
      }
    }
  }
};
forEachStrongEdge((_from, to) => predStart[to + 1]++);
for (let b = 0; b < R; b++) {
  predStart[b + 1] += predStart[b];
}
const preds = new Uint32Array(predStart[R]),
  predEdges = new Uint32Array(predStart[R]),
  filled = new Uint32Array(R);
forEachStrongEdge((from, to, k) => {
  const slot = predStart[to] + filled[to]++;
  preds[slot] = from;
  predEdges[slot] = k;
});
const idom = new Int32Array(R).fill(-1);
idom[ROOT] = ROOT;
for (let changed = true; changed; ) {
  changed = false;
  for (let b = R - 2; b >= 0; b--) {
    let dominator = -1;
    for (let s = predStart[b]; s < predStart[b + 1]; s++) {
      let p = preds[s];
      if (idom[p] === -1) {
        continue;
      }
      if (dominator !== -1) {
        let q = dominator;
        while (p !== q) {
          while (p < q) {
            p = idom[p];
          }
          while (q < p) {
            q = idom[q];
          }
        }
      }
      dominator = p;
    }
    if (dominator !== -1 && idom[b] !== dominator) {
      idom[b] = dominator;
      changed = true;
    }
  }
}
const retained = new Float64Array(R);
for (let b = 0; b < R; b++) {
  retained[b] = sizeOf(post[b]);
}
for (let b = 0; b < R - 1; b++) {
  if (idom[b] >= 0) {
    retained[idom[b]] += retained[b];
  }
}
// Distances from the roots, for short retainer paths.
const distance = new Int32Array(R).fill(-1);
{
  const queue = new Uint32Array(R);
  let headIndex = 0,
    tailIndex = 0;
  queue[tailIndex++] = ROOT;
  distance[ROOT] = 0;
  while (headIndex < tailIndex) {
    const b = queue[headIndex++],
      v = post[b];
    for (let k = first[v]; k < first[v + 1]; k++) {
      const w = order[targetOf(k)];
      if (edges[k * E + EDGE_TYPE] !== WEAK && w >= 0 && distance[w] < 0) {
        distance[w] = distance[b] + 1;
        queue[tailIndex++] = w;
      }
    }
  }
}
log('dominator tree built');
/** One shortest retainer path from `b` towards the roots: [owner postorder index, edge index] steps. */
const retainers = (b, limit = 12) => {
  const steps = [];
  for (let current = b; current !== ROOT && steps.length < limit; ) {
    let best = -1,
      bestEdge = -1;
    for (let s = predStart[current]; s < predStart[current + 1]; s++) {
      if (distance[preds[s]] === distance[current] - 1) {
        best = preds[s];
        bestEdge = predEdges[s];
        if (typeOf(post[best]) !== 'hidden') {
          break;
        }
      }
    }
    if (best < 0) {
      break;
    }
    steps.push([best, bestEdge]);
    current = best;
  }
  return steps;
};

// ---- Largest objects and classes by retained size.
{
  const candidates = [];
  for (let b = 0; b < R; b++) {
    if (retained[b] > 1e6 && typeOf(post[b]) !== 'synthetic') {
      candidates.push(b);
    }
  }
  candidates.sort((a, b) => retained[b] - retained[a]);
  console.log(`\n-- top ${TOP} objects by retained size, with a retainer path`);
  const perLabel = new Map();
  let shown = 0;
  for (const b of candidates) {
    const name = label(post[b]);
    // Nested containers of one object repeat its size; show at most three of a kind.
    if ((perLabel.get(name) ?? 0) >= 3) {
      continue;
    }
    perLabel.set(name, (perLabel.get(name) ?? 0) + 1);
    console.log(`\n${mb(retained[b])} retained  ${name}`);
    for (const [owner, k] of retainers(b, 10)) {
      console.log(`      <- ${label(post[owner])} .${edgeName(k)}`);
    }
    if (++shown >= TOP) {
      break;
    }
  }
  console.log(`\n-- top ${TOP} classes by retained size (outermost instance of each class)`);
  const byClass = new Map();
  for (let b = 0; b < R; b++) {
    const type = typeOf(post[b]);
    if (!['object', 'native', 'closure', 'array'].includes(type)) {
      continue;
    }
    const name = label(post[b]);
    let nested = false;
    for (let d = idom[b], hops = 0; d >= 0 && d !== ROOT && hops < 64; d = idom[d], hops++) {
      if (label(post[d]) === name) {
        nested = true;
        break;
      }
    }
    if (!nested) {
      const entry = byClass.get(name) ?? [0, 0];
      entry[0] += retained[b];
      entry[1]++;
      byClass.set(name, entry);
    }
  }
  for (const [name, [size, count]] of [...byClass].sort((a, b) => b[1][0] - a[1][0]).slice(0, TOP)) {
    console.log(mb(size), String(count).padStart(9), name);
  }
}

// ---- ArrayBuffer bytes by owner: the first module variable (closure context slot) on the retainer path, else the
// outermost named owner, with the field that holds the typed array.
if (option('buffers')) {
  const SKIPPED = new Set(['buffer', 'backing_store', 'table', 'reactions_or_result', 'elements']);
  const groups = new Map();
  let total = 0;
  for (let b = 0; b < R; b++) {
    const v = post[b];
    if (typeOf(v) !== 'native' || nameOf(v) !== 'system / JSArrayBufferData') {
      continue;
    }
    const names = [];
    for (const [owner, k] of retainers(b, 24)) {
      const field = edgeName(k);
      if (/^\[\d+\]$/.test(field) || SKIPPED.has(field) || field.includes(' / part of key')) {
        continue;
      }
      const type = typeOf(post[owner]);
      const ownerName = ['object', 'native', 'closure'].includes(type)
        ? String(nameOf(post[owner])).slice(0, 40)
        : type;
      names.push(`${ownerName}.${field}`);
      if (names.length >= 7) {
        break;
      }
    }
    const moduleVariable = names.find(name => name.startsWith('system / Context.'));
    const key = `${moduleVariable ?? names.at(-1) ?? '(unnamed)'}  [${names[0] ?? ''}]`;
    const entry = groups.get(key) ?? [0, 0, 0];
    entry[0] += sizeOf(v);
    entry[1]++;
    entry[2] = Math.max(entry[2], sizeOf(v));
    groups.set(key, entry);
    total += sizeOf(v);
  }
  console.log(`\n-- ArrayBuffer backing stores by owner, ${mb(total).trim()} in total (owner [field])`);
  for (const [key, [size, count, largest]] of [...groups].sort((a, b) => b[1][0] - a[1][0]).slice(0, TOP)) {
    console.log(mb(size), String(count).padStart(6), `max ${mb(largest).trim()}`.padStart(14), ' ', key);
  }
}

/** Promise entries of every module-scope Map held in a closure context slot called `name`. */
const cacheEntries = name => {
  const caches = [];
  for (let v = 0; v < nodeCount; v++) {
    if (typeOf(v) !== 'object' || nameOf(v) !== 'system / Context') {
      continue;
    }
    const map = childNamed(v, name);
    const table = map >= 0 && nameOf(map) === 'Map' ? childNamed(map, 'table') : -1;
    if (table < 0) {
      continue;
    }
    const entries = [];
    let key = null;
    for (let k = first[table]; k < first[table + 1]; k++) {
      const w = targetOf(k);
      if (isString(typeOf(w))) {
        key = String(nameOf(w));
      } else if (key !== null) {
        entries.push({ key, value: w });
        key = null;
      }
    }
    caches.push({ map, entries });
  }
  return caches;
};
const shortUrl = url => url.replace(/^https?:\/\/[^/]+/, '').replace(/\n/g, ' ');

for (const name of CACHE_NAMES) {
  for (const { map, entries } of cacheEntries(name)) {
    const sized = entries.map(({ key, value: w }) => [order[w] >= 0 ? retained[order[w]] : 0, key]);
    sized.sort((a, b) => b[0] - a[0]);
    console.log(`\n-- ${name}: Map with ${entries.length} entries, ${mb(retained[order[map]] ?? 0).trim()} retained`);
    for (const [size, key] of sized.slice(0, TOP)) {
      console.log(mb(size), shortUrl(key).slice(0, 110));
    }
  }
}

// ---- The animation archive cache's build atlases: what each page still keeps on the CPU.
if (option('atlases')) {
  const bytesOf = typed => {
    const buffer = typed >= 0 ? childNamed(typed, 'buffer') : -1;
    const store = buffer >= 0 ? childNamed(buffer, 'backing_store') : -1;
    return store >= 0 ? sizeOf(store) : 0;
  };
  const pages = [];
  for (const { entries } of cacheEntries('requests')) {
    for (const { key, value } of entries) {
      const result = key.includes('\nbuild') ? childNamed(value, 'reactions_or_result') : -1;
      const atlases = result >= 0 ? childNamed(result, 'atlases') : -1;
      for (const [index, atlas] of elementsOf(atlases).entries()) {
        pages.push({
          build: shortUrl(key),
          index,
          pixels: bytesOf(childNamed(atlas, 'pixels')),
          blocks: bytesOf(childNamed(atlas, 'blocks')),
          alpha: bytesOf(childNamed(atlas, 'alpha')),
        });
      }
    }
  }
  const sum = field => pages.reduce((total, page) => total + page[field], 0);
  const held = field => pages.filter(page => page[field] > 0).length;
  console.log(`\n-- animation archive cache: ${pages.length} build atlas pages`);
  for (const field of ['pixels', 'blocks', 'alpha']) {
    console.log(`${mb(sum(field))} ${field.padEnd(6)} on ${held(field)} pages`);
  }
  console.log('\n   pages still holding RGBA or BC blocks (not released after a GPU upload):');
  const holding = pages.filter(page => page.pixels || page.blocks);
  holding.sort((a, b) => Math.max(b.pixels, b.blocks) - Math.max(a.pixels, a.blocks));
  for (const page of holding.slice(0, TOP)) {
    console.log(
      `   ${page.build.padEnd(56)} #${page.index}  pixels ${mb(page.pixels).trim().padStart(8)}` +
        `  blocks ${mb(page.blocks).trim().padStart(8)}  alpha ${mb(page.alpha).trim()}`,
    );
  }
}
log('done');
