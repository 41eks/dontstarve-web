

// 定义双向绑定的类型
type Effect = {
    runner: () => void;
    cleanups: (() => void)[];
    deps: any[];            // 存它依赖的 Signal 对象
    depsIndices: number[];  // 存它在各个 Signal.subscribers 数组里的下标
    disposed: boolean;
};

type SignalNode = {
    subscribers: Effect[];       // 存订阅了它的 Effect
    subscriberIndices: number[]; // 存各个 Effect 把该 Signal 记在 deps 里的下标
};

let activeEffect: Effect | null = null;

export function onCleanUp(fn: () => void) {
    if (activeEffect) {
        activeEffect.cleanups.push(fn);
    } else {
        console.warn("onCleanUp 必须在 createEffect 的同步执行上下文中调用！");
    }

}

export function createEffect(fn: () => void) {
    // 构造出一个标准的 Effect 对象
    const effect: Effect = {
        deps: [], // 初始化空账本
        depsIndices: [],
        cleanups: [],
        disposed: false,
        runner: () => {
            if (effect.disposed) return;
            // ✨ 核心清理动作：执行前，先把自己从所有旧的 Signal 依赖中清除
            cleanup(effect);

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
    effect.runner();

    return () => {
        if (effect.disposed) return;
        effect.disposed = true;
        queue.delete(effect.runner);
        cleanup(effect);
    };
}


// 优化 1：直接接收初始值，简化 API
export function createSignal<T>(initialValue: T) {
    let _state = initialValue;
    const signalObj: SignalNode = {
        subscribers: [], subscriberIndices: []
    }

    function setState(newValue: T) {
        if (_state === newValue) return; // 优化：值没变就不触发更新
        _state = newValue;

        const currentSubscribers = [...signalObj.subscribers];
        // const currentSubscribers = signalObj.subscribers;

        for (let i = 0; i < currentSubscribers.length; i++) {
            const effect = currentSubscribers[i];
            if (effect != activeEffect) {
                enqueue(effect.runner);
            }
        }
    }

    function getState() {
        if (activeEffect) {
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

    return { get: getState, set: setState };
};


function cleanup(effect: Effect) {
    // ✨ 1. 遍历并执行所有的用户清理函数
    if (effect.cleanups.length > 0) {
        for (let i = 0; i < effect.cleanups.length; i++) {
            effect.cleanups[i]();
        }
        // ✨ 2. 核心！执行完后必须清空数组，防止下一次无端触发！
        effect.cleanups.length = 0; 
    }
    const { deps, depsIndices } = effect;
    if (deps.length === 0) return;

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


export function createMemo<T>(fn: () => T) {
    const memoState = createSignal<T | undefined>(undefined);

    createEffect(() => {
        const newValue = fn();

        memoState.set(newValue);
    });

    return memoState.get;
}
