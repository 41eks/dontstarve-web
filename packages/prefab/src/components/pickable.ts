import * as THREE from 'three';
import { batch, createMemo, createSignal, readonlySignal } from '@dontstarve-web/signals';
import type { PickableComponent, PickDoer } from '@dontstarve-web/stategraphs/pick';
import { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';
import type { ItemEntity } from '@dontstarve-web/inventory';

export interface PickableSaveState {
  picked?: boolean;
  regrowSeconds?: number;
  paused?: boolean;
}

export interface PickableTiming {
  scheduler: GameTimeScheduler;
  /** simutil.lua SpringGrowthMod, evaluated only when setting/resuming a task. */
  growthDuration?: (seconds: number) => number;
}

/** pickable.lua: component data, regeneration tasks, tags and synchronous domain transitions. */
export class Pickable implements PickableComponent {
  private readonly ready = createSignal(true);
  private readonly interactable = createSignal(true);
  private readonly removed = createSignal(false);
  private readonly paused = createSignal(false);
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly growthDuration: (seconds: number) => number;
  private readonly timer: ComponentTimer;
  private readonly phaseMemo = createMemo(() => this.removed.get() ? 'removed'
    : this.ready.get() ? 'ready' : 'picked');
  private readonly regrowingMemo;
  readonly state;
  /** pickable.lua quickpick defaults to false; SGwilson reads this field. */
  quickpick = false;
  /** Prefabs retaining an original item provide it instead of spawning a product copy. */
  getProductEntity?: () => ItemEntity | undefined;
  get productEntity(): ItemEntity | undefined { return this.getProductEntity?.(); }

  private readonly model: THREE.Object3D;
  private productName: string;
  private regrowTime: number;
  private harvestCount: number;
  private readonly onPicked: () => void;
  private readonly onRegen: () => void;

  constructor(model: THREE.Object3D, product: string, regenTime: number,
    numToHarvest = 1, onPicked: () => void = () => {},
    onRegen: () => void = () => {}, saved?: PickableSaveState, timing?: PickableTiming) {
    this.model = model; this.productName = product; this.regrowTime = regenTime;
    this.harvestCount = numToHarvest; this.onPicked = onPicked; this.onRegen = onRegen;
    this.scheduler = timing?.scheduler ?? new GameTimeScheduler();
    this.ownsScheduler = !timing;
    this.growthDuration = timing?.growthDuration ?? (seconds => seconds);
    this.timer = new ComponentTimer(this.scheduler, () => this.regen());
    this.regrowingMemo = createMemo(() => this.timer.snapshot.get().status === 'scheduled');
    this.state = Object.freeze({ canBePicked: readonlySignal(this.ready), canInteractWith: readonlySignal(this.interactable),
      removed: readonlySignal(this.removed), paused: readonlySignal(this.paused), timer: this.timer.snapshot,
      phase: readonlySignal(this.phaseMemo), regrowing: readonlySignal(this.regrowingMemo) });
    this.ready.set(!saved?.picked);
    this.paused.set(saved?.paused ?? false);
    if (saved?.regrowSeconds !== undefined) {
      if (saved.paused) this.timer.restorePaused(saved.regrowSeconds);
      else this.timer.start(saved.regrowSeconds);
    }
    model.userData.components = { ...model.userData.components, pickable: this };
    this.refreshTag();
  }

  get product(): string { return this.productName; }
  get regenTime(): number { return this.regrowTime; }
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
  get canInteractWith(): boolean { return this.interactable.peek(); }
  set canInteractWith(value: boolean) { this.interactable.set(value); this.refreshTag(); }
  get remainingSeconds(): number | undefined { return this.timer.remainingSeconds; }

  pick(doer: PickDoer): boolean {
    if (!this.canBePicked || !this.canInteractWith) return false;
    const position = this.model.getWorldPosition(new THREE.Vector3()), entity = this.productEntity;
    if (!(entity ? doer.giveEntity?.(entity, position) : doer.giveItem(this.product, this.numToHarvest, position))) return false;
    // Lua invokes the prefab callback while canbepicked is still true, then clears it.
    batch(() => {
      this.onPicked();
      this.ready.set(false);
      if (!this.paused.peek()) this.timer.start(this.growthDuration(this.regrowTime));
      else this.timer.stop();
      this.refreshTag();
    });
    this.model.dispatchEvent({ type: 'picked', data: { picker: doer, loot: doer.loot, plant: this.model } } as never);
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
      if (!this.ready.peek()) this.timer.start(this.growthDuration(this.timer.remainingSeconds ?? this.regrowTime));
    });
  }

  /** Standalone components own a local clock; scene components use the shared scheduler. */
  update(dt: number): void { if (this.ownsScheduler && !this.removed.peek()) this.scheduler.advance(dt); }

  exportState(): PickableSaveState {
    return { ...(!this.ready.peek() ? { picked: true } : {}),
      ...(this.timer.remainingSeconds !== undefined ? { regrowSeconds: this.timer.remainingSeconds } : {}),
      ...(this.paused.peek() ? { paused: true } : {}) };
  }

  dispose(): void {
    if (this.removed.peek()) return;
    batch(() => { this.removed.set(true); this.timer.stop(); this.refreshTag(); });
    this.phaseMemo.dispose(); this.regrowingMemo.dispose();
    this.getProductEntity = undefined;
    if (this.ownsScheduler) this.scheduler.dispose();
    if (this.model.userData.components?.pickable === this) delete this.model.userData.components.pickable;
  }

  private refreshTag(): void {
    const tags: string[] = this.model.userData.tags ??= [];
    const index = tags.indexOf('pickable');
    if (this.canBePicked && this.canInteractWith) { if (index < 0) tags.push('pickable'); }
    else if (index >= 0) tags.splice(index, 1);
  }
}
