import type { ReadonlyVector3 } from './transform';

/** Cell edge in world units: a radius-9 query reads about 4 cells, a radius-41 one about 36. */
const CELL_SIZE = 16;
const OFFSET = 1 << 20;

const cellOf = (coordinate: number) => Math.floor(coordinate / CELL_SIZE);
const keyOf = (cx: number, cz: number) => (cx + OFFSET) * 2 * OFFSET + (cz + OFFSET);

interface GridEntity {
  readonly position: ReadonlyVector3;
}

/**
 * The spatial hash behind TheSim:FindEntities: entities bucketed by the XZ cell of their position.
 * The owner calls `move` after each position write; an entity is re-bucketed only when it crosses a cell edge.
 */
export class EntityGrid<Entity extends GridEntity> {
  private readonly cells = new Map<number, Set<Entity>>();
  private readonly keys = new Map<Entity, number>();

  insert(entity: Entity): void {
    if (this.keys.has(entity)) return;
    const key = keyOf(cellOf(entity.position.x), cellOf(entity.position.z));
    this.keys.set(entity, key);
    this.bucket(key).add(entity);
  }

  move(entity: Entity): void {
    const previous = this.keys.get(entity);
    if (previous === undefined) return;
    const key = keyOf(cellOf(entity.position.x), cellOf(entity.position.z));
    if (key === previous) return;
    this.leave(entity, previous);
    this.keys.set(entity, key);
    this.bucket(key).add(entity);
  }

  remove(entity: Entity): void {
    const key = this.keys.get(entity);
    if (key === undefined) return;
    this.keys.delete(entity);
    this.leave(entity, key);
  }

  /** Visit every entity in a cell the XZ square around `position` touches; the caller tests the exact distance. */
  visit(position: ReadonlyVector3, radius: number, visitor: (entity: Entity) => void): void {
    const minX = cellOf(position.x - radius), maxX = cellOf(position.x + radius);
    const minZ = cellOf(position.z - radius), maxZ = cellOf(position.z + radius);
    if ((maxX - minX + 1) * (maxZ - minZ + 1) > this.cells.size) {
      // A query wider than the occupied cells reads the occupied cells instead.
      for (const cell of this.cells.values()) for (const entity of cell) visitor(entity);
      return;
    }
    for (let cx = minX; cx <= maxX; cx++) for (let cz = minZ; cz <= maxZ; cz++) {
      const cell = this.cells.get(keyOf(cx, cz));
      if (cell) for (const entity of cell) visitor(entity);
    }
  }

  clear(): void { this.cells.clear(); this.keys.clear(); }

  private bucket(key: number): Set<Entity> {
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, cell = new Set());
    return cell;
  }

  private leave(entity: Entity, key: number): void {
    const cell = this.cells.get(key);
    if (!cell) return;
    cell.delete(entity);
    if (cell.size === 0) this.cells.delete(key);
  }
}
