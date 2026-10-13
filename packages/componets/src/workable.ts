import { batch, createMemo, createSignal, readonlySignal, type Memo, type ReadonlySignal } from '@dontstarve-web/signals';
import type { Vector3 } from 'three';

export type WorkAction = 'NET' | 'HAMMER' | 'MINE' | 'DIG' | 'CHOP';

export interface WorkInst {
  readonly isRemoved: boolean;
  hasTag(tag: string): boolean;
  addTag(tag: string): void;
  removeTag(tag: string): void;
  PushEvent?(name: string, data: unknown): void;
}

export interface WorkableInst extends WorkInst {
  readonly removal: ReadonlySignal<boolean>;
}

export interface Worker {
  PushEvent?(name: string, data: unknown): void;
  /** Ground position of the worker, e.g. for a tree's fall direction. */
  getPosition?(): Vector3;
  components?: { inventory?: { GiveItem(entity: unknown, source?: { x: number; y: number; z: number }): boolean } };
}

const WORKABLE_TAGS = new Set(['NET_workable', 'HAMMER_workable', 'MINE_workable', 'DIG_workable', 'CHOP_workable']);
const canWork = (disposed: boolean, removed: boolean, enabled: boolean, workleft: number): boolean =>
  !disposed && !removed && enabled && workleft > 0;
const workTag = (canBeWorked: boolean, action: WorkAction | undefined): string | undefined =>
  canBeWorked && action ? `${action}_workable` : undefined;

/** components/workable.lua: signals own work state; the action tag is a pure derived view. */
export class Workable {
  private readonly actionState = createSignal<WorkAction | undefined>('CHOP');
  private readonly workleftState = createSignal(10);
  private readonly maxworkState = createSignal(-1);
  readonly maxwork = readonlySignal(this.maxworkState);
  private readonly enabledState = createSignal(true);
  private readonly disposedState = createSignal(false);
  private readonly lastworktimeState = createSignal<number | undefined>(undefined);
  readonly lastworktime = readonlySignal(this.lastworktimeState);
  readonly workleft = readonlySignal(this.workleftState);
  readonly enabled = readonlySignal(this.enabledState);
  readonly action = readonlySignal(this.actionState);
  private readonly canBeWorkedMemo: Memo<boolean>;
  private readonly actionTagMemo: Memo<string | undefined>;
  readonly canBeWorked: ReadonlySignal<boolean>;
  readonly actionTag: ReadonlySignal<string | undefined>;
  private onwork?: (worker: Worker, workleft: number, numworks: number) => void;
  private onfinish?: (worker: Worker) => void;
  private onload?: () => void;
  savestate = false;

  private readonly inst: WorkableInst;
  private readonly now?: () => number;
  constructor(inst: WorkableInst, now?: () => number) {
    this.now = now;
    this.inst = inst;
    this.canBeWorkedMemo = createMemo(() => canWork(this.disposedState.get(), inst.removal.get(),
      this.enabledState.get(), this.workleftState.get()));
    this.actionTagMemo = createMemo(() => workTag(this.canBeWorkedMemo.get(), this.actionState.get()));
    this.canBeWorked = readonlySignal(this.canBeWorkedMemo);
    this.actionTag = readonlySignal(this.actionTagMemo);
  }

  SetWorkAction(action: WorkAction | undefined): void {
    if (!this.disposedState.peek()) this.actionState.set(action);
  }
  GetWorkAction(): WorkAction | undefined { return this.actionState.peek(); }
  SetMaxWork(work = 10): void { if (!this.disposedState.peek()) this.maxworkState.set(Math.max(1, work)); }
  SetWorkLeft(work = 10): void {
    if (this.disposedState.peek()) return;
    batch(() => { this.enabledState.set(true); this.workleftState.set(this.maxworkState.peek() > 0
      ? Math.min(this.maxworkState.peek(), Math.max(1, work)) : Math.max(1, work)); });
  }
  GetWorkLeft(): number { return this.enabledState.peek() ? this.workleftState.peek() : 0; }
  SetWorkable(value: boolean): void { if (!this.disposedState.peek()) this.enabledState.set(value); }
  // Domain checks use the same pure calculation on current inputs, including inside an outer batch.
  // Memo subscribers observe the committed result after all inputs have settled.
  CanBeWorked(): boolean {
    return canWork(this.disposedState.peek(), this.inst.removal.peek(), this.enabledState.peek(), this.workleftState.peek());
  }
  HasTag(tag: string): boolean | undefined {
    return WORKABLE_TAGS.has(tag) ? workTag(this.CanBeWorked(), this.actionState.peek()) === tag : undefined;
  }
  SetOnWorkCallback(fn: (worker: Worker, workleft: number, numworks: number) => void): void { this.onwork = fn; }
  SetOnFinishCallback(fn: (worker: Worker) => void): void { this.onfinish = fn; }

  WorkedBy(worker: Worker, numworks = 1): boolean {
    if (!this.CanBeWorked()) return false;
    if (this.now) this.lastworktimeState.set(this.now());
    if (numworks > 0) {
      const remaining = this.workleftState.peek();
      const next = remaining <= 1 ? 0 : remaining - numworks;
      this.workleftState.set(next < 0.01 ? 0 : next);
    }
    worker.PushEvent?.('working', { target: this.inst });
    this.inst.PushEvent?.('worked', { worker, workleft: this.workleftState.peek() });
    this.onwork?.(worker, this.workleftState.peek(), numworks);
    if (this.workleftState.peek() <= 0) {
      this.onfinish?.(worker);
      this.inst.PushEvent?.('workfinished', { worker });
      worker.PushEvent?.('finishedwork', { target: this.inst, action: this.actionState.peek() });
    }
    return true;
  }

  SetOnLoadFn(fn: () => void): void { this.onload = fn; }
  OnSave(): { workleft?: number; maxwork?: number } { return this.savestate ? {
    workleft: this.workleftState.peek(), ...(this.maxworkState.peek() > 0 ? { maxwork: this.maxworkState.peek() } : {}),
  } : {}; }
  OnLoad(data: { workleft?: number; maxwork?: number }): void {
    if (this.disposedState.peek()) return;
    batch(() => {
      if (data.maxwork !== undefined) this.maxworkState.set(data.maxwork);
      if (data.workleft !== undefined) this.workleftState.set(data.workleft);
    });
    this.onload?.();
  }
  dispose(): void {
    if (this.disposedState.peek()) return;
    this.disposedState.set(true);
    this.actionTagMemo.dispose();
    this.canBeWorkedMemo.dispose();
    this.onwork = undefined;
    this.onfinish = undefined;
    this.onload = undefined;
  }
}
