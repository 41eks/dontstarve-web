import type { Vector3 } from 'three';
import type { GameTimeScheduler } from './gameTimeScheduler';
import type { Fishable, HookedFish } from './fishable';
import { ComponentTimer } from './timer';

/** The fishing doer: its stategraph tags gate the rod's per-frame validity check. */
export interface Fisherman {
  PushEvent(name: string, data?: unknown): void;
  getPosition(): Vector3;
  isValid(): boolean;
  hasStateTag(tag: string): boolean;
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

  constructor(inst: FishingRodInst, scheduler: GameTimeScheduler, world: FishingWorld) {
    this.inst = inst;
    this.world = world;
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
  bind(scheduler: GameTimeScheduler, world?: FishingWorld): void {
    if (scheduler !== this.scheduler) {
      this.StopFishing();
      this.scheduler = scheduler;
      this.fishtask = this.createTimer(scheduler);
    }
    if (world) this.world = world;
  }

  SetWaitTimes(min: number, max: number): void { this.minwaittime = min; this.maxwaittime = max; }
  SetStrainTimes(min: number, max: number): void { this.minstraintime = min; this.maxstraintime = max; }

  /** OnUpdate: fishing ends when the fisherman leaves the fishing states or the rod is unequipped. */
  OnUpdate(): void {
    if (!this.IsFishing()) return;
    const fisherman = this.fisherman!;
    if (!fisherman.isValid() || (!fisherman.hasStateTag('fishing') && !fisherman.hasStateTag('catchfish'))
      || !this.inst.isEquipped()) this.StopFishing();
  }

  IsFishing(): boolean { return this.target !== undefined && this.fisherman !== undefined; }
  HasHookedFish(): boolean { return this.target !== undefined && this.hookedfish !== undefined; }
  HasCaughtFish(): boolean { return this.caughtfish !== undefined; }
  FishIsBiting(): boolean { return this.fisherman?.hasStateTag('nibble') ?? false; }

  StartFishing(target: FishingTarget, fisherman: Fisherman): void {
    this.StopFishing();
    if (!target.components.fishable) return;
    this.target = target;
    this.fisherman = fisherman;
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
    const position = this.fisherman.getPosition();
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
