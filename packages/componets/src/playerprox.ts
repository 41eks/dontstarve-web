import { createSignal, readonlySignal, createEffect, createMemo, watchSignal, WorldContentKey, type GetWatchWorldContent, type Memo, type PlayerPositionsSignal } from '../../signals/src';
import type { GameTimeScheduler } from './gameTimeScheduler';
import { ComponentTimer } from './timer';
import { GetTileCoordsAtPoint, TileTracker } from './tileManager';
import { TILE_SIZE } from '../../prefab/src/tile';
import type { Vector3 } from 'three';

export interface PlayerProxInst { isValid(): boolean; getPosition(): Vector3 }

// Unordered tile pairs share their grid distance across entities and position
// snapshots. Signed X/Z indices also distinguish tiles outside the bounded grid.
const tileDistances = new Map<string, number>();

function getTileDistance(a: readonly [number, number], b: readonly [number, number]): number {
  const aKey = `${a[0]},${a[1]}`, bKey = `${b[0]},${b[1]}`;
  const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
  let distance = tileDistances.get(key);
  if (distance === undefined) {
    // Chebyshev distance matches the conservative square used by the tile cutoff.
    distance = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
    tileDistances.set(key, distance);
  }
  return distance;
}

/** playerprox.lua's default AnyPlayer mode. No save data; world sleep stops its periodic task. */
export class PlayerProx {
  private readonly close = createSignal(false);
  readonly isclose = readonlySignal(this.close);
  private readonly timer: ComponentTimer;
  private enabled = false;
  private disposed = false;
  private near = 2;
  private far = 3;
  private period = 10 / 30;
  private readonly inst: PlayerProxInst;
  private readonly playerpositions?: PlayerPositionsSignal;
  private readonly playerTiles?: Memo<readonly [number, number][]>;
  private stopPlayers?: () => void;
  private stopArea?: () => void;
  /** The periodic task was stopped because the inst left the tickingarea, not by its owner. */
  private pausedByArea = false;
  private onnear?: () => void;
  private onfar?: () => void;

  constructor(inst: PlayerProxInst, scheduler: GameTimeScheduler, getWatchWorldContent?: GetWatchWorldContent) {
    this.inst = inst;
    // A private tile key gates the player positions by tickingarea; the inst's position is read once, so it must not move.
    const tracker = new TileTracker(() => inst.getPosition());
    this.playerpositions = getWatchWorldContent?.(WorldContentKey.PlayerPositions, stop => { this.stopPlayers = stop; }, { tile: tracker.tile });
    if (this.playerpositions) this.playerTiles = createMemo(() => this.playerpositions!.get().map(GetTileCoordsAtPoint));
    this.timer = new ComponentTimer(scheduler, () => {
      this.ForceUpdate();
      if (this.enabled && !this.disposed) this.timer.start(this.period);
    });
    if (this.playerpositions) createEffect(() => {
      this.playerpositions!.get();
      this.ForceUpdate();
    });
    this.Schedule();
    const area = this.playerpositions?.area;
    if (area) {
      // Outside the tickingarea the positions hold their last value, so the periodic poll sleeps until the area is active again.
      const active = watchSignal(area, stop => { this.stopArea = stop; });
      let previous = active.peek();
      createEffect(() => {
        const now = active.get();
        if (now === previous) return;
        previous = now;
        if (!now) { if (this.enabled) { this.ForceUpdate(); this.Stop(); this.pausedByArea = true; } }
        else if (this.pausedByArea) { this.pausedByArea = false; this.Schedule(); this.ForceUpdate(); }
      });
    }
  }
  get timerState() { return this.timer.snapshot; }
  SetDist(near: number, far: number): void { this.near = near; this.far = far; }
  SetOnPlayerNear(fn: () => void): void { this.onnear = fn; }
  SetOnPlayerFar(fn: () => void): void { this.onfar = fn; }
  IsPlayerClose(): boolean { return this.close.peek(); }
  Schedule(period = this.period): void {
    if (this.disposed) return;
    this.Stop(); this.period = period; this.enabled = true; this.timer.start(period);
  }
  ForceUpdate(): void {
    if (!this.enabled || this.disposed || !this.inst.isValid()) return;
    const origin = this.inst.getPosition(), wasClose = this.close.peek();
    const distance = wasClose ? this.far : this.near;
    const tile = GetTileCoordsAtPoint(origin);
    const tileRange = Math.ceil(Math.abs(distance) / TILE_SIZE);
    const playerTiles = this.playerTiles?.peek();
    const isClose = this.playerpositions?.peek().some((point, index) => {
      if (getTileDistance(tile, playerTiles![index]) > tileRange) return false;
      // Entities in one tile can straddle the radius boundary; only the tile
      // distance is shared, while exact distance and hysteresis remain private.
      return point.distanceToSquared(origin) < distance ** 2;
    }) ?? false;
    if (wasClose === isClose) return;
    this.close.set(isClose);
    if (isClose) this.onnear?.(); else this.onfar?.();
  }
  Stop(): void { this.enabled = false; this.pausedByArea = false; this.timer.stop(); }
  OnEntityWake(): void { this.Schedule(); this.ForceUpdate(); }
  OnEntitySleep(): void { this.ForceUpdate(); this.Stop(); }
  dispose(): void {
    this.disposed = true; this.Stop(); this.stopArea?.(); this.stopArea = undefined; this.stopPlayers?.(); this.stopPlayers = undefined;
  }
}
