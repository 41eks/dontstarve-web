import { createSignal, readonlySignal } from '../../signals/src';
import { ComponentTimer } from './timer';
import type { GameTimeScheduler } from './gameTimeScheduler';
import type { LuaFn } from './luaFn';

export type FreezableState = 'NORMAL' | 'FROZEN' | 'THAWING';

export interface FreezableInst {
  isValid(): boolean;
  addTag(tag: string): void;
  removeTag(tag: string): void;
  PushEvent(name: string, data?: unknown): void;
  ListenForEvent(name: string, fn: (inst: unknown, data: unknown) => void): () => void;
  StopBrain(reason: string): void;
  RestartBrain(reason: string): void;
  /** inst.entity:IsVisible(). */
  IsVisible?(): boolean;
  /** inst.AnimState:SetAddColour, the freeze tint. */
  readonly AnimState?: { SetAddColour(r: number, g: number, b: number, a?: number): void };
  readonly sg?: { hasStateTag(tag: string): boolean };
  readonly components: {
    combat?: { DropTarget(): void; BlankOutAttacks?(fortime: number): void };
    locomotor?: { Stop(): void };
    health?: { IsDead(): boolean };
  };
}

/** One AddShatterFX entry: the prefab, its offset and the symbol it follows. */
export interface ShatterFXData {
  readonly prefab: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly follow?: string;
}
/** SpawnPrefab(v.prefab), placed on the inst (or following its symbol), then shatterfx:SetLevel(level). */
export type SpawnShatterFX = (fx: ShatterFXData, level: number) => void;

export type FreezableRedirectFn = LuaFn<
  [inst: FreezableInst, coldness: number, freezetime?: number, nofreeze?: boolean],
  boolean
>;
export type FreezableOnFreezeFn = LuaFn<[inst: FreezableInst]>;

/** freezable.lua FREEZE_COLOUR. */
export const FREEZE_COLOUR = [82 / 255, 115 / 255, 124 / 255, 0] as const;

/**
 * components/freezable.lua. Coldness wears off one point per `wearofftime`; reaching the (extra) resistance freezes the
 * inst, which thaws after its freeze time and unfreezes after the thaw time. Damage breaks the ice once the total
 * reaches `damagetobreak`. The colouradder branch of the tint is not ported (no colouradder component).
 */
export class Freezable {
  resistance = 1;
  extraresist?: number;
  wearofftime = 10;
  damagetotal = 0;
  damagetobreak = 0;
  fxlevel = 1;
  readonly fxdata: ShatterFXData[] = [];
  diminishingreturns = false;
  onfreezefn?: FreezableOnFreezeFn;
  redirectfn?: FreezableRedirectFn;
  private readonly cold = createSignal(0);
  private readonly mode = createSignal<FreezableState>('NORMAL');
  readonly coldness = readonlySignal(this.cold);
  readonly state = readonlySignal(this.mode);
  /** wearofftask and diminishingtask, on game time. */
  private readonly wearofftask: ComponentTimer;
  private readonly diminishingtask: ComponentTimer;
  /** wearofftask's game-time snapshot. */
  readonly timer;
  private readonly inst: FreezableInst;
  private readonly spawnfx?: SpawnShatterFX;
  private readonly stopAttacked: () => void;

  constructor(inst: FreezableInst, scheduler: GameTimeScheduler, spawnfx?: SpawnShatterFX) {
    this.inst = inst;
    this.spawnfx = spawnfx;
    this.wearofftask = new ComponentTimer(scheduler, () => this.WearOff());
    // DoPeriodicTask(30, DecayExtraResist): re-armed after each run while it is not cancelled.
    this.diminishingtask = new ComponentTimer(scheduler, () => {
      this.diminishingtask.start(30);
      this.DecayExtraResist();
    });
    this.timer = this.wearofftask.snapshot;
    this.stopAttacked = inst.ListenForEvent('attacked', (_inst, data) =>
      this.OnAttacked(data as { damage?: number } | undefined),
    );
    inst.addTag('freezable');
  }

  private WearOff(): void {
    if (this.mode.peek() === 'FROZEN') {
      this.Thaw();
    } else if (this.mode.peek() === 'THAWING') {
      this.Unfreeze();
    } else if (this.cold.peek() > 0) {
      this.cold.set(Math.max(0, this.cold.peek() - 1));
      if (this.cold.peek() > 0) {
        this.StartWearingOff();
      }
    }
    this.UpdateTint();
  }

  private OnAttacked(data: { damage?: number } | undefined): void {
    if (this.IsFrozen() && this.inst.isValid()) {
      this.damagetotal += Math.abs(data?.damage ?? 0);
      if (this.damagetotal >= this.damagetobreak) {
        this.Unfreeze();
      }
    }
  }

  private DecayExtraResist(): void {
    const extraresist = this.extraresist ?? 0;
    const new_resist = Math.max(0, extraresist - 0.1);
    const current_resist = this.cold.peek() - this.resistance;
    if (new_resist >= current_resist) {
      this.SetExtraResist(new_resist);
    } else if (current_resist < extraresist) {
      this.SetExtraResist(current_resist);
    }
  }

  SetResistance(resist: number): void {
    this.resistance = resist;
  }
  SetDefaultWearOffTime(wearofftime: number): void {
    this.wearofftime = wearofftime;
  }
  AddShatterFX(prefab: string, offset: { x: number; y: number; z: number }, followsymbol?: string): void {
    this.fxdata.push({
      prefab,
      x: offset.x,
      y: offset.y,
      z: offset.z,
      ...(followsymbol ? { follow: followsymbol } : {}),
    });
  }
  /** SetShatterFXLevel; spawned shatter fx are not kept as fxchildren, so a level change applies to the next spawn. */
  SetShatterFXLevel(level: number): void {
    this.fxlevel = level;
  }
  SpawnShatterFX(): void {
    for (const fx of this.fxdata) {
      this.spawnfx?.(fx, this.fxlevel);
    }
  }

  IsFrozen(): boolean {
    return this.mode.peek() === 'FROZEN' || this.mode.peek() === 'THAWING';
  }
  IsThawing(): boolean {
    return this.mode.peek() === 'THAWING';
  }
  SetRedirectFn(fn: FreezableRedirectFn | undefined): void {
    this.redirectfn = fn;
  }

  AddColdness(coldness: number, freezetime?: number, nofreeze = false): void {
    if (this.redirectfn?.(this.inst, coldness, freezetime, nofreeze)) {
      return;
    }
    this.cold.set(Math.max(0, this.cold.peek() + coldness));
    if (coldness > 0) {
      if (this.IsFrozen()) {
        this.Freeze(freezetime);
      } else if (this.cold.peek() > 0) {
        const resistance = this.ResolveResistance();
        if (this.cold.peek() < resistance) {
          this.StartWearingOff();
        } else if (this.inst.sg && (nofreeze || this.inst.sg.hasStateTag('nofreeze'))) {
          this.cold.set(resistance);
          this.StartWearingOff();
        } else {
          this.Freeze(freezetime);
        }
      }
    }
    this.UpdateTint();
  }

  StartWearingOff(wearofftime?: number): void {
    this.wearofftask.start(this.ResolveWearOffTime(wearofftime ?? this.wearofftime));
  }
  GetTimeToWearOff(): number | undefined {
    return this.wearofftask.remainingSeconds;
  }

  UpdateTint(): void {
    const AnimState = this.inst.AnimState;
    if (!AnimState) {
      return;
    }
    const [r, g, b, a] = FREEZE_COLOUR;
    if (this.IsFrozen() || this.cold.peek() >= this.ResolveResistance()) {
      AnimState.SetAddColour(r, g, b, a);
    } else if (this.cold.peek() <= 0) {
      AnimState.SetAddColour(0, 0, 0, 0);
    } else {
      const percent = this.GetFreezePercent();
      AnimState.SetAddColour(r * percent, g * percent, b * percent, a * percent);
    }
  }

  SetExtraResist(resist: number): void {
    this.extraresist = Math.min(Math.max(resist, 0), this.resistance * 2.5);
    if (this.extraresist > 0) {
      if (this.diminishingtask.snapshot.peek().status !== 'scheduled') {
        this.diminishingtask.start(30);
      }
    } else {
      this.diminishingtask.stop();
    }
  }
  ResolveResistance(): number {
    return this.extraresist !== undefined
      ? Math.min(this.resistance * 2.5, this.resistance + this.extraresist)
      : this.resistance;
  }
  ResolveWearOffTime(t: number): number {
    return this.extraresist !== undefined
      ? t * Math.min(Math.max(1 - this.extraresist / (this.resistance * 2.5), 0.1), 1)
      : t;
  }
  GetFreezePercent(): number {
    return this.cold.peek() / this.ResolveResistance();
  }

  Freeze(freezetime?: number): void {
    if (!(this.inst.IsVisible?.() ?? true) || this.isDead()) {
      return;
    }
    this.onfreezefn?.(this.inst);
    // The running diminishingtask restarts its 30 second period.
    if (this.diminishingtask.snapshot.peek().status === 'scheduled') {
      this.diminishingtask.start(30);
    }
    const prevState = this.mode.peek();
    this.mode.set('FROZEN');
    this.StartWearingOff(freezetime);
    this.UpdateTint();
    this.inst.StopBrain('frozen');
    // combat:SetTarget(nil)
    this.inst.components.combat?.DropTarget();
    this.inst.components.locomotor?.Stop();
    if (prevState !== 'FROZEN') {
      this.inst.PushEvent('freeze');
      if (this.diminishingreturns) {
        this.SetExtraResist((this.extraresist ?? 0) + this.resistance * 0.25);
      }
    }
  }

  Unfreeze(): void {
    if (!this.IsFrozen()) {
      return;
    }
    this.mode.set('NORMAL');
    this.cold.set(0);
    this.damagetotal = 0;
    this.SpawnShatterFX();
    this.UpdateTint();
    if (!this.isDead()) {
      this.inst.RestartBrain('frozen');
      this.inst.PushEvent('unfreeze');
      // combat:BlankOutAttacks(0.3), where the combat component has it.
      this.inst.components.combat?.BlankOutAttacks?.(0.3);
    }
  }

  Thaw(thawtime?: number): void {
    if (!this.IsFrozen() || this.isDead()) {
      return;
    }
    this.mode.set('THAWING');
    this.cold.set(0);
    this.inst.PushEvent('onthaw');
    this.StartWearingOff(this.ResolveWearOffTime(thawtime ?? this.wearofftime));
  }

  Reset(): void {
    this.mode.set('NORMAL');
    this.cold.set(0);
    this.UpdateTint();
  }

  OnSave(): { extraresist: number } | undefined {
    return this.extraresist !== undefined && this.extraresist > 0
      ? { extraresist: Math.floor(this.extraresist * 10) * 0.1 }
      : undefined;
  }
  OnLoad(data: { extraresist?: number }): void {
    if (data.extraresist !== undefined) {
      this.SetExtraResist(data.extraresist);
    }
  }

  OnRemoveFromEntity(): void {
    this.stopAttacked();
    this.inst.removeTag('freezable');
    this.diminishingtask.stop();
    this.wearofftask.stop();
  }
  dispose(): void {
    this.OnRemoveFromEntity();
  }

  /** health:IsDead(), as freezable.lua reads it on inst.components. */
  private isDead(): boolean {
    return this.inst.components.health?.IsDead() ?? false;
  }
}
