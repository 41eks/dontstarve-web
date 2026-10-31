import type { Vector3 } from 'three';
import type { GameTimeScheduler } from './gameTimeScheduler';
import type { Fishable, HookedFish } from './fishable';
import { ComponentTimer } from './timer';
import type { ComponentUpdates } from './componentUpdates';

/** The fishing doer inst: its events reach its stategraph, whose tags gate the rod each frame. */
export interface Fisherman {
  PushEvent(name: string, data?: unknown): void;
  getPosition(): Vector3;
  readonly sg?: { HasStateTag(tag: string): boolean };
  /** inst:IsValid(); a doer without one is taken as valid. */
  IsValid?(): boolean;
}

export interface FishingTarget {
  readonly components: { fishable?: Fishable };
  getPosition(): Vector3;
}

export interface FishingRodInst {
  addTag(tag: string): void;
  PushEvent(name: string, data?: unknown): void;
  /** finiteuses:GetPercent(), absent when the rod has no durability. */
  getDurabilityPercent(): number | undefined;
  isEquipped(): boolean;
}

/** World services a landed fish needs: the fish becomes an ordinary ground item. */
export interface FishingWorld {
  landFish(fish: HookedFish, position: Vector3): void;
}

type FishTask = 'nibble' | 'loserod';

/** fishingrod.lua: DoTaskInTime(nibble/loserod) is one game-time timer owned by the rod. */
export class FishingRod {
  target: FishingTarget | undefined;
  fisherman: Fisherman | undefined;
  hookedfish: HookedFish | undefined;
  caughtfish: HookedFish | undefined;
  minwaittime = 0;
  maxwaittime = 10;
  minstraintime = 0;
  maxstraintime = 6;
  private caughtPosition: Vector3 | undefined;
  private fishAction: FishTask | undefined;
  private fishtask: ComponentTimer;
  private scheduler: GameTimeScheduler;
  private readonly inst: FishingRodInst;
  private world: FishingWorld;
  private updates?: ComponentUpdates;
  private stopUpdating?: () => void;

  constructor(inst: FishingRodInst, scheduler: GameTimeScheduler, world: FishingWorld, updates?: ComponentUpdates) {
    this.inst = inst;
    this.world = world;
    this.updates = updates;
    this.scheduler = scheduler;
    this.fishtask = this.createTimer(scheduler);
    inst.addTag('fishingrod');
  }

  get fishTaskSnapshot() { return this.fishtask.snapshot; }

  private createTimer(scheduler: GameTimeScheduler): ComponentTimer {
    return new ComponentTimer(scheduler, () => {
      const action = this.fishAction;
      this.fishAction = undefined;
      const fisherman = this.fisherman;
      if (!fisherman) return;
      this.inst.PushEvent(action === 'nibble' ? 'fishingnibble' : 'fishingloserod');
      fisherman.PushEvent(action === 'nibble' ? 'fishingnibble' : 'fishingloserod');
    });
  }

  /** The rod's inst is created with the item; the scene's scheduler is attached when it is first used. */
  bind(scheduler: GameTimeScheduler, world?: FishingWorld, updates?: ComponentUpdates): void {
    if (scheduler !== this.scheduler || (updates && updates !== this.updates)) {
      this.StopFishing();
      this.scheduler = scheduler;
      this.fishtask = this.createTimer(scheduler);
    }
    if (world) this.world = world;
    if (updates) this.updates = updates;
  }

  SetWaitTimes(min: number, max: number): void { this.minwaittime = min; this.maxwaittime = max; }
  SetStrainTimes(min: number, max: number): void { this.minstraintime = min; this.maxstraintime = max; }

  /** OnUpdate: fishing ends when the fisherman leaves the fishing states or the rod is unequipped. */
  OnUpdate(): void {
    if (!this.IsFishing()) return;
    const fisherman = this.fisherman!;
    if (fisherman.IsValid?.() === false || (!fisherman.sg?.HasStateTag('fishing') && !fisherman.sg?.HasStateTag('catchfish'))
      || !this.inst.isEquipped()) this.StopFishing();
  }

  IsFishing(): boolean { return this.target !== undefined && this.fisherman !== undefined; }
  HasHookedFish(): boolean { return this.target !== undefined && this.hookedfish !== undefined; }
  HasCaughtFish(): boolean { return this.caughtfish !== undefined; }
  FishIsBiting(): boolean { return this.fisherman?.sg?.HasStateTag('nibble') ?? false; }

  StartFishing(target: FishingTarget, fisherman: Fisherman): void {
    this.StopFishing();
    if (!target.components.fishable) return;
    this.target = target;
    this.fisherman = fisherman;
    // inst:StartUpdatingComponent(self): OnUpdate watches the fisherman's state each frame.
    this.stopUpdating = this.updates?.register(this);
  }

  WaitForFish(): void {
    const fishable = this.target?.components.fishable;
    if (!fishable) return;
    const fishleft = fishable.GetFishPercent();
    this.CancelFishTask();
    if (fishleft > 0) this.startTask('nibble', this.minwaittime + (1 - fishleft) * (this.maxwaittime - this.minwaittime));
  }

  private startTask(action: FishTask, seconds: number): void {
    this.fishAction = action;
    this.fishtask.start(seconds);
  }

  CancelFishTask(): void {
    this.fishAction = undefined;
    this.fishtask.stop();
  }

  StopFishing(): void {
    this.stopUpdating?.(); this.stopUpdating = undefined;
    if (this.target && this.fisherman) {
      this.fisherman.PushEvent('fishingcancel');
      this.target = undefined;
      this.fisherman = undefined;
    }
    this.CancelFishTask();
    this.hookedfish = undefined;
    this.caughtfish = undefined;
    this.caughtPosition = undefined;
  }

  Hook(): void {
    const fishable = this.target?.components.fishable;
    if (!fishable || !this.fisherman) return;
    this.hookedfish = fishable.HookFish(this.fisherman);
    const durability = this.inst.getDurabilityPercent();
    if (durability !== undefined) {
      this.startTask('loserod', this.minstraintime + durability * (this.maxstraintime - this.minstraintime));
    }
    this.inst.PushEvent('fishingstrain');
    this.fisherman.PushEvent('fishingstrain');
  }

  Release(): void {
    const fishable = this.target?.components.fishable;
    if (fishable && this.hookedfish) {
      fishable.ReleaseFish(this.hookedfish);
      this.StopFishing();
    }
  }

  Reel(): void {
    const fishable = this.target?.components.fishable;
    if (!fishable || !this.hookedfish || !this.fisherman) return;
    this.caughtfish = fishable.RemoveFish(this.hookedfish);
    this.hookedfish = undefined;
    this.CancelFishTask();
    if (!this.caughtfish) return;
    // The fish lands one unit beyond the fisherman, directly away from the water.
    const position = this.fisherman.getPosition().clone().setY(0);
    this.caughtPosition = position.clone().add(position.clone().sub(this.target!.getPosition()).normalize());
    const data = { build: this.caughtfish.build };
    this.inst.PushEvent('fishingcatch', data);
    this.fisherman.PushEvent('fishingcatch', data);
  }

  Collect(): void {
    const fish = this.caughtfish;
    if (!fish || !this.fisherman || !this.caughtPosition) return;
    this.world.landFish(fish, this.caughtPosition);
    this.inst.PushEvent('fishingcollect', { fish });
    this.fisherman.PushEvent('fishingcollect', { fish });
    this.StopFishing();
  }

  dispose(): void { this.StopFishing(); }
}
