import { createEffect, createSignal, readonlySignal, watchSignal } from '@dontstarve-web/signals';
import type { Vector3 } from 'three';
import type { PrototyperDoer, PrototyperInst } from './prototyper';
import { CreateTechTree } from './techtree';

export interface BuilderWorld {
  findEntities(position: Vector3, radius: number, mustTags: readonly string[], cantTags: readonly string[]): PrototyperInst[];
  researchMachineDistance?: number;
}

/** components/builder.lua's per-frame tech evaluation; station state belongs to prototyper. */
export class Builder {
  private readonly techTrees = createSignal(CreateTechTree());
  readonly accessible_tech_trees = readonlySignal(this.techTrees);
  private current?: PrototyperInst;
  private override?: PrototyperInst;
  private enabled = true;
  private disposed = false;
  private stopRemoval?: () => void;
  private readonly inst: PrototyperDoer;
  private readonly world: BuilderWorld;
  readonly exclude_tags = ['INLIMBO', 'fire'];

  constructor(inst: PrototyperDoer, world: BuilderWorld) {
    this.inst = inst;
    this.world = world;
    const removal = watchSignal(inst.removal, stop => { this.stopRemoval = stop; });
    createEffect(() => { if (removal.get()) this.dispose(); });
  }
  get current_prototyper(): PrototyperInst | undefined { return this.current; }

  private eligible(station: PrototyperInst): boolean {
    return !station.isRemoved && station.hasTag('prototyper')
      && !this.exclude_tags.some(tag => station.hasTag(tag))
      && !!station.components.prototyper
      && (!station.components.prototyper.restrictedtag || this.inst.hasTag(station.components.prototyper.restrictedtag));
  }
  UsePrototyper(station?: PrototyperInst): boolean {
    if (!this.enabled || this.disposed || (station && !this.eligible(station))) return false;
    this.override = station;
    return true;
  }
  SetCraftingEnabled(enabled: boolean): void { this.enabled = enabled; }
  OnUpdate(): void { this.EvaluateTechTrees(); }

  EvaluateTechTrees(): void {
    if (this.disposed) return;
    const old = this.current;
    const position = this.inst.getPosition();
    let stations: PrototyperInst[] = [];
    if (this.override && (!this.enabled || !this.eligible(this.override)
      || !this.override.components.prototyper!.CanUsePrototyper(this.inst))) this.override = undefined;
    if (this.enabled) {
      stations = this.override ? [this.override] : this.world.findEntities(position,
        this.world.researchMachineDistance ?? 4, ['prototyper'], this.exclude_tags)
        .sort((a, b) => a.getPosition().distanceToSquared(position) - b.getPosition().distanceToSquared(position));
    }
    this.current = undefined;
    for (const station of stations) {
      if (!this.eligible(station)) continue;
      if (!this.current) {
        station.components.prototyper!.TurnOn(this.inst);
        this.current = station;
      } else station.components.prototyper!.TurnOff(this.inst);
    }
    if (old !== this.current && old && !old.isRemoved) old.components.prototyper?.TurnOff(this.inst);
    const trees = this.current?.components.prototyper?.GetTechTrees() ?? CreateTechTree();
    const previous = this.techTrees.peek();
    if (Object.keys(trees).some(key => trees[key] !== previous[key])) {
      this.techTrees.set(trees);
      this.inst.PushEvent?.('techtreechange', { level: trees });
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.enabled = false;
    this.EvaluateTechTrees();
    this.disposed = true;
    this.stopRemoval?.();
    this.stopRemoval = undefined;
  }
}
