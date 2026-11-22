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
 * A dependency link is one pair in each side's single array, rather than one entry in each of two parallel arrays.
 */
type Effect = {
  runner: () => void;
  cleanups: (() => void)[] | undefined;
  /** Pairs [signal node, index of this effect's pair in that node's `subscribers`]. */
  deps: (SignalNode | number)[];
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
  /** Pairs [subscribed effect, index of this signal's pair in that effect's `deps`]. */
  subscribers: (Effect | number)[];
};

let activeEffect: Effect | null = null;
/** The deps of an effect that has not read a signal yet; never written, replaced by the first link. */
const NO_DEPS: (SignalNode | number)[] = [];
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
      effect.runner();
    }
  }
}

function settleMemos(): void {
  while (pendingDerived.size || pendingMemos.size) {
    settleDerived();
    const effects = [...pendingMemos];
    pendingMemos.clear();
    for (const effect of effects) {
      effect.runner();
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

function createEffectInternal(fn: () => void, synchronous: boolean, memo?: true) {
  // 构造出一个标准的 Effect 对象
  const effect: Effect = {
    memo,
    deps: NO_DEPS, // 初始化空账本：首次依赖时换成自己的数组
    cleanups: undefined,
    disposed: false,
    synchronous,
    owners: undefined,
    runner: () => {
      if (effect.disposed) {
        return;
      }
      // ✨ 核心清理动作：执行前，先把自己从所有旧的 Signal 依赖中清除
      cleanup(effect);
      if (effect.disposed) {
        return;
      }

      // 处理嵌套，保存上一层的 Effect 对象
      const parentEffect = activeEffect;
      activeEffect = effect; // 把当前整个对象推上“激活”宝座

      try {
        fn(); // 执行用户传入的真实逻辑
      } finally {
        activeEffect = parentEffect; // 恢复上一层
      }
    },
  };

  // 初始化时，手动调用对象的 runner 触发第一次执行
  try {
    effect.runner();
  } catch (error) {
    disposeEffect(effect);
    throw error;
  }

  return () => disposeEffect(effect);
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
  queue.delete(effect.runner);
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

    const currentSubscribers = signalObj?.subscribers.length ? [...signalObj.subscribers] : [];

    for (let i = 0; i < currentSubscribers.length; i += 2) {
      const effect = currentSubscribers[i] as Effect;
      if (effect != activeEffect && !effect.disposed) {
        if (effect.synchronous) {
          if (batchDepth === 0) {
            effect.runner();
          } else if (effect.memo) {
            pendingDerived.add(effect);
          } else {
            pendingMemos.add(effect);
          }
        } else {
          enqueue(effect.runner);
        }
      }
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
      // 获取在彼此数组中即将推入的配对下标
      const effectIndex = activeEffect.deps.length >> 1;
      const signalIndex = signalObj ? signalObj.subscribers.length >> 1 : 0;

      // 1. Signal 记录 Effect 以及 Effect 的下标。The first link is an exact-size literal: most signals keep one or
      // two subscribers, and a first push would reserve sixteen slots.
      if (signalObj) {
        signalObj.subscribers.push(activeEffect, effectIndex);
      } else {
        signalObj = { subscribers: [activeEffect, effectIndex] };
      }

      // 2. Effect 记录 Signal 以及 Signal 的下标
      if (activeEffect.deps === NO_DEPS) {
        activeEffect.deps = [signalObj, signalIndex];
      } else {
        activeEffect.deps.push(signalObj, signalIndex);
      }
    }
    return _state;
  }

  return {
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
  // NO_DEPS is never written: an effect that has read nothing has nothing to unlink.
  const { deps } = effect;
  for (let i = 0; i < deps.length; i += 2) {
    const subscribers = (deps[i] as SignalNode).subscribers;
    const signalIndex = deps[i + 1] as number; // 当前 effect 在这个 signal 里的配对位置
    const lastIndex = (subscribers.length >> 1) - 1;

    // 如果要删的正好是最后一个，直接截断就行。如果不是，就把末尾的配对挪到空位上。
    if (signalIndex !== lastIndex) {
      const lastEffect = subscribers[lastIndex * 2] as Effect;
      const sourceIndex = subscribers[lastIndex * 2 + 1] as number;
      lastEffect.deps[sourceIndex * 2 + 1] = signalIndex; // effect的新位置是 signalIndex 了
      subscribers[signalIndex * 2] = lastEffect;
      subscribers[signalIndex * 2 + 1] = sourceIndex;
    }
    subscribers.length -= 2;
  }

  // 清空自己的账本，等待下一次运行重新收集
  if (deps.length) {
    deps.length = 0;
  }
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Failed to clean up effect');
  }
}

// const queue: Array<() => void> = [];
// 用 Set 完美解决重复添加的问题
const queue: Set<() => void> = new Set();
let running = false;

// 添加任务并触发循环
function enqueue(fn: () => void) {
  queue.add(fn);
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
      const tasks = [...queue];
      queue.clear();

      for (const task of tasks) {
        task();
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
  const memoState = createSignal<T | undefined>(undefined);
  let listeners: Set<SignalListener<T>> | undefined;
  /** The value before the current batch, while a commit notification is queued. */
  let beforeBatch: { value: T } | undefined;
  const notify = (value: T, previous: T) => {
    const current = listeners;
    if (!current) {
      return;
    }
    for (const listener of [...current]) {
      if (current.has(listener)) {
        listener(value, previous);
      }
    }
  };

  // Derived values stay current within a game frame; presentation effects
  // still use the normal microtask queue to batch their work.
  const stop = createEffectInternal(
    () => {
      const newValue = fn();
      const previous = memoState.peek() as T;
      if (newValue === previous) {
        return;
      }
      memoState.set(newValue);
      if (!listeners?.size) {
        return;
      }
      if (batchDepth === 0) {
        notify(newValue, previous);
        return;
      }
      // Recomputed for reads inside the batch: subscribers hear once, at the commit, of the net change.
      if (beforeBatch) {
        return;
      }
      beforeBatch = { value: previous };
      pendingListeners.push(() => {
        const { value: before } = beforeBatch!;
        beforeBatch = undefined;
        const value = memoState.peek() as T;
        if (value !== before) {
          notify(value, before);
        }
      });
    },
    true,
    true,
  );
  let disposed = false;

  const read = () => {
    if (pendingDerived.size) {
      settleDerived();
    }
    return memoState.get() as T;
  };
  return Object.assign(read, {
    get: read,
    peek: () => {
      if (pendingDerived.size) {
        settleDerived();
      }
      return memoState.peek() as T;
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
        stop();
      }
    },
  });
}
