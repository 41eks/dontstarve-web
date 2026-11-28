import { createSignal, readonlySignal } from '../../signals/src/signal.ts';
import type { GameTimeScheduler } from './gameTimeScheduler';
import { TILE_SIZE, WORLD_SCALE } from '../../prefab/src/tile';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';

/** A ground point (y = 0), as the creep reads its sources and the players. */
type Position = ReadonlyVector3;

/**
 * The world's tile map as the creep reads it. Cells are the map's signed tile cells, `floor(world / TILE_SIZE)`, as
 * the engine's GroundCreep grid matches its map tiles one to one.
 */
export interface GroundCreepTerrain {
  /** Inclusive-exclusive signed cell range [min, max) on both axes. */
  cellRange(): { min: number; max: number };
  /** TileGroupManager IsLandTile and not IsInvisibleTile: the tiles creep may cover. */
  canHoldCreep(col: number, row: number): boolean;
}

/** What GroundCreep reads from AllPlayers: where they stand, to wake the creep chunks around them. */
export interface GroundCreepPlayer {
  readonly position: Position;
}

/** Inclusive-exclusive signed cells an update changed. */
export interface GroundCreepChange {
  readonly minCol: number;
  readonly minRow: number;
  readonly maxCol: number;
  readonly maxRow: number;
}

/** The entity a GroundCreepEntity is attached to; walkers push creepactivate to it. */
export interface GroundCreepEntityInst {
  readonly position: Position;
  PushEvent(name: string, data?: unknown): void;
}

// Engine constants of GroundCreep.cpp, in DST units where they are distances.
/** The default SetUpdateInterval, in seconds. */
const DEFAULT_UPDATE_INTERVAL = 1;
/** Chunks of 16 × 16 cells are simulated once a player has come within 80 units of their centre. */
const CHUNK_CELLS = 16;
const CHUNK_WAKE_DISTANCE_SQ = (80 * WORLD_SCALE) ** 2;
/** GetTriggeredCreepSpawners widens each radius by half a tile. */
const TRIGGER_MARGIN = 2 * WORLD_SCALE;
/** A receding cell clears once more than this many of its 8 neighbours are bare. */
const RECEDE_BARE_NEIGHBOURS = 2;

/**
 * The engine's GroundCreepEntity: a creep source of `radius` around its inst. SetRadius marks it so the next update
 * seeds its own cell.
 */
export class GroundCreepEntity {
  readonly inst: GroundCreepEntityInst;
  private readonly creep: GroundCreep;
  /** Scene units (DST units × WORLD_SCALE). */
  radius = 0;
  /** SetRadius's dirty bit 0: the next update seeds the inst's cell, then clears it. */
  seed = false;

  constructor(inst: GroundCreepEntityInst, creep: GroundCreep) {
    this.inst = inst;
    this.creep = creep;
    creep.AddEntity(this);
  }

  /** GroundCreepEntity:SetRadius, in scene units. */
  SetRadius(radius: number): void {
    this.radius = radius;
    this.seed = true;
  }

  /** The source leaves with its inst; the cells it no longer covers recede on later updates. */
  OnRemoveFromEntity(): void {
    this.creep.RemoveEntity(this);
  }
}

/**
 * TheWorld.GroundCreep: the engine's creep grid over the map's tiles. Each update every source covers the cells whose
 * centre lies within its radius; covered cells grow from creep beside them, uncovered creep recedes from its bare
 * edges, and tiles that cannot hold creep are cleared. The grid is not saved: the sources rebuild it after a load, and
 * FastForward makes the next update fill and clear at once.
 */
export class GroundCreep {
  private readonly terrain: GroundCreepTerrain;
  private readonly scheduler: GameTimeScheduler;
  private readonly getPlayers: () => readonly GroundCreepPlayer[];
  private readonly entities = new Set<GroundCreepEntity>();
  private readonly min: number;
  private readonly width: number;
  private readonly chunksWide: number;
  private current: Uint8Array;
  private next: Uint8Array;
  private readonly target: Uint8Array;
  private readonly activeChunks: Uint8Array;
  private updateInterval = DEFAULT_UPDATE_INTERVAL;
  private instant = false;
  private cancelTask?: () => void;
  private disposed = false;
  private readonly changesState = createSignal<GroundCreepChange | undefined>(undefined);
  /** The cells the last update changed, a new value per changing update; the display redraws from it. */
  readonly changes = readonlySignal(this.changesState);

  constructor(
    terrain: GroundCreepTerrain,
    scheduler: GameTimeScheduler,
    getPlayers: () => readonly GroundCreepPlayer[],
  ) {
    this.terrain = terrain;
    this.scheduler = scheduler;
    this.getPlayers = getPlayers;
    const { min, max } = terrain.cellRange();
    this.min = min;
    this.width = Math.max(0, max - min);
    this.chunksWide = Math.ceil(this.width / CHUNK_CELLS);
    const cells = this.width * this.width;
    this.current = new Uint8Array(cells);
    this.next = new Uint8Array(cells);
    this.target = new Uint8Array(cells);
    this.activeChunks = new Uint8Array(this.chunksWide * this.chunksWide);
    this.schedule(this.updateInterval);
  }

  /** GroundCreep:OnCreep(x, y, z): whether the tile under the point holds creep. */
  OnCreep(position: Position): boolean {
    const index = this.indexAtPoint(position);
    return index !== undefined && this.current[index] > 0;
  }

  /** Whether a signed map cell holds creep, as the display draws it. */
  IsCreepAtCell(col: number, row: number): boolean {
    const index = this.indexAtCell(col, row);
    return index !== undefined && this.current[index] > 0;
  }

  /** GroundCreep:GetTriggeredCreepSpawners(x, y, z): the sources within their radius plus half a tile. */
  GetTriggeredCreepSpawners(position: Position): GroundCreepEntityInst[] {
    const spawners: GroundCreepEntityInst[] = [];
    for (const entity of this.entities) {
      const reach = entity.radius + TRIGGER_MARGIN;
      if (entity.inst.position.distanceToSquared(position) <= reach * reach) {
        spawners.push(entity.inst);
      }
    }
    return spawners;
  }

  /** GroundCreep:SetUpdateInterval; it applies from the next scheduled update. */
  SetUpdateInterval(seconds: number): void {
    this.updateInterval = seconds;
  }

  /** GroundCreep:FastForward: the next update, on the next tick, fills and clears without growing. */
  FastForward(): void {
    this.instant = true;
    this.schedule(0);
  }

  AddEntity(entity: GroundCreepEntity): void {
    this.entities.add(entity);
  }

  RemoveEntity(entity: GroundCreepEntity): void {
    this.entities.delete(entity);
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTask?.();
    this.cancelTask = undefined;
    this.entities.clear();
  }

  private schedule(seconds: number): void {
    if (this.disposed) {
      return;
    }
    this.cancelTask?.();
    this.cancelTask = this.scheduler.schedule(seconds, () => {
      this.cancelTask = undefined;
      const instant = this.instant;
      this.instant = false;
      this.update(instant);
      this.schedule(this.updateInterval);
    });
  }

  private indexAtCell(col: number, row: number): number | undefined {
    const x = col - this.min,
      z = row - this.min;
    return x >= 0 && x < this.width && z >= 0 && z < this.width ? x + z * this.width : undefined;
  }

  private indexAtPoint(position: Position): number | undefined {
    return this.indexAtCell(Math.floor(position.x / TILE_SIZE), Math.floor(position.z / TILE_SIZE));
  }

  /** Marks the chunks whose centre cell lies within the wake distance of a player; they stay active. */
  private wakeChunks(): void {
    const reachCells = Math.ceil(Math.sqrt(CHUNK_WAKE_DISTANCE_SQ) / TILE_SIZE);
    for (const { position } of this.getPlayers()) {
      const px = Math.floor(position.x / TILE_SIZE) - this.min,
        pz = Math.floor(position.z / TILE_SIZE) - this.min;
      const fromX = Math.max(0, Math.floor((px - reachCells) / CHUNK_CELLS)),
        toX = Math.min(this.chunksWide - 1, Math.floor((px + reachCells) / CHUNK_CELLS) + 1),
        fromZ = Math.max(0, Math.floor((pz - reachCells) / CHUNK_CELLS)),
        toZ = Math.min(this.chunksWide - 1, Math.floor((pz + reachCells) / CHUNK_CELLS) + 1);
      for (let cz = fromZ; cz <= toZ; cz++) {
        for (let cx = fromX; cx <= toX; cx++) {
          // The chunk's centre is the centre of its cell (16i + 8).
          const dx = (this.min + cx * CHUNK_CELLS + CHUNK_CELLS / 2 + 0.5) * TILE_SIZE - position.x,
            dz = (this.min + cz * CHUNK_CELLS + CHUNK_CELLS / 2 + 0.5) * TILE_SIZE - position.z;
          if (dx * dx + dz * dz < CHUNK_WAKE_DISTANCE_SQ) {
            this.activeChunks[cx + cz * this.chunksWide] = 1;
          }
        }
      }
    }
  }

  /** Each source covers the cells whose centre is within its radius. */
  private coverTargets(): void {
    this.target.fill(0);
    for (const { inst, radius } of this.entities) {
      if (radius <= 0) {
        continue;
      }
      const col = Math.floor(inst.position.x / TILE_SIZE),
        row = Math.floor(inst.position.z / TILE_SIZE),
        reach = 1 + Math.trunc(radius / TILE_SIZE),
        radiusSq = radius * radius;
      for (let z = row - reach; z <= row + reach; z++) {
        for (let x = col - reach; x <= col + reach; x++) {
          const index = this.indexAtCell(x, z);
          if (index === undefined) {
            continue;
          }
          const dx = (x + 0.5) * TILE_SIZE - inst.position.x,
            dz = (z + 0.5) * TILE_SIZE - inst.position.z;
          if (dx * dx + dz * dz <= radiusSq) {
            this.target[index] = 1;
          }
        }
      }
    }
  }

  /** How many of the cell's in-bounds 8 neighbours equal `value` in the current grid. */
  private neighbours(x: number, z: number, value: 0 | 1): number {
    let count = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx,
          nz = z + dz;
        if ((dx !== 0 || dz !== 0) && nx >= 0 && nx < this.width && nz >= 0 && nz < this.width) {
          count += Number((this.current[nx + nz * this.width] > 0 ? 1 : 0) === value);
        }
      }
    }
    return count;
  }

  private update(instant: boolean): void {
    this.wakeChunks();
    const { current, next, width, min } = this;
    next.set(current);
    // SetRadius's seed: the source's own cell, when its tile can hold creep.
    for (const entity of this.entities) {
      if (!entity.seed) {
        continue;
      }
      const col = Math.floor(entity.inst.position.x / TILE_SIZE),
        row = Math.floor(entity.inst.position.z / TILE_SIZE),
        index = this.indexAtCell(col, row);
      if (index !== undefined && this.terrain.canHoldCreep(col, row)) {
        next[index] = 1;
      }
      entity.seed = false;
    }
    this.coverTargets();
    for (let cz = 0; cz < this.chunksWide; cz++) {
      for (let cx = 0; cx < this.chunksWide; cx++) {
        if (!this.activeChunks[cx + cz * this.chunksWide]) {
          continue;
        }
        const toZ = Math.min(width, (cz + 1) * CHUNK_CELLS),
          toX = Math.min(width, (cx + 1) * CHUNK_CELLS);
        for (let z = cz * CHUNK_CELLS; z < toZ; z++) {
          for (let x = cx * CHUNK_CELLS; x < toX; x++) {
            const index = x + z * width;
            if (!this.terrain.canHoldCreep(x + min, z + min)) {
              next[index] = 0;
            } else if (this.target[index]) {
              if (current[index] === 0 && (instant || this.neighbours(x, z, 1) > 0)) {
                next[index] = 1;
              }
            } else if (current[index] > 0 && (instant || this.neighbours(x, z, 0) > RECEDE_BARE_NEIGHBOURS)) {
              next[index] = 0;
            }
          }
        }
      }
    }
    let minX = width,
      minZ = width,
      maxX = -1,
      maxZ = -1;
    for (let index = 0; index < next.length; index++) {
      if (next[index] !== current[index]) {
        const x = index % width,
          z = (index - x) / width;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    }
    this.current = next;
    this.next = current;
    if (maxX >= 0) {
      this.changesState.set({ minCol: minX + min, minRow: minZ + min, maxCol: maxX + min + 1, maxRow: maxZ + min + 1 });
    }
  }
}
