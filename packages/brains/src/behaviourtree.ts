// scripts/behaviourtree.lua: a node returns SUCCESS / FAILED / RUNNING from Visit().
export type BehaviourStatus = 'SUCCESS' | 'FAILED' | 'READY' | 'RUNNING';
export const SUCCESS = 'SUCCESS', FAILED = 'FAILED', READY = 'READY', RUNNING = 'RUNNING' as const;

/** GetTime() and math.random() for one tree, supplied by the entity that owns the brain. */
export interface BehaviourContext {
  getTime(): number;
  random(): number;
}

export class BT {
  readonly inst: BehaviourContext;
  readonly root: BehaviourNode;
  private forceupdate = false;

  constructor(inst: BehaviourContext, root: BehaviourNode) {
    this.inst = inst;
    this.root = root;
    root.attach(inst);
  }

  ForceUpdate(): void { this.forceupdate = true; }

  Update(): void {
    this.root.Visit();
    this.root.SaveStatus();
    this.root.Step();
    this.forceupdate = false;
  }

  Reset(): void { this.root.Reset(); }
  Stop(): void { this.root.Stop(); }

  GetSleepTime(): number | undefined {
    if (this.forceupdate) return 0;
    return this.root.GetTreeSleepTime();
  }

  toString(): string { return this.root.GetTreeString(); }
}

export class BehaviourNode {
  name: string;
  children?: BehaviourNode[];
  parent?: BehaviourNode;
  status: BehaviourStatus = READY;
  lastresult: BehaviourStatus = READY;
  nextupdatetime?: number;
  protected context!: BehaviourContext;
  OnStop?: () => void;

  constructor(name = '', children?: BehaviourNode[]) {
    this.name = name;
    this.children = children;
    for (const child of children ?? []) child.parent = this;
  }

  /** Nodes are built before the tree exists; BT hands every node its clock and random source. */
  attach(context: BehaviourContext): void {
    this.context = context;
    for (const child of this.children ?? []) child.attach(context);
  }

  protected get now(): number { return this.context.getTime(); }

  DoToParents(fn: (node: BehaviourNode) => void): void {
    if (this.parent) {
      fn(this.parent);
      this.parent.DoToParents(fn);
    }
  }

  GetTreeString(indent = ''): string {
    let result = `${indent}${this.GetString()}>${(this.GetTreeSleepTime() ?? 0).toFixed(2)}\n`;
    for (const child of this.children ?? []) result += child.GetTreeString(`${indent}   >`);
    return result;
  }

  DBString(): string { return ''; }

  Sleep(t: number): void { this.nextupdatetime = this.now + t; }

  GetSleepTime(): number | undefined {
    if (this.status === RUNNING && !this.children && !(this instanceof ConditionNode)) {
      if (this.nextupdatetime !== undefined) return Math.max(0, this.nextupdatetime - this.now);
      return 0;
    }
    return undefined;
  }

  GetTreeSleepTime(): number | undefined {
    let sleeptime: number | undefined;
    for (const child of this.children ?? []) {
      if (child.status !== RUNNING) continue;
      const t = child.GetTreeSleepTime();
      if (t !== undefined && (sleeptime === undefined || sleeptime > t)) sleeptime = t;
    }
    const mine = this.GetSleepTime();
    if (mine !== undefined && (sleeptime === undefined || sleeptime > mine)) sleeptime = mine;
    return sleeptime;
  }

  GetString(): string {
    const detail = this.status === RUNNING ? this.DBString() : '';
    return `${this.name} - ${this.status} <${this.lastresult}> (${detail})`;
  }

  Visit(): void { this.status = FAILED; }

  SaveStatus(): void {
    this.lastresult = this.status;
    for (const child of this.children ?? []) child.SaveStatus();
  }

  Step(): void {
    if (this.status !== RUNNING) this.Reset();
    else for (const child of this.children ?? []) child.Step();
  }

  Reset(): void {
    if (this.status !== READY) {
      this.status = READY;
      for (const child of this.children ?? []) child.Reset();
    }
  }

  Stop(): void {
    this.OnStop?.();
    for (const child of this.children ?? []) child.Stop();
  }
}

export class DecoratorNode extends BehaviourNode {
  constructor(name: string | undefined, child: BehaviourNode) { super(name ?? 'Decorator', [child]); }
}

export class ConditionNode extends BehaviourNode {
  private readonly fn: () => boolean;
  constructor(fn: () => boolean, name = 'Condition') { super(name); this.fn = fn; }
  override Visit(): void { this.status = this.fn() ? SUCCESS : FAILED; }
}

export class ConditionWaitNode extends BehaviourNode {
  private readonly fn: () => boolean;
  constructor(fn: () => boolean, name = 'Wait') { super(name); this.fn = fn; }
  override Visit(): void { this.status = this.fn() ? SUCCESS : RUNNING; }
}

export class ActionNode extends BehaviourNode {
  private readonly action: () => void;
  constructor(action: () => void, name = 'ActionNode') { super(name); this.action = action; }
  override Visit(): void {
    this.action();
    this.status = SUCCESS;
  }
}

export class WaitNode extends BehaviourNode {
  private readonly wait_time: number | (() => number);
  private wake_time = 0;
  constructor(time: number | (() => number)) { super('Wait'); this.wait_time = time; }
  override DBString(): string { return (this.wake_time - this.now).toFixed(2); }
  override Visit(): void {
    const current = this.now;
    if (this.status !== RUNNING) {
      this.wake_time = current + (typeof this.wait_time === 'function' ? this.wait_time() : this.wait_time);
      this.status = RUNNING;
    }
    if (current >= this.wake_time) this.status = SUCCESS;
    else this.Sleep(current - this.wake_time);
  }
}

export class SequenceNode extends BehaviourNode {
  idx = 0;
  constructor(children: BehaviourNode[]) { super('Sequence', children); }
  override DBString(): string { return String(this.idx + 1); }
  override Reset(): void { super.Reset(); this.idx = 0; }
  override Visit(): void {
    if (this.status !== RUNNING) this.idx = 0;
    const children = this.children!;
    while (this.idx < children.length) {
      const child = children[this.idx];
      child.Visit();
      if (child.status === RUNNING || child.status === FAILED) {
        this.status = child.status;
        return;
      }
      this.idx++;
    }
    this.status = SUCCESS;
  }
}

export class SelectorNode extends BehaviourNode {
  idx = 0;
  constructor(children: BehaviourNode[]) { super('Selector', children); }
  override DBString(): string { return String(this.idx + 1); }
  override Reset(): void { super.Reset(); this.idx = 0; }
  override Visit(): void {
    if (this.status !== RUNNING) this.idx = 0;
    const children = this.children!;
    while (this.idx < children.length) {
      const child = children[this.idx];
      child.Visit();
      if (child.status === RUNNING || child.status === SUCCESS) {
        this.status = child.status;
        return;
      }
      this.idx++;
    }
    this.status = FAILED;
  }
}

export class NotDecorator extends DecoratorNode {
  constructor(child: BehaviourNode) { super('Not', child); }
  override Visit(): void {
    const child = this.children![0];
    child.Visit();
    this.status = child.status === SUCCESS ? FAILED : child.status === FAILED ? SUCCESS : child.status;
  }
}

export class ParallelNode extends BehaviourNode {
  stoponanycomplete = false;
  constructor(children: BehaviourNode[], name = 'Parallel') { super(name, children); }

  override Step(): void {
    if (this.status !== RUNNING) this.Reset();
    else {
      for (const child of this.children!) {
        if (child.status === SUCCESS && child instanceof ConditionNode) child.Reset();
        child.Step();
      }
    }
  }

  override Visit(): void {
    let done = true, anyDone = false;
    for (const child of this.children!) {
      if (child instanceof ConditionNode) child.Reset();
      if (child.status !== SUCCESS) {
        child.Visit();
        if (child.status === FAILED) {
          this.status = FAILED;
          return;
        }
      }
      if (child.status === RUNNING) done = false;
      else anyDone = true;
    }
    this.status = done || (this.stoponanycomplete && anyDone) ? SUCCESS : RUNNING;
  }
}

export class ParallelNodeAny extends ParallelNode {
  constructor(children: BehaviourNode[]) {
    super(children, 'Parallel(Any)');
    this.stoponanycomplete = true;
  }
}

export class PriorityNode extends BehaviourNode {
  readonly period: number | undefined;
  idx: number | undefined;
  lasttime: number | undefined;
  private readonly noscatter: boolean;

  constructor(children: BehaviourNode[], period = 1, noscatter = false) {
    super('Priority', children);
    this.period = period;
    this.noscatter = noscatter;
  }

  override attach(context: BehaviourContext): void {
    super.attach(context);
    if (!this.noscatter && this.period !== undefined) this.lasttime = this.period * .5 + this.period * context.random();
  }

  override GetSleepTime(): number | undefined {
    if (this.status === RUNNING) {
      if (!this.period) return 0;
      let timeTo = 0;
      if (this.lasttime !== undefined) timeTo = Math.max(0, this.lasttime + this.period - this.now);
      return timeTo;
    }
    return this.status === READY ? 0 : undefined;
  }

  override DBString(): string {
    const timeTill = this.period ? (this.lasttime ?? 0) + this.period - this.now : 0;
    return `execute ${this.idx === undefined ? -1 : this.idx + 1}, eval in ${timeTill.toFixed(2)}`;
  }

  override Reset(): void { super.Reset(); this.idx = undefined; }

  override Visit(): void {
    const time = this.now;
    const doEval = this.lasttime === undefined || !this.period || this.lasttime + this.period < time;
    if (doEval) {
      this.lasttime = time;
      let found = false;
      this.children!.forEach((child, idx) => {
        if (!found) {
          if (child.status === FAILED || child.status === SUCCESS) child.Reset();
          child.Visit();
          const cs = child.status;
          if (cs === SUCCESS || cs === RUNNING) {
            this.status = cs;
            found = true;
            this.idx = idx;
          }
        } else child.Reset();
      });
      if (!found) this.status = FAILED;
    } else if (this.idx !== undefined) {
      const child = this.children![this.idx];
      if (child.status === RUNNING) {
        child.Visit();
        this.status = child.status;
        if (this.status !== RUNNING) this.lasttime = undefined;
      }
    }
  }
}

/** Once the condition passes the sequence keeps running its node until that node succeeds or fails. */
export function IfNode(cond: () => boolean, name: string, node: BehaviourNode): BehaviourNode {
  return new SequenceNode([new ConditionNode(cond, name), node]);
}

/** The condition is re-checked on every visit while the node runs. */
export function WhileNode(cond: () => boolean, name: string, node: BehaviourNode): BehaviourNode {
  return new ParallelNode([new ConditionNode(cond, name), node]);
}
