import type { Vector3 } from 'three';
import type { WorkInst } from './workable';
import { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';
import type { Propagator } from './propagator';
import type { FireFX } from './firefx';
import { batch, createMemo, createSignal, readonlySignal } from '../../signals/src';

export interface BurnableInst extends WorkInst {
  components: { burnable?: Burnable; propagator?: Propagator; explosive?: { OnBurnt(): void } };
  getPosition(): Vector3;
}

/** One AddBurnFX entry; offsets are in animation pixels when following a symbol. */
export interface BurnFXData {
  readonly prefab: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly follow?: string;
  readonly followaschild?: boolean;
  readonly followlayered?: boolean;
  readonly scale: number;
}

/** An fx child SpawnFX made: SpawnPrefab(v.prefab), followed or parented as `data` says. */
export interface BurnFX {
  readonly components: { firefx?: FireFX };
  Remove(): void;
  /** fx:ListenForEvent("animover", fx.Remove) after a going-out animation. */
  RemoveOnAnimOver(): void;
}

/** The supported structure branches of components/burnable.lua, on active game time. */
export class Burnable {
  private readonly burningState = createSignal(false);
  readonly burning = readonlySignal(this.burningState);
  private lightable = true;
  private readonly removedState = createSignal(false);
  private get removed(): boolean { return this.removedState.peek(); }
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly burnTimer: ComponentTimer;
  private readonly smolderTask: ComponentTimer;
  private readonly smolderRemaining = createSignal<number | undefined>(undefined);
  private readonly phaseMemo;
  readonly timer;
  readonly phase;
  burntime?: number;
  private fxdata: BurnFXData[] = [];
  private readonly fxchildren: BurnFX[] = [];
  private fxoffset?: { x: number; y: number; z: number };
  private fxlevel = 1;
  /** SpawnPrefab for this inst's burn fx; the owning prefab supplies it with its AddBurnFX entries. */
  private spawnfx?: (data: BurnFXData) => BurnFX | undefined;
  onignite?: (inst: BurnableInst, source?: WorkInst, doer?: WorkInst) => void;
  onextinguish?: (inst: BurnableInst) => void;
  onburnt?: (inst: BurnableInst) => void;
  readonly inst: BurnableInst;
  constructor(inst: BurnableInst, scheduler?: GameTimeScheduler) {
    this.inst = inst;
    this.scheduler = scheduler ?? new GameTimeScheduler();
    this.ownsScheduler = !scheduler;
    this.burnTimer = new ComponentTimer(this.scheduler, () => {
      if (this.removed || this.inst.isRemoved) return;
      this.inst.PushEvent?.('onburnt', undefined);
      this.onburnt?.(this.inst);
      if (!this.removed && !this.inst.isRemoved) this.inst.components.explosive?.OnBurnt(); // burnable.lua DoneBurning
      this.Extinguish();
    });
    this.smolderTask = new ComponentTimer(this.scheduler, () => this.updateSmolder());
    this.phaseMemo = createMemo(() => {
      if (this.removedState.get()) return 'removed';
      const burning = this.burning.get();
      const smolder = this.smolderTask.snapshot.get();
      const burn = this.burnTimer.snapshot.get();
      return burning ? 'burning' : smolder.status === 'scheduled' ? 'smoldering'
        : burn.status === 'expired' ? 'burnt' : 'idle';
    });
    this.timer = this.burnTimer.snapshot;
    this.phase = readonlySignal(this.phaseMemo);
    this.refreshTags();
  }
  /** A world entity's Fueled; an inventory item's fueled settles its own consumption. */
  private get fueled(): { StartConsuming(): void; StopConsuming(): void } | undefined {
    const fueled = (this.inst.components as { fueled?: object }).fueled;
    return fueled && 'StartConsuming' in fueled ? fueled as { StartConsuming(): void; StopConsuming(): void } : undefined;
  }
  get canlight(): boolean { return this.lightable; }
  set canlight(value: boolean) { this.lightable = value; this.refreshTags(); }
  SetBurnTime(time: number): void { this.burntime = time; }
  SetOnIgniteFn(fn: Burnable['onignite']): void { this.onignite = fn; }
  SetOnExtinguishFn(fn: Burnable['onextinguish']): void { this.onextinguish = fn; }
  SetOnBurntFn(fn: Burnable['onburnt']): void { this.onburnt = fn; }
  IsBurning(): boolean { return this.burning.peek(); }
  AddBurnFX(prefab: string, offset: { x: number; y: number; z: number }, followsymbol?: string, followaschild?: boolean,
    scale?: number, followlayered?: boolean): void {
    this.fxdata.push({ prefab, x: offset.x, y: offset.y, z: offset.z, follow: followsymbol,
      followaschild: followaschild || undefined, followlayered: followlayered || undefined, scale: scale ?? 1 });
  }
  SetFXSpawner(spawn: Burnable['spawnfx']): void { this.spawnfx = spawn; }
  /** An optional offset added on top of every AddBurnFX offset. */
  SetFXOffset(offset: { x: number; y: number; z: number } | undefined): void { this.fxoffset = offset; }
  /** The level of any current or future burning effects. */
  SetFXLevel(level: number, percent = 1): void {
    this.fxlevel = level;
    for (const fx of this.fxchildren) {
      fx.components.firefx?.SetLevel(level);
      fx.components.firefx?.SetPercentInLevel(percent);
    }
  }
  IsSmoldering(): boolean { return this.smolderTask.snapshot.peek().status === 'scheduled'; }
  Ignite(immediate = false, source?: WorkInst, doer?: WorkInst): void {
    if (this.removed || this.inst.isRemoved || this.IsBurning() || this.inst.hasTag('fireimmune')) return;
    this.StopSmoldering();
    if (this.burntime !== undefined) this.burnTimer.start(this.burntime);
    this.setBurning(true);
    this.SpawnFX(immediate);
    this.inst.PushEvent?.('onignite', { source, doer });
    this.onignite?.(this.inst, source, doer);
    this.fueled?.StartConsuming();
    this.inst.components.propagator?.spreading.set(true);
  }
  StartWildfire(): void {
    if (this.removed || this.IsBurning() || this.IsSmoldering() || this.inst.hasTag('fireimmune')) return;
    this.smolderRemaining.set(this.inst.components.propagator?.flashpoint ?? 10);
    this.smolderTask.start(Math.random() * 2);
    this.inst.addTag('smolder');
  }
  StopSmoldering(): void {
    this.smolderTask.stop();
    this.smolderRemaining.set(undefined);
    this.inst.removeTag('smolder');
  }
  Extinguish(): void {
    this.StopSmoldering();
    if (!this.IsBurning()) return;
    if (this.burnTimer.snapshot.peek().status === 'scheduled') this.burnTimer.stop();
    this.inst.components.propagator?.spreading.set(false);
    this.setBurning(false);
    this.KillFX();
    this.fueled?.StopConsuming();
    this.onextinguish?.(this.inst);
    this.inst.PushEvent?.('onextinguish', undefined);
  }
  SpawnFX(immediate = false): void {
    this.KillFX();
    const offset = this.fxoffset ?? { x: 0, y: 0, z: 0 };
    for (const v of this.fxdata) {
      const fx = this.spawnfx?.({ ...v, x: v.x + offset.x, y: v.y + offset.y, z: v.z + offset.z });
      if (!fx) continue;
      this.fxchildren.push(fx);
      const firefx = fx.components.firefx;
      if (firefx) {
        firefx.SetLevel(this.fxlevel, immediate);
        firefx.AttachLightTo(this.inst);
      }
    }
  }
  KillFX(): void {
    for (const fx of this.fxchildren.splice(0).reverse()) {
      if (fx.components.firefx?.Extinguish()) fx.RemoveOnAnimOver();
      else fx.Remove();
    }
  }
  /** StartUpdatingComponent of each fx child's firefx. */
  UpdateFX(dt: number): void { for (const fx of this.fxchildren) fx.components.firefx?.OnUpdate(dt); }
  Update(dt: number): void {
    if (this.removed || !Number.isFinite(dt) || dt <= 0) return;
    if (this.ownsScheduler) this.scheduler.advance(dt);
  }
  private updateSmolder(): void {
    if (this.removed || this.inst.isRemoved) return;
    const remaining = this.smolderRemaining.peek();
    if (remaining === undefined) return;
    const heat = this.inst.components.propagator?.NearbyHeat(12) ?? 0;
    const next = remaining - 2 * Math.max(1, Math.min(2.2, 1 + (heat - 20) / 70 * 1.2));
    this.smolderRemaining.set(next);
    if (next <= 0) this.Ignite();
    else this.smolderTask.start(2);
  }
  dispose(): void {
    if (this.removed) return;
    this.Extinguish();
    this.spawnfx = undefined;
    this.removedState.set(true);
    this.burnTimer.stop(); this.smolderTask.stop(); this.phaseMemo.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();
    for (const tag of ['canlight', 'nolight', 'fire', 'smolder']) this.inst.removeTag(tag);
  }
  private refreshTags(): void {
    const lightable = this.lightable && !this.IsBurning() && !this.removed;
    for (const [tag, enabled] of [['canlight', lightable], ['nolight', !lightable], ['fire', this.IsBurning()]] as const) {
      if (enabled) this.inst.addTag(tag); else this.inst.removeTag(tag);
    }
  }
  private setBurning(value: boolean): void {
    batch(() => { this.burningState.set(value); this.refreshTags(); });
  }
}
