import type { Vector3 } from 'three';
import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';
import type { SlipperyFeetTarget } from './slipperyfeettarget';

// components/slipperyfeet.lua. Speeds are DST units per second (TUNING.WILSON_RUN_SPEED = 6).
export const SLIPPERY_CHECK_RADIUS = 12;
export const SLIPPERY_SLOWCHECK_FREQUENCY = 1;
export const WILSON_RUN_SPEED = 6;

export interface SlipperyFeetEntity {
  readonly components: { slipperyfeettarget?: SlipperyFeetTarget };
}

/** What slipperyfeet.lua reads from its entity, physics and stategraph. */
export interface SlipperyFeetInst {
  getPosition(): Vector3;
  /** Physics:GetMotorSpeed in DST units. */
  getMotorSpeed(): number;
  PushEvent(name: string, data?: unknown): void;
  readonly sg: {
    hasStateTag(tag: string): boolean;
    hasAnyStateTag(...tags: string[]): boolean;
    listenForEvent(name: string, fn: (data: unknown) => void): () => void;
  };
}

export interface SlipperyFeetOptions {
  scheduler: GameTimeScheduler;
  /** TheSim:FindEntities(x, 0, z, radius, {"slipperyfeettarget"}). */
  findSlipperyEntities(position: Vector3, radius: number): readonly SlipperyFeetEntity[];
  random?: () => number;
}

/**
 * Accumulates slipperiness while the owner runs over a slipperyfeettarget and pushes "feetslipped".
 * Ocean ice, nonslipgrit and spinning are not ported. The host calls update(dt) each frame, which
 * does nothing unless a Lua StartUpdatingComponent reason is active.
 */
export class SlipperyFeet {
  readonly threshold = WILSON_RUN_SPEED * 4;
  readonly decay_accel = WILSON_RUN_SPEED * 2;
  decay_spd = 0;
  slippiness = 0;
  private readonly sources = new Map<string, Set<unknown>>();
  private readonly updating = new Set<string>();
  private started = false;
  private stopNewState?: () => void;
  private disposed = false;
  private readonly slowCheck: ComponentTimer;
  private readonly inst: SlipperyFeetInst;
  private readonly options: SlipperyFeetOptions;
  private readonly random: () => number;

  constructor(inst: SlipperyFeetInst, options: SlipperyFeetOptions) {
    this.inst = inst; this.options = options; this.random = options.random ?? Math.random;
    this.slowCheck = new ComponentTimer(options.scheduler, () => this.onSlowCheck());
    this.slowCheck.start(SLIPPERY_SLOWCHECK_FREQUENCY);
  }

  get isUpdating(): boolean { return this.updating.size > 0; }
  get slowCheckState() { return this.slowCheck.snapshot; }
  IsSlippery(): boolean { return this.sources.size > 0; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.slowCheck.stop();
    this.stopInternal();
    this.updating.clear();
  }

  StartSlipperySource(src: string, key: unknown = src): void {
    let keys = this.sources.get(src);
    if (!keys) this.sources.set(src, keys = new Set());
    keys.add(key);
    this.startInternal();
  }

  StopSlipperySource(src: string, key: unknown = src): void {
    const keys = this.sources.get(src);
    keys?.delete(key);
    if (keys?.size === 0) this.sources.delete(src);
    if (this.sources.size === 0) this.stopInternal();
  }

  GetSlipperyAndNearbyEnts(): { slippery?: SlipperyFeetEntity; nearby?: SlipperyFeetEntity } {
    const position = this.inst.getPosition();
    const ents = this.options.findSlipperyEntities(position, SLIPPERY_CHECK_RADIUS);
    const slippery = ents.find(ent => ent.components.slipperyfeettarget?.IsSlipperyAtPosition(position.x, position.z));
    return { slippery, nearby: ents[0] };
  }

  private onSlowCheck(): void {
    if (this.disposed) return;
    const { slippery, nearby } = this.GetSlipperyAndNearbyEnts();
    if (!slippery && !nearby) { this.slowCheck.start(SLIPPERY_SLOWCHECK_FREQUENCY); return; }
    // Use the faster updater to see when the player leaves the zone.
    if (slippery) this.StartSlipperySource('ice_entity');
    this.startUpdating('checkiceentity');
  }

  private startInternal(): void {
    if (this.started) return;
    this.started = true;
    this.stopNewState = this.inst.sg.listenForEvent('newstate', () => this.onNewState());
    this.onNewState();
  }

  private stopInternal(): void {
    if (!this.started) return;
    this.started = false;
    this.stopNewState?.(); this.stopNewState = undefined;
    this.setAccumulating(false);
  }

  private onNewState(): void {
    const { sg } = this.inst;
    this.setAccumulating(sg.hasAnyStateTag('running', 'spinning') && !sg.hasStateTag('noslip'));
  }

  private setAccumulating(accumulating: boolean): void {
    if (accumulating) {
      if (!this.updating.has('accumulate')) { this.decay_spd = 0; this.startUpdating('accumulate'); }
    } else if (this.updating.has('accumulate')) {
      this.decay_spd = 0; this.stopUpdating('accumulate');
    }
  }

  SetCurrent(val: number): void {
    this.slippiness = val;
    if (val > 0) {
      this.startUpdating('decay');
      if (val >= this.threshold) this.inst.PushEvent('feetslipped');
    } else {
      this.decay_spd = 0;
      this.stopUpdating('decay');
    }
  }

  DoDelta(delta: number): void {
    if (delta > 0) { this.decay_spd = 0; this.SetCurrent(this.slippiness + delta); }
    else this.SetCurrent(Math.max(0, this.slippiness + delta));
  }

  CalcAccumulatingSpeed(): number {
    const speed = this.inst.getMotorSpeed();
    return speed * speed / WILSON_RUN_SPEED; // curved
  }

  private startUpdating(reason: string): void {
    if (this.disposed) return;
    if (this.updating.size === 0) this.slowCheck.stop();
    this.updating.add(reason);
  }

  private stopUpdating(reason: string): void {
    if (!this.updating.delete(reason) || this.updating.size > 0 || this.disposed) return;
    if (this.slowCheck.snapshot.peek().status !== 'scheduled') this.slowCheck.start(SLIPPERY_SLOWCHECK_FREQUENCY);
  }

  private doDecay(dt: number): void {
    let speed = this.decay_spd;
    this.decay_spd += this.decay_accel * dt;
    speed = (speed + this.decay_spd) / 2; // avg
    this.DoDelta(-speed * dt);
  }

  update(dt: number): void {
    if (this.disposed || this.updating.size === 0) return;
    let rateIceEntity = 1;
    if (this.updating.has('checkiceentity')) {
      // There is an ice entity nearby that we need to see if we still apply.
      const { slippery, nearby } = this.GetSlipperyAndNearbyEnts();
      if (!slippery) this.StopSlipperySource('ice_entity');
      else {
        this.StartSlipperySource('ice_entity');
        rateIceEntity = slippery.components.slipperyfeettarget!.GetSlipperyRate(this.inst);
      }
      if (!nearby) this.stopUpdating('checkiceentity');
    }
    if (this.updating.has('accumulate')) {
      this.DoDelta(this.CalcAccumulatingSpeed() * dt * rateIceEntity * (0.7 + 0.3 * this.random()));
    } else if (this.slippiness > 0) {
      this.doDecay(dt);
    }
  }
}
