import type { Vector3 } from 'three';
import { createEffect, createSignal, readonlySignal, watchSignal } from '@dontstarve-web/signals';
import type { WorkableInst } from './workable';
import { CreateTechTree, type TechTree } from './techtree';

export interface PrototyperDoer extends WorkableInst { getPosition(): Vector3; }
export interface PrototyperInst extends PrototyperDoer {
  readonly components: { prototyper?: Prototyper };
}

/** components/prototyper.lua: a station stays on until its last builder leaves. */
export class Prototyper<Inst extends PrototyperInst = PrototyperInst> {
  private levels: TechTree = CreateTechTree();
  private restriction?: string;
  private readonly revision = createSignal(0);
  readonly configurationChanged = readonlySignal(this.revision);
  get trees(): Readonly<TechTree> { return this.levels; }
  set trees(trees: TechTree) { this.levels = { ...trees }; this.revision.set(this.revision.peek() + 1); }
  SetTechLevel(branch: string, level: number): void { this.trees = { ...this.levels, [branch]: level }; }
  get restrictedtag(): string | undefined { return this.restriction; }
  set restrictedtag(tag: string | undefined) { this.restriction = tag; this.revision.set(this.revision.peek() + 1); }
  onturnon?: { call(inst: Inst): void }['call'];
  onturnoff?: { call(inst: Inst): void }['call'];
  onturnonfordoer?: { call(inst: Inst, doer: PrototyperDoer): void }['call'];
  onturnofffordoer?: { call(inst: Inst, doer: PrototyperDoer): void }['call'];
  canuseprototyperfn?: { call(inst: Inst, doer: PrototyperDoer): boolean }['call'];
  private readonly doers = new Map<PrototyperDoer, () => void>();
  private active = false;
  private disposed = false;
  private readonly inst: Inst;
  private readonly distance: number;

  constructor(inst: Inst, distance = 4) {
    this.inst = inst;
    this.distance = distance;
    inst.addTag('prototyper');
  }
  get on(): boolean { return this.active; }

  TurnOn(doer: PrototyperDoer): void {
    if (this.disposed || this.doers.has(doer) || doer.isRemoved) return;
    const removal = watchSignal(doer.removal, stop => this.doers.set(doer, stop));
    createEffect(() => { if (removal.get()) this.TurnOff(doer); });
    this.onturnonfordoer?.(this.inst, doer);
    if (!this.active) {
      this.onturnon?.(this.inst);
      this.active = true;
    }
  }
  TurnOff(doer: PrototyperDoer): void {
    const stop = this.doers.get(doer);
    if (!stop) return;
    this.doers.delete(doer);
    stop();
    this.onturnofffordoer?.(this.inst, doer);
    if (this.doers.size === 0 && this.active) {
      this.onturnoff?.(this.inst);
      this.active = false;
    }
  }
  CanUsePrototyper(doer: PrototyperDoer): boolean {
    return this.canuseprototyperfn?.(this.inst, doer)
      ?? doer.getPosition().distanceToSquared(this.inst.getPosition()) < this.distance ** 2;
  }
  GetTechTrees(): TechTree { return { ...this.trees }; }

  OnRemoveFromEntity(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.inst.removeTag('prototyper');
    for (const [doer, stop] of this.doers) {
      stop();
      this.onturnofffordoer?.(this.inst, doer);
    }
    this.doers.clear();
    if (this.active) this.onturnoff?.(this.inst);
    this.active = false;
  }
}
