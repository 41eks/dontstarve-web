import { createSignal, readonlySignal, WorldContentKey, type GetWatchWorldContent } from '../../signals/src';
import type { EventListening } from './entityEvents';
import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';

/** acidsmoke_fx as AcidInfusible:SpawnFX / KillFX use it. */
export interface AcidSmokeFx {
  SetLevel(level: number): void;
  /** KillFX: the smoke finishes its current clip (plus a frame) and removes itself. */
  Kill(): void;
}

/** inst:SpawnChild("acidsmoke_fx"); the prefab layer provides it, as burnable's fx spawner. */
export type AcidSmokeSpawner = () => AcidSmokeFx | undefined;

export interface AcidInfusibleInst {
  /** Whether components.rainimmunity is among them. */
  readonly components: object;
  ListenForEvent: EventListening['ListenForEvent'];
}

/**
 * components/acidinfusible.lua: infused while the world acid rains and rain immunity (when used) does not cover the
 * entity. Infusing spawns the acidsmoke_fx child at `fxlevel` and calls the prefab's on_infuse_fn; uninfusing kills the
 * smoke and calls on_uninfuse_fn. The damage, damage-taken and speed multipliers need combat's and locomotor's external
 * multipliers, which those components do not have here yet.
 */
export class AcidInfusible {
  private readonly inst: AcidInfusibleInst;
  private readonly infusedState = createSignal(false);
  /** IsInfused as state. */
  readonly infused = readonlySignal(this.infusedState);
  userainimmunity = true;
  fxlevel: number | undefined = 1;
  on_infuse_fn?: (inst: AcidInfusibleInst) => void;
  on_uninfuse_fn?: (inst: AcidInfusibleInst) => void;
  private spawnfx?: AcidSmokeSpawner;
  private fx?: AcidSmokeFx;
  private readonly isacidraining: () => boolean;
  private readonly initialize: ComponentTimer;
  private readonly cleanups: (() => void)[] = [];

  constructor(inst: AcidInfusibleInst, scheduler: GameTimeScheduler, getWatchWorldContent?: GetWatchWorldContent) {
    this.inst = inst;
    // WatchWorldState("isacidraining", on_is_acid_raining): called when it changes, not at registration.
    const acidraining = getWatchWorldContent?.(WorldContentKey.IsAcidRaining, stop => this.cleanups.push(stop));
    this.isacidraining = () => acidraining?.peek() ?? false;
    if (acidraining) {
      this.cleanups.push(acidraining.subscribe(raining => this.OnInfusedDirty(raining, this.hasRainImmunity())));
    }
    this.cleanups.push(
      inst.ListenForEvent('gainrainimmunity', () => this.OnInfusedDirty(this.isacidraining(), true)),
      inst.ListenForEvent('loserainimmunity', () => this.OnInfusedDirty(this.isacidraining(), false)),
    );
    // DoTaskInTime(0, on_initialize): LoadPostPass without regard to save data.
    this.initialize = new ComponentTimer(scheduler, () =>
      this.OnInfusedDirty(this.isacidraining(), this.hasRainImmunity()),
    );
    this.initialize.start(0);
  }

  /** self.inst.components.rainimmunity ~= nil. */
  private hasRainImmunity(): boolean {
    const components: { readonly rainimmunity?: unknown } = this.inst.components;
    return components.rainimmunity !== undefined;
  }

  SetFXSpawner(spawn: AcidSmokeSpawner): void {
    this.spawnfx = spawn;
  }

  SetOnInfuseFn(fn: (inst: AcidInfusibleInst) => void): void {
    this.on_infuse_fn = fn;
  }

  SetOnUninfuseFn(fn: (inst: AcidInfusibleInst) => void): void {
    this.on_uninfuse_fn = fn;
  }

  SetUseRainImmunity(userainimmunity: boolean): void {
    if (userainimmunity !== this.userainimmunity) {
      this.userainimmunity = userainimmunity;
      this.OnInfusedDirty(this.isacidraining(), this.hasRainImmunity());
    }
  }

  /** SetFXLevel(level); SetFXLevel() spawns no smoke. */
  SetFXLevel(level?: number): void {
    this.fxlevel = level;
    if (this.fx && level !== undefined) {
      this.fx.SetLevel(level);
    }
  }

  IsInfused(): boolean {
    return this.infusedState.peek();
  }

  private OnInfuse(): void {
    if (this.fxlevel !== undefined) {
      this.SpawnFX();
    }
    this.on_infuse_fn?.(this.inst);
  }

  private OnUninfuse(): void {
    this.KillFX();
    this.on_uninfuse_fn?.(this.inst);
  }

  OnInfusedDirty(acidraining: boolean, hasrainimmunity: boolean): void {
    const infused = acidraining && !(this.userainimmunity && hasrainimmunity);
    if (infused && !this.infusedState.peek()) {
      this.OnInfuse();
      this.infusedState.set(true);
    } else if (!infused && this.infusedState.peek()) {
      this.OnUninfuse();
      this.infusedState.set(false);
    }
  }

  private SpawnFX(): void {
    this.KillFX();
    this.fx = this.spawnfx?.();
    if (this.fx && this.fxlevel !== undefined) {
      this.fx.SetLevel(this.fxlevel);
    }
  }

  private KillFX(): void {
    this.fx?.Kill();
    this.fx = undefined;
  }

  OnRemoveFromEntity(): void {
    this.cleanups.splice(0).forEach(stop => stop());
    this.initialize.stop();
  }
}
