/** The map surface dockmanager.lua uses: tile ids by signed grid cell plus tilegroups.lua's classification. */
export interface DockMap {
  getTile(col: number, row: number): number;
  /** Map:SetTile, then undertile:SetTileUnderneath(col, row, underTile) when given. */
  setTile(col: number, row: number, tile: number, underTile?: number): void;
  /** Cells whose saved tile is `tile`, used to rebuild the dock graph after a load. */
  cellsOfTile(tile: number): Iterable<readonly [number, number]>;
  isLandTile(tile: number): boolean;
  isTemporaryTile(tile: number): boolean;
}

export interface DockTiles { readonly dock: number; readonly farmingSoil: number }

const key = (col: number, row: number) => `${col},${row}`;

/**
 * components/dockmanager.lua: dock tiles form a graph whose roots are docks touching permanent land. The root
 * grid holds data only for dock tiles; the BFS tests whether a dock still reaches a root. Health, damage and
 * destruction (DamageDockAtTile, QueueDestroyForDockAtPoint) are not ported: `onQueueDestroy` receives the tiles
 * Lua would queue for destruction.
 */
export class DockManager {
  private readonly map: DockMap;
  private readonly tiles: DockTiles;
  private readonly isRootGrid = new Map<string, boolean>();
  private readonly markedForDelete = new Set<string>();
  private readonly onQueueDestroy?: (col: number, row: number) => void;

  constructor(map: DockMap, tiles: DockTiles, onQueueDestroy?: (col: number, row: number) => void) {
    this.map = map; this.tiles = tiles; this.onQueueDestroy = onQueueDestroy;
    this.rebuild();
  }

  /** tile_is_a_root */
  private tileIsRoot(col: number, row: number): boolean {
    const tile = this.map.getTile(col, row);
    return this.map.isLandTile(tile) && tile !== this.tiles.dock
      && !(this.map.isTemporaryTile(tile) && tile !== this.tiles.farmingSoil);
  }

  /** generate_dock_data */
  private generateDockData(col: number, row: number): boolean {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if ((dx !== 0 || dz !== 0) && this.tileIsRoot(col + dx, row + dz)) return true;
    }
    return false;
  }

  /** OnLoad: the dock tiles are saved with the map, so the graph is derived from them. */
  private rebuild(): void {
    this.isRootGrid.clear(); this.markedForDelete.clear();
    for (const [col, row] of this.map.cellsOfTile(this.tiles.dock)) this.isRootGrid.set(key(col, row), this.generateDockData(col, row));
  }

  IsDock(col: number, row: number): boolean { return this.isRootGrid.has(key(col, row)); }
  IsRoot(col: number, row: number): boolean | undefined { return this.isRootGrid.get(key(col, row)); }

  /** CreateDockAtTile: the covered tile becomes the dock's undertile. */
  CreateDockAtTile(col: number, row: number): boolean {
    this.map.setTile(col, row, this.tiles.dock, this.map.getTile(col, row));
    this.isRootGrid.set(key(col, row), this.generateDockData(col, row));
    return true;
  }

  /** bfs_for_root: marks every visited dock true when a root is reachable. */
  private bfsForRoot(start: string, visited: Map<string, boolean>): boolean {
    let found = false;
    const queue = [start];
    let index = 0;
    while (index < queue.length) {
      const next = queue[index++];
      if (visited.has(next)) continue;
      visited.set(next, false);
      if (this.isRootGrid.get(next)) { found = true; break; }
      const [col, row] = next.split(',').map(Number);
      for (let dx = -1; dx <= 1 && !found; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const adjacent = key(col + dx, row + dz), seen = visited.get(adjacent);
        if (seen === undefined && this.isRootGrid.has(adjacent)) queue.push(adjacent);
        else if (seen === true) { found = true; break; }
      }
    }
    if (found) for (let i = 0; i < index; i++) visited.set(queue[i], true);
    return found;
  }

  /** _TestForBreaking: queues destruction for every tested dock with no path to a root. */
  private testForBreaking(testTiles: readonly string[]): boolean {
    const visited = new Map<string, boolean>();
    let anyDestroyed = false;
    for (const tile of testTiles) {
      const shouldDelete = visited.get(tile) !== true && !this.bfsForRoot(tile, visited);
      if (!shouldDelete || this.markedForDelete.has(tile)) continue;
      this.markedForDelete.add(tile);
      const [col, row] = tile.split(',').map(Number);
      this.onQueueDestroy?.(col, row);
      anyDestroyed = true;
    }
    return anyDestroyed;
  }

  /** ResolveDockSafetyAtPoint: true when the dock cannot hold its position (dock_kit's ANNOUNCE_BOAT_SINK). */
  ResolveDockSafetyAtTile(col: number, row: number): boolean { return this.testForBreaking([key(col, row)]); }
}
