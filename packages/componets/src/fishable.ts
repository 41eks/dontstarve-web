import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';

export interface FishableInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
}

/** The hooked fish: its prefab and the `inst.build` that SGwilson's catchfish swaps into `fish01`. */
export interface HookedFish {
  readonly prefab: string;
  readonly build: string;
}

export interface FishableSave { fish: number }

/**
 * fishable.lua. A hooked fish stays a descriptor until it is landed, so no hidden child inst exists;
 * the respawn task is a game-time timer and `fishable` follows frozen state.
 */
export class Fishable {
  readonly fish = new Map<string, HookedFish>();
  maxfish = 10;
  fishleft = 10;
  readonly hookedfish = new Set<HookedFish>();
  fishrespawntime: number | undefined;
  private getfishfn: ((inst: FishableInst, fisherman: unknown) => string | undefined) | undefined;
  private frozen = false;
  private readonly respawn: ComponentTimer;
  private readonly inst: FishableInst;

  constructor(inst: FishableInst, scheduler: GameTimeScheduler) {
    this.inst = inst;
    this.respawn = new ComponentTimer(scheduler, () => this.onRespawn());
    inst.addTag('fishable');
  }

  get respawnTimer() { return this.respawn.snapshot; }

  AddFish(prefab: string, build = prefab): void { this.fish.set(prefab, { prefab, build }); }
  SetGetFishFn(fn: Fishable['getfishfn']): void { this.getfishfn = fn; }
  SetRespawnTime(time: number): void { this.fishrespawntime = time; }

  HookFish(fisherman?: unknown): HookedFish | undefined {
    const prefabs = [...this.fish.keys()];
    const prefab = this.getfishfn?.(this.inst, fisherman) ?? prefabs[Math.floor(Math.random() * prefabs.length)];
    const fish = prefab === undefined ? undefined : this.fish.get(prefab);
    if (!fish) return undefined;
    this.hookedfish.add(fish);
    if (this.fishleft > 0) this.fishleft--;
    return fish;
  }

  ReleaseFish(fish: HookedFish): void {
    if (!this.hookedfish.delete(fish)) return;
    if (this.fishleft < this.maxfish) this.fishleft++;
  }

  RemoveFish(fish: HookedFish): HookedFish | undefined {
    if (!this.hookedfish.delete(fish)) return undefined;
    if (this.respawn.snapshot.peek().status !== 'scheduled') this.RefreshFish();
    return fish;
  }

  IsFrozenOver(): boolean { return this.frozen; }
  Freeze(): void { this.setFrozen(true); }
  Unfreeze(): void { this.setFrozen(false); }

  private setFrozen(frozen: boolean): void {
    if (frozen === this.frozen) return;
    this.frozen = frozen;
    if (frozen) this.inst.removeTag('fishable');
    else this.inst.addTag('fishable');
  }

  RefreshFish(): void {
    if (this.fishrespawntime !== undefined) this.respawn.start(this.fishrespawntime);
  }

  GetFishPercent(): number { return this.fishleft / this.maxfish; }

  private onRespawn(): void {
    if (this.fishleft < this.maxfish) {
      this.fishleft++;
      if (this.fishleft < this.maxfish) this.RefreshFish();
    }
  }

  OnSave(): FishableSave | undefined {
    return this.fishleft < this.maxfish ? { fish: this.fishleft } : undefined;
  }

  OnLoad(data?: FishableSave): void {
    if (!data) return;
    this.fishleft = data.fish;
    this.RefreshFish();
  }

  OnRemoveFromEntity(): void {
    this.respawn.stop();
    this.inst.removeTag('fishable');
  }
}
