import { signalMemoryProbe } from './signalMemoryProbe.ts';

// 定义双向绑定的类型
export type SignalListener<T> = (value: T, previous: T) => void;

export interface ReadonlySignal<T> {
  get(): T;
  /** Read without making the current effect depend on this signal. */
  peek(): T;
  /**
   * Observe each change synchronously as (next, previous); not called on subscribe. Inside a batch every change is
   * delivered in order after the outer batch commits. Setting an identical (===) value notifies nobody.
   */
  subscribe(listener: SignalListener<T>): () => void;
}

export interface Signal<T> extends ReadonlySignal<T> {
  set(value: T): void;
}

export function readonlySignal<T>(signal: ReadonlySignal<T>): ReadonlySignal<T> {
  return { get: signal.get, peek: signal.peek, subscribe: signal.subscribe };
}

/**
 * Every game entity holds dozens of signals and effects, so their containers are allocated on first use: a signal
 * without subscribers, an effect without onCleanUp and an observer scope without consumers carry no empty collections.
 *
 * A dependency link is recorded on both sides as (peer, index of this side's entry in the peer's list). Most lists hold
 * a single link, so each side keeps one link inline (the peer in the list field, its reverse index in the slot field)
 * and switches to an array of pairs [peer, reverse index, ...] only when a second link arrives. An inline link is
 * entry 0, so switching keeps every recorded index. Once a list is an array it stays one: an effect rerun clears and
 * refills it without reallocating.
 */
type Effect = {
  /** The body, run through runEffect(); effects carry no runner closure of their own. */
  fn: () => void;
  cleanups: (() => void)[] | undefined;
  /** No link, one inline signal node (reverse index in `depSlot`), or pairs [signal node, reverse index]. */
  deps: SignalNode | (SignalNode | number)[] | undefined;
  /** For an inline dep: this effect's index in that node's subscribers. */
  depSlot: number;
  disposed: boolean;
  synchronous: boolean;
  /** A createMemo's computation: inside a batch, a read of any memo runs it before reading. */
  memo: true | undefined;
  owners: Set<SignalObserverScope> | undefined;
};

/** Class-local signals retain observer ownership even when an effect changes dependencies. */
type SignalObserverScope = {
  stopped: boolean;
  effects: Set<Effect> | undefined;
  listeners: Set<() => void> | undefined;
};

type SignalNode = {
  /** No link, one inline effect (reverse index in `slot`), or pairs [effect, reverse index]. */
  subscribers: Effect | (Effect | number)[] | undefined;
  /** For an inline subscriber: this signal's index in that effect's deps. */
  slot: number;
};

let activeEffect: Effect | null = null;
let batchDepth = 0;
/** Memo computations whose inputs changed inside the current batch. */
const pendingDerived = new Set<Effect>();
/** Render effects and watchSignal bridges whose inputs changed inside the current batch. */
const pendingMemos = new Set<Effect>();
const pendingListeners: (() => void)[] = [];

/** Recompute the memos a batch has changed, so a memo read inside the batch sees the current inputs. */
function settleDerived(): void {
  while (pendingDerived.size) {
    const effects = [...pendingDerived];
    pendingDerived.clear();
    for (const effect of effects) {
      runEffect(effect);
    }
  }
}

function settleMemos(): void {
  while (pendingDerived.size || pendingMemos.size) {
    settleDerived();
    const effects = [...pendingMemos];
    pendingMemos.clear();
    for (const effect of effects) {
      runEffect(effect);
    }
  }
}

/** Commit inputs and dependent memos before notifying synchronous subscribers. */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    if (batchDepth > 1) {
      batchDepth--;
    } else {
      try {
        settleMemos();
      } finally {
        batchDepth--;
      }
      const notifications = pendingListeners.splice(0);
      for (const notify of notifications) {
        notify();
      }
    }
  }
}

export function onCleanUp(fn: () => void) {
  if (activeEffect) {
    (activeEffect.cleanups ??= []).push(fn);
  } else {
    console.warn('onCleanUp 必须在 createEffect 的同步执行上下文中调用！');
  }
}

/**
 * Runs fn once synchronously now. After a dependency changes, fn reruns in a microtask: changes in the same burst
 * coalesce into one rerun that reads the latest values, and inside batch() it is still the microtask, not the commit.
 * Chained effects settle in the same microtask drain. Disposing cancels a queued rerun.
 * Full table: packages/signals/AGENTS.md "Effect scheduling" (pinned by tests/schedulingContract.test.ts).
 */
export function createEffect(fn: () => void, synchronous = false) {
  return createEffectInternal(fn, synchronous);
}

function createEffectInternal(fn: () => void, synchronous: boolean) {
  const effect = newEffect(fn, synchronous, undefined);
  startEffect(effect);
  return () => disposeEffect(effect);
}

function newEffect(fn: () => void, synchronous: boolean, memo: true | undefined): Effect {
  return {
    memo,
    deps: undefined,
    depSlot: 0,
    cleanups: undefined,
    disposed: false,
    synchronous,
    owners: undefined,
    fn,
  };
}

/** Unlink the effect from its previous run, then run its body with it as the tracking effect. */
function runEffect(effect: Effect): void {
  if (effect.disposed) {
    return;
  }
  cleanup(effect);
  // A cleanup may dispose its own effect.
  if (effect.disposed) {
    return;
  }
  const parentEffect = activeEffect;
  activeEffect = effect;
  try {
    effect.fn();
  } finally {
    activeEffect = parentEffect;
  }
}

/** First run, synchronous; an effect whose first run throws is released. */
function startEffect(effect: Effect): void {
  try {
    runEffect(effect);
  } catch (error) {
    disposeEffect(effect);
    throw error;
  }
}

/**
 * Runs fn once synchronously now, then synchronously on each dependency change instead of in the microtask queue.
 * Inside a batch it runs once after the batch commits, together with memos. See AGENTS.md "Effect scheduling".
 */
export function createRenderEffect(fn: () => void) {
  return createEffect(fn, true);
}

function disposeEffect(effect: Effect): void {
  if (effect.disposed) {
    return;
  }
  effect.disposed = true;
  pendingMemos.delete(effect);
  pendingDerived.delete(effect);
  queue.delete(effect);
  for (const owner of effect.owners ?? []) {
    owner.effects?.delete(effect);
  }
  effect.owners?.clear();
  cleanup(effect);
}

// 优化 1：直接接收初始值，简化 API
export function createSignal<T>(initialValue: T): Signal<T> {
  return createSignalInternal(initialValue);
}

function createSignalInternal<T>(initialValue: T, owner?: SignalObserverScope): Signal<T> {
  let _state = initialValue;
  let listeners: Set<SignalListener<T>> | undefined;
  /** Created by the first tracked read; effects keep it in their deps until they clean up. */
  let signalObj: SignalNode | undefined;

  function setState(newValue: T) {
    if (_state === newValue) {
      return;
    } // 优化：值没变就不触发更新
    const previous = _state;
    _state = newValue;

    if (signalObj) {
      scheduleSubscribers(signalObj);
    }
    if (!listeners?.size) {
      return;
    }
    const current = listeners;
    for (const listener of [...current]) {
      const notify = () => {
        if (current.has(listener)) {
          listener(newValue, previous);
        }
      };
      if (batchDepth > 0) {
        pendingListeners.push(notify);
      } else {
        notify();
      }
    }
  }

  function getState() {
    if (activeEffect) {
      if (owner && !owner.stopped) {
        (owner.effects ??= new Set()).add(activeEffect);
        (activeEffect.owners ??= new Set()).add(owner);
      }
      link(activeEffect, (signalObj ??= { subscribers: undefined, slot: 0 }));
    }
    return _state;
  }

  const signal: Signal<T> = {
    get: getState,
    set: setState,
    peek: () => _state,
    subscribe(listener) {
      const current = (listeners ??= new Set());
      current.add(listener);
      const stop = () => {
        current.delete(listener);
        owner?.listeners?.delete(stop);
      };
      if (owner && !owner.stopped) {
        (owner.listeners ??= new Set()).add(stop);
      }
      return stop;
    },
  };
  signalMemoryProbe()?.(owner ? 'watched' : 'plain', signal.get, signal.set, signal.peek, signal.subscribe);
  return signal;
}

function cleanup(effect: Effect) {
  const errors: unknown[] = [];
  // A cleanup may dispose its own class; remove callbacks before invoking them.
  for (const fn of effect.cleanups?.length ? effect.cleanups.splice(0) : []) {
    try {
      fn();
    } catch (error) {
      errors.push(error);
    }
  }
  const { deps } = effect;
  if (Array.isArray(deps)) {
    for (let i = 0; i < deps.length; i += 2) {
      unlinkSubscriber(deps[i] as SignalNode, deps[i + 1] as number);
    }
    // Keep the array for the rerun to refill.
    if (deps.length) {
      deps.length = 0;
    }
  } else if (deps !== undefined) {
    unlinkSubscriber(deps, effect.depSlot);
    effect.deps = undefined;
  }
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Failed to clean up effect');
  }
}

function scheduleSubscribers(node: SignalNode): void {
  const { subscribers } = node;
  if (Array.isArray(subscribers)) {
    // A synchronous rerun relinks its effect, so walk a snapshot unless the first entry is the only one read.
    const current = subscribers.length > 2 ? subscribers.slice() : subscribers;
    for (let i = 0, count = current.length; i < count; i += 2) {
      schedule(current[i] as Effect);
    }
  } else if (subscribers !== undefined) {
    schedule(subscribers);
  }
}

function schedule(effect: Effect): void {
  if (effect === activeEffect || effect.disposed) {
    return;
  }
  if (!effect.synchronous) {
    enqueue(effect);
  } else if (batchDepth === 0) {
    runEffect(effect);
  } else if (effect.memo) {
    pendingDerived.add(effect);
  } else {
    pendingMemos.add(effect);
  }
}

/** Record that effect read node: append an entry on each side holding its index in the other side's list. */
function link(effect: Effect, node: SignalNode): void {
  const { deps } = effect;
  const { subscribers } = node;
  const effectIndex = deps === undefined ? 0 : Array.isArray(deps) ? deps.length >> 1 : 1;
  const signalIndex = subscribers === undefined ? 0 : Array.isArray(subscribers) ? subscribers.length >> 1 : 1;

  if (subscribers === undefined) {
    node.subscribers = effect;
    node.slot = effectIndex;
  } else if (Array.isArray(subscribers)) {
    subscribers.push(effect, effectIndex);
  } else {
    node.subscribers = [subscribers, node.slot, effect, effectIndex];
  }

  if (deps === undefined) {
    effect.deps = node;
    effect.depSlot = signalIndex;
  } else if (Array.isArray(deps)) {
    deps.push(node, signalIndex);
  } else {
    effect.deps = [deps, effect.depSlot, node, signalIndex];
  }
}

/** Remove a node's subscriber entry, moving its last entry into the gap and updating that effect's reverse index. */
function unlinkSubscriber(node: SignalNode, index: number): void {
  const { subscribers } = node;
  if (!Array.isArray(subscribers)) {
    node.subscribers = undefined;
    return;
  }
  const lastIndex = (subscribers.length >> 1) - 1;
  if (index !== lastIndex) {
    const lastEffect = subscribers[lastIndex * 2] as Effect;
    const depIndex = subscribers[lastIndex * 2 + 1] as number;
    if (Array.isArray(lastEffect.deps)) {
      lastEffect.deps[depIndex * 2 + 1] = index;
    } else {
      lastEffect.depSlot = index;
    }
    subscribers[index * 2] = lastEffect;
    subscribers[index * 2 + 1] = depIndex;
  }
  subscribers.length -= 2;
}

/** createEffect reruns waiting for the microtask; a Set coalesces repeated changes into one rerun. */
const queue = new Set<Effect>();
let running = false;

function enqueue(effect: Effect) {
  queue.add(effect);
  _run();
}

// 核心：事件循环
function _run() {
  if (running) {
    return;
  } // 已在运行，直接退出
  running = true;
  Promise.resolve().then(() => {
    while (queue.size) {
      const effects = [...queue];
      queue.clear();

      for (const effect of effects) {
        runEffect(effect);
      }
    }
    running = false;
  });
}

/** Callable, cached derived signal; dispose releases its input subscriptions. */
export interface Memo<T> extends ReadonlySignal<T> {
  (): T;
  dispose(): void;
}

/**
 * Group a class's observers behind one source subscription, returning a standard writable signal.
 * Any ordinary effect/memo that reads local.get(), and any local.subscribe() listener, belongs
 * to this local lifetime. The single registered cleanup stops them and the source bridge.
 * Keep this signal private to its owner: disposing it stops entire consumer effects.
 * While `active` is false the bridge does not read the source, so it holds no subscription to it and the
 * local value stays at its last synced value; when `active` turns true the bridge resubscribes and syncs.
 */
export function watchSignal<T>(
  source: ReadonlySignal<T>,
  registerCleanup: (stop: () => void) => void,
  active?: ReadonlySignal<boolean>,
): Signal<T> {
  const owner: SignalObserverScope = { stopped: false, effects: undefined, listeners: undefined };
  const local = createSignalInternal(source.peek(), owner);
  const stop = createEffect(() => {
    if (active && !active.get()) {
      return;
    }
    local.set(source.get());
  }, true);
  const dispose = () => {
    if (owner.stopped) {
      return;
    }
    owner.stopped = true;
    const errors: unknown[] = [];
    const release = (fn: () => void) => {
      try {
        fn();
      } catch (error) {
        errors.push(error);
      }
    };
    for (const unsubscribe of [...(owner.listeners ?? [])]) {
      release(unsubscribe);
    }
    for (const effect of [...(owner.effects ?? [])]) {
      release(() => disposeEffect(effect));
    }
    // Retain the final local value on removal inside a game-time transaction.
    release(settleMemos);
    release(stop);
    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Failed to stop watched signal');
    }
  };
  try {
    registerCleanup(dispose);
  } catch (error) {
    dispose();
    throw error;
  }
  return local;
}

/**
 * Derived value, recomputed synchronously on each dependency change, so reads are current. Inside a batch a change
 * only marks it pending; reading any memo recomputes the pending ones first, so reads stay current there too, while its
 * subscribers and the render effects reading it still wait for the commit. See AGENTS.md "Effect scheduling".
 */
export function createMemo<T>(fn: () => T): Memo<T> {
  // The memo is its own source: it caches the value and holds its downstream links, without a backing signal.
  let value: T | undefined;
  /** Downstream links, created by the first tracked read like a signal's. */
  let node: SignalNode | undefined;
  let listeners: Set<SignalListener<T>> | undefined;
  /** While a commit notification is queued: the value before the current batch. */
  let commitQueued = false;
  let beforeBatch: T | undefined;
  let disposed = false;

  // Derived values stay current within a game frame; presentation effects
  // still use the normal microtask queue to batch their work.
  const compute = () => {
    const newValue = fn();
    const previous = value as T;
    if (newValue === previous) {
      return;
    }
    value = newValue;
    if (node) {
      scheduleSubscribers(node);
    }
    if (!listeners?.size) {
      return;
    }
    if (batchDepth === 0) {
      notifyListeners(listeners, newValue, previous);
      return;
    }
    // Recomputed for reads inside the batch: subscribers hear once, at the commit, of the net change.
    if (commitQueued) {
      return;
    }
    commitQueued = true;
    beforeBatch = previous;
    pendingListeners.push(() => {
      const before = beforeBatch as T;
      commitQueued = false;
      beforeBatch = undefined;
      if (value !== before) {
        notifyListeners(listeners!, value as T, before);
      }
    });
  };
  const effect = newEffect(compute, true, true);
  startEffect(effect);

  const read = () => {
    if (pendingDerived.size) {
      settleDerived();
    }
    if (activeEffect) {
      link(activeEffect, (node ??= { subscribers: undefined, slot: 0 }));
    }
    return value as T;
  };
  const memo = Object.assign(read, {
    get: read,
    peek: () => {
      if (pendingDerived.size) {
        settleDerived();
      }
      return value as T;
    },
    subscribe: (listener: SignalListener<T>) => {
      const current = (listeners ??= new Set());
      current.add(listener);
      return () => {
        current.delete(listener);
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      // A timer callback may remove an entity inside an outer batch. Preserve
      // its final derived snapshot before releasing the pending dependencies.
      try {
        settleMemos();
      } finally {
        disposeEffect(effect);
      }
    },
  });
  signalMemoryProbe()?.('memo', effect, memo, memo.peek, memo.subscribe, memo.dispose);
  return memo;
}

function notifyListeners<T>(listeners: Set<SignalListener<T>>, value: T, previous: T): void {
  for (const listener of [...listeners]) {
    if (listeners.has(listener)) {
      listener(value, previous);
    }
  }
}
