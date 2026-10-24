import * as THREE from 'three';
import { batch, createMemo, createSignal, readonlySignal } from '@dontstarve-web/signals';
import type { PickableComponent, PickDoer } from '@dontstarve-web/stategraphs/pick';
import { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';
import { setModelTag } from '../prefabInstance';
import type { ItemEntity } from '@dontstarve-web/inventory';

export interface PickableSaveState {
  picked?: boolean;
  regrowSeconds?: number;
  paused?: boolean;
  transplanted?: boolean;
  cyclesLeft?: number;
  maxCycles?: number;
  protectedCycles?: number;
}

export interface PickableTiming {
  scheduler: GameTimeScheduler;
  /** simutil.lua SpringGrowthMod, evaluated only when setting/resuming a task. */
  growthDuration?: (seconds: number) => number;
  getRegenTime?: (pickable: Pickable) => number;
  maxCycles?: number;
  onBarren?: (wasEmpty: boolean) => void;
  onEmpty?: () => void;
  onTransplant?: () => void;
  onRemove?: () => void;
}

/** pickable.lua: component data, regeneration tasks, tags and synchronous domain transitions. */
export class Pickable implements PickableComponent {
  private readonly ready = createSignal(true);
  private readonly interactable = createSignal(true);
  private readonly removed = createSignal(false);
  private readonly paused = createSignal(false);
  private readonly cycles = createSignal<number | undefined>(undefined);
  private readonly transplanted = createSignal(false);
  private readonly protection = createSignal<number | undefined>(undefined);
  private maxCycles?: number;
  private readonly callbacks?: PickableTiming;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly growthDuration: (seconds: number) => number;
  private readonly timer: ComponentTimer;
  private readonly phaseMemo = createMemo(() => this.removed.get() ? 'removed'
    : this.ready.get() ? 'ready' : this.cycles.get() === 0 ? 'barren' : 'picked');
  private readonly regrowingMemo;
  readonly state;
  /** pickable.lua quickpick defaults to false; SGwilson reads this field. */
  quickpick = false;
  picksound?: string;
  wildfirestarter = false;
  remove_when_picked = false;
  /** Prefabs retaining an original item provide it instead of spawning a product copy. */
  getProductEntity?: () => ItemEntity | undefined;
  get productEntity(): ItemEntity | undefined { return this.getProductEntity?.(); }

  private readonly model: THREE.Object3D;
  private productName: string | undefined;
  private regrowTime: number | undefined;
  private harvestCount: number;
  private readonly onPicked: (doer?: PickDoer) => void;
  private readonly onRegen: () => void;

  constructor(model: THREE.Object3D, product: string | undefined, regenTime: number | undefined,
    numToHarvest = 1, onPicked: (doer?: PickDoer) => void = () => {},
    onRegen: () => void = () => {}, saved?: PickableSaveState, timing?: PickableTiming) {
    this.model = model; this.productName = product; this.regrowTime = regenTime;
    this.harvestCount = numToHarvest; this.onPicked = onPicked; this.onRegen = onRegen;
    this.scheduler = timing?.scheduler ?? new GameTimeScheduler();
    this.ownsScheduler = !timing;
    this.growthDuration = timing?.growthDuration ?? (seconds => seconds);
    this.callbacks = timing;
    this.maxCycles = saved?.maxCycles ?? timing?.maxCycles;
    this.cycles.set(saved?.cyclesLeft ?? this.maxCycles);
    this.transplanted.set(saved?.transplanted ?? false);
    this.protection.set(saved?.protectedCycles);
    this.timer = new ComponentTimer(this.scheduler, () => this.regen());
    this.regrowingMemo = createMemo(() => this.timer.snapshot.get().status === 'scheduled');
    this.state = Object.freeze({ canBePicked: readonlySignal(this.ready), canInteractWith: readonlySignal(this.interactable),
      removed: readonlySignal(this.removed), paused: readonlySignal(this.paused), timer: this.timer.snapshot,
      phase: readonlySignal(this.phaseMemo), regrowing: readonlySignal(this.regrowingMemo),
      cyclesLeft: readonlySignal(this.cycles), transplanted: readonlySignal(this.transplanted),
      protectedCycles: readonlySignal(this.protection) });
    this.ready.set(!saved?.picked);
    this.paused.set(saved?.paused ?? false);
    if (saved?.regrowSeconds !== undefined) {
      if (saved.paused) this.timer.restorePaused(saved.regrowSeconds);
      else this.timer.start(saved.regrowSeconds);
    }
    model.userData.components = { ...model.userData.components, pickable: this };
    this.refreshTag();
  }

  get product(): string | undefined { return this.productName; }
  get regenTime(): number | undefined { return this.regrowTime; }
  ChangeProduct(product: string | undefined): void { this.productName = product; }
  get numToHarvest(): number { return this.harvestCount; }

  /** pickable.lua SetUp: a new product is immediately pickable. */
  SetUp(product: string, regenTime: number, numToHarvest = 1): void {
    if (this.removed.peek()) return;
    batch(() => {
      this.productName = product; this.regrowTime = regenTime; this.harvestCount = numToHarvest;
      this.ready.set(true);
      this.refreshTag();
    });
  }

  get canBePicked(): boolean { return !this.removed.peek() && this.ready.peek(); }
  set canBePicked(value: boolean) { this.ready.set(value); this.refreshTag(); }
  get canInteractWith(): boolean { return this.interactable.peek(); }
  set canInteractWith(value: boolean) { this.interactable.set(value); this.refreshTag(); }
  get remainingSeconds(): number | undefined { return this.timer.remainingSeconds; }
  get cyclesLeft(): number | undefined { return this.cycles.peek(); }
  get maximumCycles(): number | undefined { return this.maxCycles; }
  set cyclesLeft(value: number | undefined) { this.cycles.set(value); this.refreshTag(); }
  IsBarren(): boolean { return this.cycles.peek() === 0; }
  CanBeFertilized(): boolean { return !this.removed.peek() && (this.IsBarren() || this.model.userData.tags?.includes('withered')); }

  MakeBarren(): void {
    if (this.removed.peek()) return;
    batch(() => {
      const wasEmpty = !this.ready.peek();
      this.cycles.set(0); this.ready.set(false); this.timer.stop(); this.refreshTag();
      this.callbacks?.onBarren?.(wasEmpty);
    });
  }

  OnTransplant(): void {
    if (this.removed.peek()) return;
    this.transplanted.set(true); this.callbacks?.onTransplant?.();
  }

  MakeEmpty(): void {
    if (this.removed.peek()) return;
    batch(() => {
      this.timer.stop(); this.callbacks?.onEmpty?.(); this.ready.set(false); this.refreshTag();
      if (!this.paused.peek() && this.regrowTime !== undefined) this.timer.start(this.nextGrowthDuration());
    });
  }

  Fertilize(fertilizer: { components?: { fertilizer?: { withered_cycles: number } } }): boolean {
    if (!this.CanBeFertilized()) return false;
    this.model.userData.components?.burnable?.StopSmoldering();
    batch(() => {
      this.cycles.set(this.maxCycles);
      const witherable = this.model.userData.components?.witherable;
      if (witherable) {
        const protection = (this.protection.peek() ?? 0) + (fertilizer.components?.fertilizer?.withered_cycles ?? 0);
        this.protection.set(protection > 0 ? protection : undefined);
        witherable.Enable(protection <= 0);
        if (witherable.IsWithered()) witherable.ForceRejuvenate();
        else this.MakeEmpty();
      } else this.MakeEmpty();
      this.refreshTag();
    });
    return true;
  }

  pick(doer: PickDoer): boolean {
    return this.Pick(doer);
  }

  /** pickable.lua permits Pick() without a picker (e.g. a lightflier flower releasing its child). */
  Pick(doer?: PickDoer): boolean {
    if (!this.canBePicked || !this.canInteractWith) return false;
    const position = this.model.getWorldPosition(new THREE.Vector3()), entity = this.productEntity;
    if (entity ? !doer?.giveEntity?.(entity, position)
      : this.product !== undefined && !doer?.giveItem(this.product, this.numToHarvest, position)) return false;
    // Lua invokes the prefab callback while canbepicked is still true, then clears it.
    batch(() => {
      if (this.transplanted.peek() && this.cycles.peek() !== undefined) this.cycles.set(Math.max(0, this.cycles.peek()! - 1));
      if (this.protection.peek() !== undefined) {
        const protection = this.protection.peek()! - 1;
        this.protection.set(protection > 0 ? protection : undefined);
        if (protection <= 0) this.model.userData.components?.witherable?.Enable(true);
      }
      this.onPicked(doer);
      this.ready.set(false);
      if (this.regrowTime !== undefined && !this.paused.peek() && !this.IsBarren() && !this.model.userData.tags?.includes('withered')) this.timer.start(this.nextGrowthDuration());
      else this.timer.stop();
      this.refreshTag();
    });
    this.model.dispatchEvent({ type: 'picked', data: { picker: doer?.picker ?? doer, loot: doer?.loot, plant: this.model } } as never);
    if (this.remove_when_picked) {
      this.callbacks?.onRemove?.();
      this.dispose();
    }
    return true;
  }

  regen(): void {
    if (this.removed.peek()) return;
    if (this.timer.snapshot.peek().status === 'scheduled') this.timer.stop();
    batch(() => { this.ready.set(true); this.refreshTag(); this.onRegen(); });
  }

  /** pickable.lua FinishGrowing: only a pending regrow task completes early; paused plants keep waiting. */
  finishGrowing(): boolean {
    if (this.removed.peek() || this.ready.peek() || this.timer.snapshot.peek().status !== 'scheduled') return false;
    this.regen();
    return true;
  }

  pause(): void {
    if (this.removed.peek() || this.paused.peek()) return;
    batch(() => { this.paused.set(true); this.timer.pause(); });
  }

  resume(): void {
    if (this.removed.peek() || !this.paused.peek()) return;
    batch(() => {
      this.paused.set(false);
      if (this.regrowTime !== undefined && !this.ready.peek() && !this.IsBarren()) this.timer.start(this.timer.remainingSeconds === undefined
        ? this.nextGrowthDuration() : this.growthDuration(this.timer.remainingSeconds));
    });
  }

  /** Standalone components own a local clock; scene components use the shared scheduler. */
  update(dt: number): void { if (this.ownsScheduler && !this.removed.peek()) this.scheduler.advance(dt); }

  exportState(): PickableSaveState {
    return { ...(!this.ready.peek() ? { picked: true } : {}),
      ...(this.timer.remainingSeconds !== undefined ? { regrowSeconds: this.timer.remainingSeconds } : {}),
      ...(this.paused.peek() ? { paused: true } : {}),
      ...(this.transplanted.peek() ? { transplanted: true } : {}),
      ...(this.maxCycles === undefined ? {} : { cyclesLeft: this.cycles.peek(), maxCycles: this.maxCycles }),
      ...(this.protection.peek() === undefined ? {} : { protectedCycles: this.protection.peek() }) };
  }

  dispose(): void {
    if (this.removed.peek()) return;
    batch(() => { this.removed.set(true); this.timer.stop(); this.refreshTag(); });
    this.phaseMemo.dispose(); this.regrowingMemo.dispose();
    this.getProductEntity = undefined;
    if (this.ownsScheduler) this.scheduler.dispose();
    if (this.model.userData.components?.pickable === this) delete this.model.userData.components.pickable;
  }

  private nextGrowthDuration(): number {
    return this.growthDuration(this.callbacks?.getRegenTime?.(this) ?? this.regrowTime!);
  }

  private refreshTag(): void {
    setModelTag(this.model, 'pickable', this.canBePicked && this.canInteractWith);
    setModelTag(this.model, 'barren', !this.removed.peek() && this.IsBarren());
  }
}
