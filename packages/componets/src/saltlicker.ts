export interface SaltLickerInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
  PushEvent(name: string, data?: unknown): void;
}

/** tuning.lua SALTLICK_DURATION: total_day_time / 8. */
export const SALTLICK_DURATION = 480 / 8;

/**
 * components/saltlicker.lua, minimal: the `saltlicker` tag, the uses per lick SetUp records and `salted` with its
 * `saltlicker_salted` tag and `saltchange` event. Salt licks are not ported, so nothing seeks one: SetUp's listeners
 * (timerdone, limbo, sleep, freeze, death) and the salt timer are not started, and the licker is never salted.
 */
export class SaltLicker {
  salted = false;
  saltedduration = SALTLICK_DURATION;
  uses_per_lick?: number;
  private readonly inst: SaltLickerInst;

  constructor(inst: SaltLickerInst) {
    this.inst = inst;
    inst.addTag('saltlicker');
  }

  SetUp(uses_per_lick: number | undefined): void {
    this.Stop();
    this.uses_per_lick = uses_per_lick;
  }

  Stop(): void {
    if (this.uses_per_lick === undefined) { return; }
    this.SetSalted(false);
    this.uses_per_lick = undefined;
  }

  SetSalted(salted: boolean): void {
    if (this.salted === salted) { return; }
    this.salted = salted;
    if (salted) { this.inst.addTag('saltlicker_salted'); } else { this.inst.removeTag('saltlicker_salted'); }
    this.inst.PushEvent('saltchange', { salted });
  }

  /** saltlicker.lua OnSave: only a salted licker saves. */
  OnSave(): { salted: true } | undefined { return this.salted ? { salted: true } : undefined; }

  OnRemoveFromEntity(): void {
    this.Stop();
    this.inst.removeTag('saltlicker');
    this.inst.removeTag('saltlicker_salted');
  }
}
