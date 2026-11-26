import { signalMemoryProbe } from './signalMemoryProbe.ts';

/** Observe a signal with an effect (createRenderEffect for synchronous work); signals have no listener API. */
export interface ReadonlySignal<T> {
  /** The current value, making the running effect depend on this signal. */
  get(): T;
  /** The current value, read without making the current effect depend on this signal. */
  readonly value: T;
}

export interface Signal<T> extends ReadonlySignal<T> {
  set(value: T): void;
}

/** The signal itself, typed without `set`: the owner keeps the write. */
export function readonlySignal<T>(signal: ReadonlySignal<T>): ReadonlySignal<T> {
  return signal;
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
  /** NOT_MEMO, or DEFERRED while a render effect waits for a settle loop; a createMemo computation: MEMO, MEMO_QUEUED. */
  memo: number;
  /** The watchSignal scopes that own this effect: none, one inline, or several. */
  owners: SignalObserverScope | SignalObserverScope[] | undefined;
};

type SignalNode = {
  /** No link, one inline effect (reverse index in `slot`), or pairs [effect, reverse index]. */
  subscribers: Effect | (Effect | number)[] | undefined;
  /** For an inline subscriber: this signal's index in that effect's deps. */
  slot: number;
};

/**
 * A watchSignal's one node: the local signal's downstream links, and the lifetime that owns every effect that has read
 * it. Ownership outlives the links, so an effect that switched away from the local signal is still released with it.
 * Effects and owners are recorded one inline, several in an array; each pair is recorded once, on the effect's first
 * read.
 */
type SignalObserverScope = SignalNode & {
  stopped: boolean;
  effects: Effect | Effect[] | undefined;
};

let activeEffect: Effect | null = null;
let batchDepth = 0;
// An effect's `memo` state. Effects below MEMO are not memos.
const NOT_MEMO = 0;
/** A render effect a settle loop deferred, waiting in the deferred queue. */
const DEFERRED = 1;
const MEMO = 2;
const MEMO_QUEUED = 3;
/**
 * Memo computations whose inputs changed, in order, in slots `derivedHead` to `derivedTail`; the array keeps its
 * storage and a consumed slot is cleared. A memo is queued once (its `memo` state marks it), and an entry whose memo
 * was taken by a nested settle, or that was disposed, is skipped.
 */
const derivedQueue: (Effect | undefined)[] = [];
let derivedHead = 0;
let derivedTail = 0;

function hasPendingDerived(): boolean {
  return derivedHead < derivedTail;
}
/** Render effects and watchSignal bridges whose inputs changed inside the current batch. */
const pendingMemos = new Set<Effect>();
/**
 * Outside a batch, the render effects a settle loop changed, run in order once it ends; the same head/tail queue as the
 * memos', deduped by the DEFERRED state.
 */
const deferredQueue: (Effect | undefined)[] = [];
let deferredHead = 0;
let deferredTail = 0;

function runDeferred(): void {
  try {
    // A deferred effect's write settles its memos and drains this same queue; the loop then finds it empty.
    while (deferredHead < deferredTail) {
      const effect = takeDeferred();
      if (effect.memo === DEFERRED) {
        effect.memo = NOT_MEMO;
        runEffect(effect);
      }
    }
  } finally {
    clearDeferred();
  }
}

function takeDeferred(): Effect {
  const effect = deferredQueue[deferredHead]!;
  deferredQueue[deferredHead++] = undefined;
  return effect;
}

function clearDeferred(): void {
  // A throwing effect ends this flush. Release the queue so later writes only run their own observers.
  while (deferredHead < deferredTail) {
    const effect = takeDeferred();
    if (effect.memo === DEFERRED) {
      effect.memo = NOT_MEMO;
    }
  }
  deferredTail = deferredHead = 0;
}

/** Whether settleDerived() is running; a write inside it leaves its memos to that loop. */
let settlingDerived = false;

/**
 * Recompute the pending memos in one loop, so a chain of memos settles without nesting a call per level. A memo whose
 * input changes during the loop joins it, and one that reads a pending memo settles the pending ones first, so a memo
 * below a diamond computes once, from settled inputs.
 */
function settleDerived(): void {
  const outer = settlingDerived;
  settlingDerived = true;
  try {
    // A nested settle (a memo reading a pending memo) drains the same queue; this loop then finds it empty.
    while (derivedHead < derivedTail) {
      const effect = derivedQueue[derivedHead]!;
      derivedQueue[derivedHead++] = undefined;
      if (effect.memo === MEMO_QUEUED) {
        effect.memo = MEMO;
        runEffect(effect);
      }
    }
    derivedTail = 0;
    derivedHead = 0;
  } finally {
    settlingDerived = outer;
  }
}

/** Outside a batch, a write returns only after the memos it changed have settled. */
function flushDerived(): void {
  if (settlingDerived) {
    return;
  }
  // Memos settle before the write returns, inside a batch too, so a memo's `value` is always current. A write's
  // render effects run after its memos, including render effects that also read the source directly.
  if (hasPendingDerived()) {
    try {
      settleDerived();
    } catch (error) {
      clearDeferred();
      throw error;
    }
  }
  if (batchDepth === 0) {
    runDeferred();
  }
}

function settleMemos(): void {
  while (hasPendingDerived() || pendingMemos.size) {
    settleDerived();
    const effects = [...pendingMemos];
    pendingMemos.clear();
    for (const effect of effects) {
      runEffect(effect);
    }
  }
}

/** Commit inputs, then settle dependent memos and run the render effects the batch changed, once each. */
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
    }
  }
}

/**
 * Run fn without making the current effect depend on what it reads. An effect that reacts to one signal runs its
 * work through this, so the work's own reads (and the watchSignal scopes behind them) do not own or rerun the effect.
 */
export function untrack<T>(fn: () => T): T {
  const parentEffect = activeEffect;
  activeEffect = null;
  try {
    return fn();
  } finally {
    activeEffect = parentEffect;
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
export function createEffect(fn: () => void): () => void {
  return createEffectInternal(fn, false);
}

function createEffectInternal(fn: () => void, synchronous: boolean) {
  const effect = newEffect(fn, synchronous, NOT_MEMO);
  startEffect(effect);
  return () => disposeEffect(effect);
}

function newEffect(fn: () => void, synchronous: boolean, memo: number): Effect {
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

/**
 * The running effect's position in its deps: reads matching the previous run's entries in order keep their links, a
 * read that differs replaces the entry at this position, and the entries past it when the run ends are unlinked.
 */
let depCursor = 0;

/** Run the effect's cleanups, then its body as the tracking effect, keeping the links it reads again. */
function runEffect(effect: Effect): void {
  if (effect.disposed) {
    return;
  }
  if (effect.cleanups?.length) {
    const errors = runCleanups(effect);
    if (errors) {
      unlinkDeps(effect, 0);
      throwCleanupErrors(errors);
    }
    // A cleanup may dispose its own effect.
    if (effect.disposed) {
      return;
    }
  }
  const parentEffect = activeEffect;
  const parentCursor = depCursor;
  activeEffect = effect;
  depCursor = 0;
  try {
    if (effect.memo >= MEMO) {
      computeMemo(effect as MemoNode<unknown>);
    } else {
      effect.fn();
    }
  } finally {
    const read = depCursor;
    activeEffect = parentEffect;
    depCursor = parentCursor;
    if (!effect.disposed) {
      unlinkDeps(effect, read);
    }
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
  return createEffectInternal(fn, true);
}

function disposeEffect(effect: Effect): void {
  if (effect.disposed) {
    return;
  }
  effect.disposed = true;
  pendingMemos.delete(effect);
  // A queued memo stays in the derived queue; runEffect() skips it once disposed.
  queue.delete(effect);
  const { owners } = effect;
  if (owners !== undefined) {
    effect.owners = undefined;
    if (Array.isArray(owners)) {
      for (const owner of owners) {
        releaseFromScope(owner, effect);
      }
    } else {
      releaseFromScope(owners, effect);
    }
  }
  cleanup(effect);
}

/** Record that scope owns effect, once per pair. */
function adopt(scope: SignalObserverScope, effect: Effect): void {
  const { owners } = effect;
  if (owners === undefined) {
    effect.owners = scope;
  } else if (owners === scope) {
    return;
  } else if (!Array.isArray(owners)) {
    effect.owners = [owners, scope];
  } else if (owners.includes(scope)) {
    return;
  } else {
    owners.push(scope);
  }
  const { effects } = scope;
  if (effects === undefined) {
    scope.effects = effect;
  } else if (Array.isArray(effects)) {
    effects.push(effect);
  } else {
    scope.effects = [effects, effect];
  }
}

function releaseFromScope(scope: SignalObserverScope, effect: Effect): void {
  const { effects } = scope;
  if (effects === effect) {
    scope.effects = undefined;
  } else if (Array.isArray(effects)) {
    const index = effects.indexOf(effect);
    if (index >= 0) {
      effects[index] = effects[effects.length - 1];
      effects.pop();
    }
  }
}

// 优化 1：直接接收初始值，简化 API
export function createSignal<T>(initialValue: T): Signal<T> {
  return createSignalInternal(initialValue);
}

/** A signal's own object: the value is a plain field, so only get and set are closures. */
type SignalObject<T> = { get(): T; set(value: T): void; value: T };

/** `extra` fields are built into the signal's own object, so a caller that hands out more than the signal needs no wrapper. */
function createSignalInternal<T, E extends object = object>(
  initialValue: T,
  owner?: SignalObserverScope,
  extra?: E,
): Signal<T> & E {
  /** Created by the first tracked read (a watched signal's is its scope); effects keep it in their deps until cleanup. */
  let signalObj: SignalNode | undefined = owner;

  function setState(newValue: T) {
    if (signal.value === newValue) {
      return;
    } // 优化：值没变就不触发更新
    signal.value = newValue;
    if (signalObj?.subscribers !== undefined) {
      scheduleSubscribers(signalObj);
      flushDerived();
    }
  }

  function getState() {
    if (activeEffect) {
      if (owner && !owner.stopped) {
        adopt(owner, activeEffect);
      }
      track(activeEffect, (signalObj ??= { subscribers: undefined, slot: 0 }));
    }
    return signal.value;
  }

  const signal: SignalObject<T> & E = extra
    ? { get: getState, set: setState, value: initialValue, ...extra }
    : ({ get: getState, set: setState, value: initialValue } as SignalObject<T> & E);
  signalMemoryProbe()?.(owner ? 'watched' : 'plain', signal, signal.get, signal.set);
  return signal;
}

/** Release the effect: its cleanups run and every link is removed. */
function cleanup(effect: Effect) {
  const errors = effect.cleanups?.length ? runCleanups(effect) : undefined;
  unlinkDeps(effect, 0);
  effect.deps = undefined;
  if (errors) {
    throwCleanupErrors(errors);
  }
}

/** The errors the cleanups threw, if any. A cleanup may dispose its own class; callbacks are removed first. */
function runCleanups(effect: Effect): unknown[] | undefined {
  let errors: unknown[] | undefined;
  for (const fn of effect.cleanups!.splice(0)) {
    try {
      fn();
    } catch (error) {
      (errors ??= []).push(error);
    }
  }
  return errors;
}

function throwCleanupErrors(errors: unknown[]): never {
  throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'Failed to clean up effect');
}

function depCount(deps: Effect['deps']): number {
  return deps === undefined ? 0 : Array.isArray(deps) ? deps.length >> 1 : 1;
}

/** The running effect read node: keep the link at the cursor if it is the same node, else replace it there. */
function track(effect: Effect, node: SignalNode): void {
  const { deps } = effect;
  const count = depCount(deps);
  // A nested rerun of this effect may have shortened its deps.
  const position = depCursor < count ? depCursor : count;
  // Only the prefix belongs to this run. Its edges may already be followed by the same node from the previous run.
  if (position > 0) {
    if (Array.isArray(deps)) {
      for (let index = 0; index < position * 2; index += 2) {
        if (deps[index] === node) {
          return;
        }
      }
    } else if (deps === node) {
      return;
    }
  }
  depCursor = position + 1;
  if (position < count) {
    if (Array.isArray(deps)) {
      if (deps[position * 2] === node) {
        return;
      }
      unlinkSubscriber(deps[position * 2] as SignalNode, deps[position * 2 + 1] as number);
    } else {
      if (deps === node) {
        return;
      }
      unlinkSubscriber(deps!, effect.depSlot);
    }
  }
  link(effect, node, position);
}

/** Unlink the effect's entries from `from` on and drop them; an array keeps its storage for the next run. */
function unlinkDeps(effect: Effect, from: number): void {
  const { deps } = effect;
  if (Array.isArray(deps)) {
    if (deps.length <= from * 2) {
      return;
    }
    for (let i = from * 2; i < deps.length; i += 2) {
      unlinkSubscriber(deps[i] as SignalNode, deps[i + 1] as number);
    }
    deps.length = from * 2;
  } else if (deps !== undefined && from === 0) {
    unlinkSubscriber(deps, effect.depSlot);
    effect.deps = undefined;
  }
}

function scheduleSubscribers(node: SignalNode): void {
  const { subscribers } = node;
  if (Array.isArray(subscribers)) {
    // Scheduling never invokes a subscriber here, so the original list is stable during the walk.
    for (let i = 0; i < subscribers.length; i += 2) {
      schedule(subscribers[i] as Effect);
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
  } else if (effect.memo >= MEMO) {
    // Settled by the write's flushDerived(), the enclosing settle loop or a memo read.
    if (effect.memo === MEMO) {
      effect.memo = MEMO_QUEUED;
      derivedQueue[derivedTail++] = effect;
    }
  } else if (batchDepth > 0) {
    pendingMemos.add(effect);
  } else if (effect.memo === NOT_MEMO) {
    // The write settles its memo updates before running any render effect.
    effect.memo = DEFERRED;
    deferredQueue[deferredTail++] = effect;
  }
}

/**
 * Link effect to node as the effect's entry at `position` (an unlinked or new entry: at most one past its last), and
 * append the node's entry; each holds its index in the other side's list.
 */
function link(effect: Effect, node: SignalNode, position: number): void {
  const { subscribers } = node;
  const signalIndex = subscribers === undefined ? 0 : Array.isArray(subscribers) ? subscribers.length >> 1 : 1;

  if (subscribers === undefined) {
    node.subscribers = effect;
    node.slot = position;
  } else if (Array.isArray(subscribers)) {
    subscribers.push(effect, position);
  } else {
    node.subscribers = [subscribers, node.slot, effect, position];
  }

  const { deps } = effect;
  if (Array.isArray(deps)) {
    deps[position * 2] = node;
    deps[position * 2 + 1] = signalIndex;
  } else if (position === 0) {
    effect.deps = node;
    effect.depSlot = signalIndex;
  } else {
    effect.deps = [deps!, effect.depSlot, node, signalIndex];
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

/** Cached derived signal; dispose releases its input subscriptions. */
export interface Memo<T> extends ReadonlySignal<T> {
  dispose(): void;
}

/**
 * Group a class's observers behind one source subscription, returning a standard writable signal.
 * Any ordinary effect/memo that reads local.get() belongs to this local lifetime. The single
 * registered cleanup stops them and the source bridge.
 * Keep this signal private to its owner: disposing it stops entire consumer effects.
 * While `active` is false the bridge does not read the source, so it holds no subscription to it and the
 * local value stays at its last synced value; when `active` turns true the bridge resubscribes and syncs.
 */
export function watchSignal<T>(
  source: ReadonlySignal<T>,
  registerCleanup: (stop: () => void) => void,
  active?: ReadonlySignal<boolean>,
): Signal<T> {
  return watchSignalWith(source, registerCleanup, active, undefined);
}

/** A watch's source effect, owned observers and downstream signal links share a lifetime. */
class WatchNode<T> implements Effect, SignalObserverScope {
  deps: Effect['deps'] = undefined;
  depSlot = 0;
  subscribers: SignalNode['subscribers'] = undefined;
  slot = 0;
  cleanups: Effect['cleanups'] = undefined;
  owners: Effect['owners'] = undefined;
  effects: SignalObserverScope['effects'] = undefined;
  disposed = false;
  stopped = false;
  synchronous = true;
  memo = NOT_MEMO;
  local?: Signal<T>;
  source?: ReadonlySignal<T>;
  active?: ReadonlySignal<boolean>;

  constructor(source: ReadonlySignal<T>, active: ReadonlySignal<boolean> | undefined) {
    this.source = source;
    this.active = active;
  }

  fn(): void {
    if (this.source && (!this.active || this.active.get())) {
      this.local!.set(this.source.get());
    }
  }

  stopBridge(): void {
    try {
      disposeEffect(this);
    } finally {
      this.source = this.active = this.local = undefined;
    }
  }
}

/** watchSignal whose returned signal also carries `extra`'s fields (world content's scheduler and clocks). */
export function watchSignalWith<T, E extends object>(
  source: ReadonlySignal<T>,
  registerCleanup: (stop: () => void) => void,
  active: ReadonlySignal<boolean> | undefined,
  extra: E | undefined,
): Signal<T> & E {
  const owner = new WatchNode(source, active);
  const local = (owner.local = createSignalInternal(source.value, owner, extra));
  startEffect(owner);
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
    const { effects } = owner;
    for (const effect of Array.isArray(effects) ? effects.slice() : effects ? [effects] : []) {
      release(() => disposeEffect(effect));
    }
    // Retain the final local value on removal inside a game-time transaction.
    release(settleMemos);
    release(() => owner.stopBridge());
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

/** A disposing memo retains its latest snapshot, including any pending watch bridges in its inputs. */
function settleWatchedInputs(effect: Effect, visited: Set<Effect>): void {
  if (visited.has(effect)) {
    return;
  }
  visited.add(effect);
  const follow = (input: SignalNode) => {
    if (input instanceof MemoNode || input instanceof WatchNode) {
      settleWatchedInputs(input, visited);
    }
  };
  const { deps } = effect;
  if (Array.isArray(deps)) {
    for (let index = 0; index < deps.length; index += 2) {
      follow(deps[index] as SignalNode);
    }
  } else if (deps) {
    follow(deps);
  }
  if (effect instanceof WatchNode && pendingMemos.delete(effect)) {
    runEffect(effect);
  }
}

/** One node tracks the computation's inputs and acts as the source for consumers of its result. */
class MemoNode<T> implements Effect, SignalNode, Memo<T> {
  value = undefined as T;
  deps: Effect['deps'] = undefined;
  depSlot = 0;
  subscribers: SignalNode['subscribers'] = undefined;
  slot = 0;
  cleanups: Effect['cleanups'] = undefined;
  owners: Effect['owners'] = undefined;
  disposed = false;
  synchronous = true;
  memo = MEMO;

  readonly fn: () => T;

  constructor(fn: () => T) {
    this.fn = fn;
  }

  readonly get = (): T => {
    // A memo computing in the settle loop can read a queued input before the loop reaches it.
    if (hasPendingDerived()) {
      settleDerived();
    }
    if (activeEffect) {
      track(activeEffect, this);
    }
    return this.value;
  };

  // Kept as a function property so a caller can keep the original disposer while adding owner cleanup.
  dispose = (): void => {
    if (this.disposed) {
      return;
    }
    try {
      if (batchDepth > 0 && pendingMemos.size) {
        settleWatchedInputs(this, new Set());
      }
    } finally {
      disposeEffect(this);
    }
  };
}

function computeMemo<T>(memo: MemoNode<T>): void {
  const { fn } = memo;
  const value = fn();
  if (value !== memo.value) {
    memo.value = value;
    if (memo.subscribers !== undefined) {
      scheduleSubscribers(memo);
    }
  }
}

/** A pure derived value settled before the write that invalidates it returns. */
export function createMemo<T>(fn: () => T): Memo<T> {
  const memo = new MemoNode(fn);
  startEffect(memo);
  signalMemoryProbe()?.('memo', memo);
  return memo;
}
