/** One entry of a fire prefab's firefx.levels; radius is in DST units. */
export interface FireFXLevel {
  readonly anim: string;
  readonly pre?: string;
  readonly pst?: string;
  readonly sound?: string;
  readonly soundintensity?: number;
  readonly radius: number;
  readonly intensity: number;
  readonly falloff: number;
  readonly colour: readonly [number, number, number];
}

/** The firefx_light entity's inst.Light; `null` is Light:Enable(false). */
export interface FireFXLight {
  set(light: { radius: number; intensity: number; falloff: number; colour: readonly [number, number, number] } | null): void;
  /** entity:SetParent(target.entity). */
  SetParent(target: unknown): void;
  Remove(): void;
}

/** What the component drives on its fx entity: AnimState, the "fire" SoundEmitter slot and SpawnPrefab("firefx_light"). */
export interface FireFXInst {
  PlayAnimation(name: string, loop?: boolean): void;
  PushAnimation(name: string, loop?: boolean): void;
  PlaySound(path: string, name?: string): void;
  KillSound(name: string): void;
  PlayingSound(name: string): boolean;
  SetSoundParameter(name: string, parameter: string, value: number): void;
  IsAsleep(): boolean;
  SpawnLight(): FireFXLight;
}

/** components/firefx.lua: a fire level's animation, sound and light, with the light's radius flicker. */
export class FireFX {
  level?: number;
  percent = 1;
  levels: readonly FireFXLevel[] = [];
  radius_levels?: readonly number[];
  playignitesound = true;
  bigignitesoundthresh = 3;
  lightsound?: string;
  extinguishsound?: string;
  current_radius = 1;
  readonly light: FireFXLight;
  private playingsound?: string;
  private playingsoundintensity?: number;
  private lightState?: { radius: number; intensity: number; falloff: number; colour: readonly [number, number, number] };
  /** GetTime() of the flicker, advanced by OnUpdate. */
  private time = 0;
  private readonly inst: FireFXInst;

  constructor(inst: FireFXInst) {
    this.inst = inst;
    this.light = inst.SpawnLight();
    this.light.SetParent(inst);
  }

  /** The light goes with the fx entity. */
  OnRemoveEntity(): void { this.light.Remove(); }

  AttachLightTo(target: unknown): void { this.light.SetParent(target); }

  /** StartUpdatingComponent: the radius flickers around current_radius each frame. */
  OnUpdate(dt: number): void {
    this.time += dt;
    const time = this.time * 30;
    this.setLight({ radius: this.current_radius + .025 + (Math.sin(time) + Math.sin(time + 2) + Math.sin(time + .7777)) * .0125 });
  }

  GetLevelRadius(level: number): number { return this.radius_levels?.[level - 1] ?? this.levels[level - 1].radius; }

  UpdateRadius(): void {
    const high = this.GetLevelRadius(this.level!);
    const low = this.level! > 1 ? this.GetLevelRadius(this.level! - 1) : 0;
    this.current_radius = this.percent * (high - low) + low;
    this.setLight({ radius: this.current_radius });
  }

  SetPercentInLevel(percent: number): void {
    this.percent = percent;
    this.UpdateRadius();
    const low = this.levels[Math.max(1, this.level! - 1) - 1].intensity;
    const high = this.levels[this.level! - 1].intensity;
    this.setLight({ intensity: percent * (high - low) + low });
  }

  SetLevel(lev: number, immediate = false): void {
    if (!(lev > 0 && lev !== this.level)) return;
    if (this.playignitesound && (this.level === undefined || lev > this.level)) {
      this.inst.PlaySound(this.lightsound ?? (lev >= this.bigignitesoundthresh ? 'dontstarve/common/fireBurstLarge' : 'dontstarve/common/fireBurstSmall'));
    }
    if (this.level !== undefined) immediate = true;
    this.level = Math.min(lev, this.levels.length);
    const params = this.levels[this.level - 1];
    if (immediate || params.pre === undefined) this.inst.PlayAnimation(params.anim, true);
    else {
      this.inst.PlayAnimation(params.pre);
      this.inst.PushAnimation(params.anim, true);
    }
    this.current_radius = this.GetLevelRadius(this.level);
    this.lightState = { radius: this.current_radius, intensity: params.intensity, falloff: params.falloff, colour: params.colour };
    this.light.set(this.lightState);
    if (this.playingsound !== params.sound) {
      if (this.playingsound !== undefined) this.inst.KillSound('fire');
      this.playingsound = params.sound;
      this.playingsoundintensity = undefined;
      if (params.sound !== undefined && !this.inst.IsAsleep()) this.inst.PlaySound(params.sound, 'fire');
    }
    if (this.playingsoundintensity !== params.soundintensity && params.sound !== undefined) {
      this.playingsoundintensity = params.soundintensity;
      if (params.soundintensity !== undefined && this.inst.PlayingSound('fire')) {
        this.inst.SetSoundParameter('fire', 'intensity', params.soundintensity);
      }
    }
  }

  /** Kills the fx; true when a going-out animation plays and the entity should be removed after it. */
  Extinguish(): boolean {
    if (this.playingsound !== undefined) {
      this.inst.KillSound('fire');
      this.playingsound = undefined;
      this.playingsoundintensity = undefined;
    }
    this.inst.PlaySound(this.extinguishsound ?? 'dontstarve/common/fireOut');
    const pst = this.level === undefined ? undefined : this.levels[this.level - 1]?.pst;
    if (pst === undefined) return false;
    this.inst.PlayAnimation(pst);
    return true;
  }

  OnEntitySleep(): void { this.inst.KillSound('fire'); }

  OnEntityWake(): void {
    if (this.playingsound === undefined || this.inst.PlayingSound('fire')) return;
    this.inst.PlaySound(this.playingsound, 'fire');
    if (this.playingsoundintensity !== undefined) this.inst.SetSoundParameter('fire', 'intensity', this.playingsoundintensity);
  }

  private setLight(patch: Partial<NonNullable<FireFX['lightState']>>): void {
    if (!this.lightState) return;
    this.lightState = { ...this.lightState, ...patch };
    this.light.set(this.lightState);
  }
}
