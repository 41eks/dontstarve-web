const SIGNAL_SCRIPT = /\/packages\/signals\/src\/signal\.(?:ts|js)(?:[?#].*)?$/;

function summarize(sizes) {
  const histogram = new Map();
  let totalBytes = 0;
  for (const bytes of sizes) {
    totalBytes += bytes;
    histogram.set(bytes, (histogram.get(bytes) ?? 0) + 1);
  }
  const distribution = [...histogram].sort(([a], [b]) => a - b).map(([bytes, count]) => ({ bytes, count }));
  const percentile = fraction => {
    let rank = Math.ceil(sizes.length * fraction);
    for (const { bytes, count } of distribution) {
      rank -= count;
      if (rank <= 0) {
        return bytes;
      }
    }
    return null;
  };
  return {
    count: sizes.length,
    totalBytes,
    averageBytes: sizes.length ? totalBytes / sizes.length : null,
    p50Bytes: percentile(0.5),
    p95Bytes: percentile(0.95),
    maxBytes: distribution.at(-1)?.bytes ?? null,
    distribution,
  };
}

/** Attribute shallow heap bytes to each logical signal without following values or subscribing callbacks. */
export function signalHeapStats({ nodeCount, typeOf, nameOf, sizeOf, childNamed }) {
  const size = node => (node < 0 ? 0 : sizeOf(node));
  const contextOf = closure => childNamed(closure, 'context');
  const arrayBytes = array => (nameOf(array) === 'Array' ? size(array) + size(childNamed(array, 'elements')) : 0);
  const ownBytes = node => size(node) + size(childNamed(node, 'properties'));
  // A writable signal is a WritableSignal instance (a subclass for world content) with get and set on the prototype.
  const SIGNAL_CLASSES = new Set(['WritableSignal', 'WatchedWorldContent']);
  const signals = new Map();
  const memos = [];
  const lazy = [];
  for (let node = 0; node < nodeCount; node++) {
    const type = typeOf(node);
    if (type === 'object' && SIGNAL_CLASSES.has(nameOf(node))) {
      // A watched signal's downstream node is its watch scope, which also holds the source bridge and owned readers.
      const owner = childNamed(node, 'owner');
      const watched = owner >= 0 && typeOf(owner) === 'object';
      signals.set(node, {
        watched,
        bytes:
          ownBytes(node) +
          arrayBytes(childNamed(node, 'subscribers')) +
          (watched
            ? size(owner) + arrayBytes(childNamed(owner, 'effects')) + arrayBytes(childNamed(owner, 'subscribers'))
            : 0),
      });
    } else if (type === 'object' && nameOf(node) === 'MemoNode') {
      const getter = childNamed(node, 'get');
      const dispose = childNamed(node, 'dispose');
      if (!SIGNAL_SCRIPT.test(nameOf(childNamed(childNamed(getter, 'shared'), 'script')))) {
        continue;
      }
      const contexts = new Set([contextOf(getter), contextOf(dispose)]);
      memos.push(
        ownBytes(node) +
          ownBytes(getter) +
          ownBytes(dispose) +
          [...contexts].reduce((sum, context) => sum + size(context), 0) +
          arrayBytes(childNamed(node, 'subscribers')),
      );
    } else if (type === 'object' && nameOf(node) === 'LazySignal') {
      const inner = childNamed(node, '#signal');
      if (inner >= 0) {
        lazy.push({ bytes: ownBytes(node) + arrayBytes(childNamed(node, '#listeners')), inner });
      }
    }
  }

  const buckets = { plain: [], watched: [], memo: memos, lazyDeclared: [], lazyUndeclared: [] };
  for (const { bytes, inner } of lazy) {
    const backing = signals.get(inner);
    if (backing) {
      signals.delete(inner);
      buckets.lazyDeclared.push(bytes + backing.bytes);
    } else if (typeOf(inner) === 'object') {
      throw new Error('Could not match the backing signal of a LazySignal');
    } else {
      buckets.lazyUndeclared.push(bytes);
    }
  }
  for (const { bytes, watched } of signals.values()) {
    buckets[watched ? 'watched' : 'plain'].push(bytes);
  }
  return {
    total: summarize(Object.values(buckets).flat()),
    kinds: Object.fromEntries(Object.entries(buckets).map(([kind, sizes]) => [kind, summarize(sizes)])),
  };
}
