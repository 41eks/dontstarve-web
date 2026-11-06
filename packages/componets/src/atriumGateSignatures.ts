/** Components of atrium_gate.lua outside this display/save port: they keep and restore their saved records, nothing runs. */

/** charliecutscene.lua OnSave. */
export interface CharlieCutsceneSave { running?: true; gatefixed?: true }
export const ATRIUM_GATE_TIMER_NAMES = ['destabilizing', 'destabilizedelay', 'cooldown'] as const;
export type AtriumGateTimerName = typeof ATRIUM_GATE_TIMER_NAMES[number];
/** worldsettingstimer.lua OnSave, per active timer. */
export interface AtriumGateTimerSave {
  timeleft: number; paused: boolean; blocklongupdate?: boolean; initial_time?: number;
}
export interface WorldSettingsTimerSave { timers: Partial<Record<AtriumGateTimerName, AtriumGateTimerSave>> }
/** entitytracker.lua OnSave. */
export interface EntityTrackerSave { entities: { name: string; GUID: number }[] }

export class CharlieCutscene {
  private saved?: CharlieCutsceneSave;
  constructor(_inst: object) {}
  /** OnLoad: a running cutscene is skipped, which repairs the gate. */
  IsGateRepaired(): boolean { return this.saved?.gatefixed === true || this.saved?.running === true; }
  OnSave(): CharlieCutsceneSave | undefined { return this.saved && structuredClone(this.saved); }
  OnLoad(data: CharlieCutsceneSave): void { this.saved = structuredClone(data); }
}

export class WorldSettingsTimer {
  private saved?: WorldSettingsTimerSave;
  constructor(_inst: object) {}
  ActiveTimerExists(name: AtriumGateTimerName): boolean { return this.saved?.timers[name] !== undefined; }
  OnSave(): WorldSettingsTimerSave | undefined { return this.saved && structuredClone(this.saved); }
  OnLoad(data: WorldSettingsTimerSave): void { this.saved = structuredClone(data); }
}

export class EntityTracker {
  /** The saved names and GUIDs; LoadPostPass's entities are not tracked. */
  saved?: EntityTrackerSave;
  constructor(_inst: object) {}
  OnSave(): EntityTrackerSave | undefined { return this.saved && structuredClone(this.saved); }
  OnLoad(data: EntityTrackerSave): void { this.saved = structuredClone(data); }
}

export class ColourTweener { constructor(_inst: object) {} }
