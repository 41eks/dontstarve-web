import type { Vector3 } from 'three';
import { TILE_SIZE } from './tile';

export interface SpatialQuery<T> {
  someNear(position: Vector3, radius: number, predicate: (value: T) => boolean): boolean;
  someOnTile(position: Vector3, predicate: (value: T) => boolean): boolean;
}

interface Entry<T> { value: T; extent: number; left: number; right: number; top: number; bottom: number }

/** Owners register/remove once and sync only when a position or its query extent changes. */
export class SpatialIndex<T> implements SpatialQuery<T> {
  private readonly cells = new Map<string, Set<Entry<T>>>();
  private readonly entries = new Map<T, Entry<T>>();
  private readonly positionOf: (value: T) => Vector3;
  private readonly extentOf: (value: T) => number;
  constructor(positionOf: (value: T) => Vector3, extentOf: (value: T) => number = () => 0) {
    this.positionOf = positionOf; this.extentOf = extentOf;
  }

  add(value: T): void {
    if (this.entries.has(value)) { this.sync(value); return; }
    const entry = { value, extent: 0, left: NaN, right: NaN, top: NaN, bottom: NaN };
    this.entries.set(value, entry);
    this.sync(value);
  }

  sync(value: T): void {
    const entry = this.entries.get(value);
    if (!entry) return;
    const position = this.positionOf(value), extent = Math.max(0, this.extentOf(value));
    const valid = Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z) && Number.isFinite(extent);
    const left = valid ? Math.floor((position.x - extent) / TILE_SIZE) : NaN;
    const right = valid ? Math.floor((position.x + extent) / TILE_SIZE) : NaN;
    const top = valid ? Math.floor((position.z - extent) / TILE_SIZE) : NaN;
    const bottom = valid ? Math.floor((position.z + extent) / TILE_SIZE) : NaN;
    entry.extent = extent;
    if (entry.left === left && entry.right === right && entry.top === top && entry.bottom === bottom) return;
    this.visitCells(entry, key => {
      const cell = this.cells.get(key);
      cell?.delete(entry);
      if (cell?.size === 0) this.cells.delete(key);
    });
    Object.assign(entry, { left, right, top, bottom });
    this.visitCells(entry, key => {
      let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, cell = new Set());
      cell.add(entry);
    });
  }

  delete(value: T): void {
    const entry = this.entries.get(value);
    if (!entry) return;
    this.entries.delete(value);
    this.visitCells(entry, key => {
      const cell = this.cells.get(key);
      cell?.delete(entry);
      if (cell?.size === 0) this.cells.delete(key);
    });
  }

  clear(): void { this.cells.clear(); this.entries.clear(); }

  someNear(position: Vector3, radius: number, predicate: (value: T) => boolean): boolean {
    if (!Number.isFinite(radius) || radius < 0) throw new RangeError('Invalid spatial query radius');
    if (![position.x, position.y, position.z].every(Number.isFinite)) return false;
    return this.someInCells(Math.floor((position.x - radius) / TILE_SIZE), Math.floor((position.x + radius) / TILE_SIZE),
      Math.floor((position.z - radius) / TILE_SIZE), Math.floor((position.z + radius) / TILE_SIZE),
      entry => this.positionOf(entry.value).distanceToSquared(position) <= (radius + entry.extent) ** 2 && predicate(entry.value));
  }

  someOnTile(position: Vector3, predicate: (value: T) => boolean): boolean {
    if (![position.x, position.y, position.z].every(Number.isFinite)) return false;
    const x = Math.floor(position.x / TILE_SIZE), z = Math.floor(position.z / TILE_SIZE);
    return this.someInCells(x, x, z, z, entry => {
      const point = this.positionOf(entry.value);
      return Math.floor(point.x / TILE_SIZE) === x && Math.floor(point.z / TILE_SIZE) === z && predicate(entry.value);
    });
  }

  private someInCells(left: number, right: number, top: number, bottom: number,
    predicate: (entry: Entry<T>) => boolean): boolean {
    const seen = new Set<Entry<T>>();
    for (let x = left; x <= right; x++) for (let z = top; z <= bottom; z++) {
      const cell = this.cells.get(`${x},${z}`);
      if (!cell) continue;
      for (const entry of cell) {
        if (seen.has(entry)) continue;
        seen.add(entry);
        if (predicate(entry)) return true;
      }
    }
    return false;
  }

  private visitCells(entry: Entry<T>, visit: (key: string) => void): void {
    for (let x = entry.left; x <= entry.right; x++) for (let z = entry.top; z <= entry.bottom; z++) visit(`${x},${z}`);
  }
}
