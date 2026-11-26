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
  const signalScopes = new Set();
  const memoScopes = new Set();

  // Establish the factory scopes from their named functions and script, not from the shape of arbitrary objects.
  for (let node = 0; node < nodeCount; node++) {
    if (typeOf(node) !== 'closure') {
      continue;
    }
    const name = nameOf(node);
    if (name !== 'getState' && name !== 'setState' && name !== 'read' && name !== 'dispose') {
      continue;
    }
    const context = contextOf(node);
    const scope = scopeOf(context);
    if (scope < 0 || !SIGNAL_SCRIPT.test(nameOf(childNamed(childNamed(node, 'shared'), 'script')))) {
      continue;
    }
    if (name === 'getState' || name === 'setState') {
      signalScopes.add(scope);
    } else if (childNamed(context, 'commitQueued') >= 0) {
      memoScopes.add(scope);
    }
  }

  const signals = new Map();
  const memos = new Map();
  for (let node = 0; node < nodeCount; node++) {
    if (!nameOf(node).startsWith('system / Context')) {
      continue;
    }
    const scope = scopeOf(node);
    if (signalScopes.has(scope)) {
      const dependency = childNamed(node, 'signalObj');
      const owner = childNamed(node, 'owner');
      const watched = owner >= 0 && typeOf(owner) === 'object';
      const bytes =
        size(node) +
        setBytes(childNamed(node, 'listeners')) +
        (typeOf(dependency) === 'object' ? size(dependency) : 0) +
        arrayBytes(childNamed(dependency, 'subscribers')) +
        // A watched signal's scope is also its downstream node, counted above when it is the same object.
        (watched
          ? (owner === dependency ? 0 : size(owner)) +
            arrayBytes(childNamed(owner, 'effects')) +
            setBytes(childNamed(owner, 'listeners'))
          : 0);
      signals.set(node, { bytes, watched, wrapperBytes: 0 });
    } else if (memoScopes.has(scope)) {
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

  const lazy = [];
  for (let node = 0; node < nodeCount; node++) {
    const type = typeOf(node);
    if (type === 'closure') {
      const context = contextOf(node);
      const signal = signals.get(context);
      if (signal) {
        signal.bytes += ownBytes(node);
      } else if (memos.has(context)) {
        memos.set(context, memos.get(context) + ownBytes(node));
      }
    } else if (type === 'object' && nameOf(node) === 'Object') {
      const getter = childNamed(node, 'get');
      const setter = childNamed(node, 'set');
      const context = contextOf(getter);
      const signal = signals.get(context);
      if (
        signal &&
        nameOf(getter) === 'getState' &&
        nameOf(setter) === 'setState' &&
        contextOf(setter) === context &&
        contextOf(childNamed(node, 'peek')) === context &&
        contextOf(childNamed(node, 'subscribe')) === context
      ) {
        // Read-only facades can outlive the original wrapper. Aliases still point to the same signal scope.
        const bytes = ownBytes(node);
        signal.wrapperBytes = signal.wrapperBytes ? Math.min(signal.wrapperBytes, bytes) : bytes;
      }
    } else if (type === 'object' && nameOf(node) === 'LazySignal') {
      const inner = childNamed(node, '#signal');
      if (inner >= 0) {
        lazy.push({ bytes: ownBytes(node) + arrayBytes(childNamed(node, '#listeners')), inner });
      }
    }
  }

  const buckets = { plain: [], watched: [], memo: [], lazyDeclared: [], lazyUndeclared: [] };
  const takeBacking = wrapper => {
    const context = contextOf(childNamed(wrapper, 'get'));
    const signal = signals.get(context);
    if (!signal) {
      throw new Error('Could not match the backing signal to its factory scope');
    }
    signals.delete(context);
    return signal.bytes + signal.wrapperBytes;
  };
  buckets.memo.push(...memos.values());
  for (const { bytes, inner } of lazy) {
    if (typeOf(inner) === 'object') {
      buckets.lazyDeclared.push(bytes + takeBacking(inner));
    } else {
      buckets.lazyUndeclared.push(bytes);
    }
  }
  for (const { bytes, watched, wrapperBytes } of signals.values()) {
    buckets[watched ? 'watched' : 'plain'].push(bytes + wrapperBytes);
  }
  return {
    total: summarize(Object.values(buckets).flat()),
    kinds: Object.fromEntries(Object.entries(buckets).map(([kind, sizes]) => [kind, summarize(sizes)])),
  };
}
