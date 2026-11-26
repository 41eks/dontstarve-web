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
  const scopeOf = context => childNamed(context, 'scope_info');
  const arrayBytes = array => (nameOf(array) === 'Array' ? size(array) + size(childNamed(array, 'elements')) : 0);
  const setBytes = set => (nameOf(set) === 'Set' ? size(set) + size(childNamed(set, 'table')) : 0);
  const ownBytes = node => size(node) + size(childNamed(node, 'properties'));
  const memoScopes = new Set();

  // A memo is identified by its read closure in the signal script, not by the shape of arbitrary objects.
  for (let node = 0; node < nodeCount; node++) {
    if (typeOf(node) !== 'closure' || nameOf(node) !== 'read') {
      continue;
    }
    const context = contextOf(node);
    const scope = scopeOf(context);
    if (
      scope >= 0 &&
      SIGNAL_SCRIPT.test(nameOf(childNamed(childNamed(node, 'shared'), 'script'))) &&
      childNamed(context, 'commitQueued') >= 0
    ) {
      memoScopes.add(scope);
    }
  }

  // A writable signal is one WritableSignal object (its own downstream node) with shared prototype methods.
  const signals = new Map();
  const memos = new Map();
  const lazy = [];
  for (let node = 0; node < nodeCount; node++) {
    const type = typeOf(node);
    if (type === 'object' && nameOf(node) === 'WritableSignal') {
      const owner = childNamed(node, 'owner');
      const watched = owner >= 0 && typeOf(owner) === 'object';
      signals.set(node, {
        watched,
        bytes:
          ownBytes(node) +
          setBytes(childNamed(node, 'listeners')) +
          arrayBytes(childNamed(node, 'subscribers')) +
          (watched
            ? size(owner) + arrayBytes(childNamed(owner, 'effects')) + setBytes(childNamed(owner, 'listeners'))
            : 0),
      });
    } else if (type === 'object' && nameOf(node) === 'LazySignal') {
      const inner = childNamed(node, '#signal');
      if (inner >= 0) {
        lazy.push({ bytes: ownBytes(node) + arrayBytes(childNamed(node, '#listeners')), inner });
      }
    } else if (nameOf(node).startsWith('system / Context') && memoScopes.has(scopeOf(node))) {
      // A memo is its own source: its downstream node and its computation effect belong to it.
      const dependency = childNamed(node, 'node');
      const effect = childNamed(node, 'effect');
      memos.set(
        node,
        size(node) +
          setBytes(childNamed(node, 'listeners')) +
          (typeOf(dependency) === 'object' ? size(dependency) : 0) +
          arrayBytes(childNamed(dependency, 'subscribers')) +
          (typeOf(effect) === 'object' ? size(effect) : 0),
      );
    }
  }
  for (let node = 0; node < nodeCount; node++) {
    if (typeOf(node) === 'closure') {
      const context = contextOf(node);
      if (memos.has(context)) {
        memos.set(context, memos.get(context) + ownBytes(node));
      }
    }
  }

  const buckets = { plain: [], watched: [], memo: [...memos.values()], lazyDeclared: [], lazyUndeclared: [] };
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
