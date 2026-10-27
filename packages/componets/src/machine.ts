import { createSignal, readonlySignal, type ReadonlySignal } from '../../signals/src';
import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';

export interface MachineInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
  PushEvent(event: string, data?: unknown): void;
}

/**
 * machine.lua: TurnOn / TurnOff run the prefab's functions and mirror `ison`, `enabled` and the cooldown as the
 * `turnedon`, `enabled`, `cooldown` and `groundonlymachine` tags that componentactions read. The cooldown is a game-time task.
 */
export class Machine {
  private readonly inst: MachineInst;
  private readonly scheduler?: () => GameTimeScheduler | undefined;
  private readonly isonState = createSignal(false);
  readonly ison: ReadonlySignal<boolean> = readonlySignal(this.isonState);
  private cooldownTimer?: ComponentTimer;
  private oncooldownValue = false;
  private enabledValue = true;
  turnonfn?: (inst: MachineInst) => void;
  turnofffn?: (inst: MachineInst) => void;
  cooldowntime = 3;

  /** `scheduler` is the inst's game time, needed only for a cooldown. */
  constructor(inst: MachineInst, scheduler?: () => GameTimeScheduler | undefined) {
    this.inst = inst; this.scheduler = scheduler;
    inst.addTag('enabled');
  }

  /** SetGroundOnlyMachine: the `groundonlymachine` tag keeps a held or floating machine from being switched. */
  SetGroundOnlyMachine(groundonly: boolean): void {
    if (groundonly) this.inst.addTag('groundonlymachine'); else this.inst.removeTag('groundonlymachine');
  }

  IsOn(): boolean { return this.isonState.peek(); }
  /** Prefab turnon/turnoff functions set ison themselves, as mininglantern.lua does. */
  set isOn(ison: boolean) {
    this.isonState.set(ison);
    if (ison) this.inst.addTag('turnedon'); else this.inst.removeTag('turnedon');
  }
  get enabled(): boolean { return this.enabledValue; }
  set enabled(enabled: boolean) {
    this.enabledValue = enabled;
    if (enabled) this.inst.addTag('enabled'); else this.inst.removeTag('enabled');
  }
  get oncooldown(): boolean { return this.oncooldownValue; }
  private set oncooldown(oncooldown: boolean) {
    this.oncooldownValue = oncooldown;
    if (oncooldown) this.inst.addTag('cooldown'); else this.inst.removeTag('cooldown');
  }

  OnSave(): { ison: boolean } { return { ison: this.IsOn() }; }
  OnLoad(data: { ison?: boolean } | undefined): void {
    if (!data) return;
    this.isOn = data.ison === true;
    if (this.IsOn()) this.TurnOn(); else this.TurnOff();
  }

  StartCooldown(): void {
    if (this.cooldowntime <= 0) return;
    const scheduler = this.scheduler?.();
    if (!scheduler) throw new Error('A machine cooldown needs the inst\'s game time');
    this.oncooldown = true;
    this.cooldownTimer?.stop();
    this.cooldownTimer = new ComponentTimer(scheduler, () => { this.oncooldown = false; });
    this.cooldownTimer.start(this.cooldowntime);
  }
  StopCooldown(): void {
    if (!this.cooldownTimer) return;
    this.cooldownTimer.stop();
    this.cooldownTimer = undefined;
    this.oncooldown = false;
  }

  TurnOn(): void {
    this.StartCooldown();
    this.turnonfn?.(this.inst);
    this.isOn = true;
    this.inst.PushEvent('machineturnedon');
  }
  TurnOff(): void {
    this.StartCooldown();
    this.turnofffn?.(this.inst);
    this.isOn = false;
    this.inst.PushEvent('machineturnedoff');
  }

  /** machine.lua OnRemoveFromEntity. */
  dispose(): void {
    this.StopCooldown();
    this.inst.removeTag('turnedon');
    this.inst.removeTag('cooldown');
    this.inst.removeTag('groundonlymachine');
  }
}
