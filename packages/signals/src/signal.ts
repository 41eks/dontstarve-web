

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

type Effect = {
    runner: () => void;
    cleanups: (() => void)[];
    deps: any[];            // 存它依赖的 Signal 对象
    depsIndices: number[];  // 存它在各个 Signal.subscribers 数组里的下标
    disposed: boolean;
    synchronous: boolean;
    owners?: Set<SignalObserverScope>;
};

/** Class-local signals retain observer ownership even when an effect changes dependencies. */
type SignalObserverScope = {
    stopped: boolean;
    effects: Set<Effect>;
    listeners: Set<() => void>;
};

type SignalNode = {
    subscribers: Effect[];       // 存订阅了它的 Effect
    subscriberIndices: number[]; // 存各个 Effect 把该 Signal 记在 deps 里的下标
};

let activeEffect: Effect | null = null;
let batchDepth = 0;
const pendingMemos = new Set<Effect>();
const pendingListeners: (() => void)[] = [];

function settleMemos(): void {
    while (pendingMemos.size) {
        const effects = [...pendingMemos];
        pendingMemos.clear();
        for (const effect of effects) effect.runner();
    }
}

/** Commit inputs and dependent memos before notifying synchronous subscribers. */
export function batch<T>(fn: () => T): T {
    batchDepth++;
    try {
        return fn();
    } finally {
        if (batchDepth > 1) batchDepth--;
        else {
            try {
                settleMemos();
            } finally { batchDepth--; }
            const notifications = pendingListeners.splice(0);
            for (const notify of notifications) notify();
        }
    }
}

export function onCleanUp(fn: () => void) {
    if (activeEffect) {
        activeEffect.cleanups.push(fn);
    } else {
        console.warn("onCleanUp 必须在 createEffect 的同步执行上下文中调用！");
    }

}

/**
 * Runs fn once synchronously now. After a dependency changes, fn reruns in a microtask: changes in the same burst
 * coalesce into one rerun that reads the latest values, and inside batch() it is still the microtask, not the commit.
 * Chained effects settle in the same microtask drain. Disposing cancels a queued rerun.
 * Full table: packages/signals/AGENTS.md "Effect scheduling" (pinned by tests/schedulingContract.test.ts).
 */
export function createEffect(fn: () => void, synchronous = false) {
    // 构造出一个标准的 Effect 对象
    const effect: Effect = {
        deps: [], // 初始化空账本
        depsIndices: [],
        cleanups: [],
        disposed: false,
        synchronous,
        runner: () => {
            if (effect.disposed) return;
            // ✨ 核心清理动作：执行前，先把自己从所有旧的 Signal 依赖中清除
            cleanup(effect);
            if (effect.disposed) return;

            // 处理嵌套，保存上一层的 Effect 对象
            const parentEffect = activeEffect;
            activeEffect = effect; // 把当前整个对象推上“激活”宝座

            try {
                fn(); // 执行用户传入的真实逻辑
            } finally {
                activeEffect = parentEffect; // 恢复上一层
            }
        }
    };

    // 初始化时，手动调用对象的 runner 触发第一次执行
    try { effect.runner(); }
    catch (error) { disposeEffect(effect); throw error; }

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
    if (effect.disposed) return;
    effect.disposed = true;
    pendingMemos.delete(effect);
    queue.delete(effect.runner);
    for (const owner of effect.owners ?? []) owner.effects.delete(effect);
    effect.owners?.clear();
    cleanup(effect);
}


// 优化 1：直接接收初始值，简化 API
export function createSignal<T>(initialValue: T): Signal<T> {
    return createSignalInternal(initialValue);
}

function createSignalInternal<T>(initialValue: T, owner?: SignalObserverScope): Signal<T> {
    let _state = initialValue;
    const listeners = new Set<SignalListener<T>>();
    const signalObj: SignalNode = {
        subscribers: [], subscriberIndices: []
    }

    function setState(newValue: T) {
        if (_state === newValue) return; // 优化：值没变就不触发更新
        const previous = _state;
        _state = newValue;

        const currentSubscribers = [...signalObj.subscribers];
        // const currentSubscribers = signalObj.subscribers;

        for (let i = 0; i < currentSubscribers.length; i++) {
            const effect = currentSubscribers[i];
            if (effect != activeEffect && !effect.disposed) {
                if (effect.synchronous) {
                    if (batchDepth > 0) pendingMemos.add(effect);
                    else effect.runner();
                }
                else enqueue(effect.runner);
            }
        }
        for (const listener of [...listeners]) {
            const notify = () => { if (listeners.has(listener)) listener(newValue, previous); };
            if (batchDepth > 0) pendingListeners.push(notify);
            else notify();
        }
    }

    function getState() {
        if (activeEffect) {
            if (owner && !owner.stopped) {
                owner.effects.add(activeEffect);
                (activeEffect.owners ??= new Set()).add(owner);
            }
            // 获取在彼此数组中即将推入的下标
            const effectIndex = activeEffect.deps.length;
            const signalIndex = signalObj.subscribers.length;

            // 1. Signal 记录 Effect 以及 Effect 的下标
            signalObj.subscribers.push(activeEffect);
            signalObj.subscriberIndices.push(effectIndex);

            // 2. Effect 记录 Signal 以及 Signal 的下标
            activeEffect.deps.push(signalObj);
            activeEffect.depsIndices.push(signalIndex);
        }
        return _state;
    }

    return {
        get: getState, set: setState, peek: () => _state,
        subscribe(listener) {
            listeners.add(listener);
            const stop = () => { listeners.delete(listener); owner?.listeners.delete(stop); };
            if (owner && !owner.stopped) owner.listeners.add(stop);
            return stop;
        },
    };
};


function cleanup(effect: Effect) {
    const errors: unknown[] = [];
    // A cleanup may dispose its own class; remove callbacks before invoking them.
    for (const fn of effect.cleanups.splice(0)) {
        try { fn(); } catch (error) { errors.push(error); }
    }
    const { deps, depsIndices } = effect;

    for (let i = 0; i < deps.length; i++) {
        const signal = deps[i] as SignalNode;
        const signalIndex = depsIndices[i]; // 当前 effect 在这个 signal 里的位置

        const subscribers = signal.subscribers;
        const subscriberIndices = signal.subscriberIndices;

        const lastIndex = subscribers.length - 1;
        const lastEffect = subscribers[lastIndex];

        // 如果要删的正好是最后一个，直接 pop 就行。如果不是，就执行替换。
        if (signalIndex !== lastIndex) {
            const sourceIndex = subscriberIndices[lastIndex];
            lastEffect.depsIndices[sourceIndex] = signalIndex; // effect的新位置是 signalIndex 了
            // 1. 将末尾的effect挪到要删除的空位上
            subscribers[signalIndex] = subscribers[lastIndex];//j
            subscriberIndices[signalIndex] = subscriberIndices[lastIndex];
        }

        // 3. 丢弃末尾（因为它已经被挪走了，或者它就是要被删的本身）
        subscribers.pop();
        subscriberIndices.pop();
    }

    // 清空自己的账本，等待下一次运行重新收集
    deps.length = 0;
    depsIndices.length = 0;
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Failed to clean up effect');
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
    if (running) return; // 已在运行，直接退出
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
};


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
export function watchSignal<T>(source: ReadonlySignal<T>, registerCleanup: (stop: () => void) => void,
    active?: ReadonlySignal<boolean>): Signal<T> {
    const owner: SignalObserverScope = { stopped: false, effects: new Set(), listeners: new Set() };
    const local = createSignalInternal(source.peek(), owner);
    const stop = createEffect(() => {
        if (active && !active.get()) return;
        local.set(source.get());
    }, true);
    const dispose = () => {
        if (owner.stopped) return;
        owner.stopped = true;
        const errors: unknown[] = [];
        const release = (fn: () => void) => { try { fn(); } catch (error) { errors.push(error); } };
        for (const unsubscribe of [...owner.listeners]) release(unsubscribe);
        for (const effect of [...owner.effects]) release(() => disposeEffect(effect));
        // Retain the final local value on removal inside a game-time transaction.
        release(settleMemos);
        release(stop);
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, 'Failed to stop watched signal');
    };
    try { registerCleanup(dispose); }
    catch (error) { dispose(); throw error; }
    return local;
}

/**
 * Derived value, recomputed synchronously on each dependency change, so reads are current; inside a batch it reads
 * the pre-batch value until the batch commits. See AGENTS.md "Effect scheduling".
 */
export function createMemo<T>(fn: () => T): Memo<T> {
    const memoState = createSignal<T | undefined>(undefined);

    // Derived values stay current within a game frame; presentation effects
    // still use the normal microtask queue to batch their work.
    const stop = createEffect(() => {
        const newValue = fn();

        memoState.set(newValue);
    }, true);
    let disposed = false;

    const read = () => memoState.get() as T;
    return Object.assign(read, {
        get: read,
        peek: () => memoState.peek() as T,
        subscribe: (listener: SignalListener<T>) => memoState.subscribe((value, previous) => listener(value as T, previous as T)),
        dispose() {
            if (disposed) return;
            disposed = true;
            // A timer callback may remove an entity inside an outer batch. Preserve
            // its final derived snapshot before releasing the pending dependencies.
            try { settleMemos(); } finally { stop(); }
        },
    });
}
