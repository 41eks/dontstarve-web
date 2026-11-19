import type { LuaFn } from './luaFn';
import { NO_TAGS, type DerivedTags } from './derivedTags';
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
  readonly sg?: { hasStateTag(tag: string): boolean };
  PushEvent?(name: string, data: unknown): void;
  /** Ground position of the worker, e.g. for a tree's fall direction. */
  getPosition?(): Vector3;
  components?: { inventory?: { GiveItem?(entity: unknown, source?: { x: number; y: number; z: number }): boolean } };
}

const canWork = (disposed: boolean, removed: boolean, enabled: boolean, workleft: number): boolean =>
  !disposed && !removed && enabled && workleft > 0;
const workTag = (canBeWorked: boolean, action: WorkAction | undefined): string | undefined =>
  canBeWorked && action ? `${action}_workable` : undefined;

export type WorkableOnWorkFn<Inst> = LuaFn<[inst: Inst, worker: Worker, workleft: number, numworks: number]>;
export type WorkableOnFinishFn<Inst> = LuaFn<[inst: Inst, worker: Worker]>;
export interface WorkableSaveData { workleft?: number; maxwork?: number }
export type WorkableOnLoadFn<Inst> = LuaFn<[inst: Inst, data: WorkableSaveData]>;

/** components/workable.lua: signals own work state; the action tag is a pure derived view. */
export class Workable<Inst extends WorkableInst = WorkableInst> implements DerivedTags {
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
  private readonly derivedTagsMemo: Memo<readonly string[]>;
  /** onworkable / onaction's `<ACTION>_workable`, while there is work left and the workable is enabled. */
  readonly derivedTags: ReadonlySignal<readonly string[]>;
  private onwork?: WorkableOnWorkFn<Inst>;
  private onfinish?: WorkableOnFinishFn<Inst>;
  private onload?: WorkableOnLoadFn<Inst>;
  savestate = false;

  private readonly inst: Inst;
  private readonly now?: () => number;
  constructor(inst: Inst, now?: () => number) {
    this.now = now;
    this.inst = inst;
    this.canBeWorkedMemo = createMemo(() => canWork(this.disposedState.get(), inst.removal.get(),
      this.enabledState.get(), this.workleftState.get()));
    this.actionTagMemo = createMemo(() => workTag(this.canBeWorkedMemo.get(), this.actionState.get()));
    this.canBeWorked = readonlySignal(this.canBeWorkedMemo);
    this.actionTag = readonlySignal(this.actionTagMemo);
    this.derivedTagsMemo = createMemo(() => { const tag = this.actionTagMemo.get(); return tag ? [tag] : NO_TAGS; });
    this.derivedTags = readonlySignal(this.derivedTagsMemo);
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
  /** Lua's direct `workable.workleft = n` field write (moon_fissure.lua, sculptures.lua): no clamp, `workable` untouched. */
  WriteWorkLeft(work: number): void { if (!this.disposedState.peek()) this.workleftState.set(work); }
  GetWorkLeft(): number { return this.enabledState.peek() ? this.workleftState.peek() : 0; }
  SetWorkable(value: boolean): void { if (!this.disposedState.peek()) this.enabledState.set(value); }
  /** tough, set by SetRequiresToughWork; the toughworker check in WorkedBy is not ported. */
  tough?: boolean;
  SetRequiresToughWork(tough: boolean): void { this.tough = tough; }
  // The memo is current inside a batch too; its subscribers observe the committed result.
  CanBeWorked(): boolean { return this.canBeWorkedMemo.peek(); }
  SetOnWorkCallback(fn: WorkableOnWorkFn<Inst> | undefined): void { this.onwork = fn; }
  SetOnFinishCallback(fn: WorkableOnFinishFn<Inst> | undefined): void { this.onfinish = fn; }

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
    this.onwork?.(this.inst, worker, this.workleftState.peek(), numworks);
    if (this.workleftState.peek() <= 0) {
      this.onfinish?.(this.inst, worker);
      this.inst.PushEvent?.('workfinished', { worker });
      worker.PushEvent?.('finishedwork', { target: this.inst, action: this.actionState.peek() });
    }
    return true;
  }

  SetOnLoadFn(fn: WorkableOnLoadFn<Inst> | undefined): void { this.onload = fn; }
  OnSave(): WorkableSaveData { return this.savestate ? {
    workleft: this.workleftState.peek(), ...(this.maxworkState.peek() > 0 ? { maxwork: this.maxworkState.peek() } : {}),
  } : {}; }
  OnLoad(data: WorkableSaveData): void {
    if (this.disposedState.peek()) return;
    batch(() => {
      if (data.maxwork !== undefined) this.maxworkState.set(data.maxwork);
      if (data.workleft !== undefined) this.workleftState.set(data.workleft);
    });
    this.onload?.(this.inst, data);
  }
  dispose(): void {
    if (this.disposedState.peek()) return;
    this.disposedState.set(true);
    this.derivedTagsMemo.dispose();
    this.actionTagMemo.dispose();
    this.canBeWorkedMemo.dispose();
    this.onwork = undefined;
    this.onfinish = undefined;
    this.onload = undefined;
  }
}
