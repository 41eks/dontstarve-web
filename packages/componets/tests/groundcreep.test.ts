import { Vector3 } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { GameTimeScheduler } from '../src/gameTimeScheduler';
import { GroundCreep, GroundCreepEntity } from '../src/groundcreep';
import { TILE_SIZE, WORLD_SCALE } from '../../prefab/src/tile';

const cellCentre = (col: number, row: number) => new Vector3((col + 0.5) * TILE_SIZE, 0, (row + 0.5) * TILE_SIZE);

function setup(blocked: ReadonlySet<string> = new Set()) {
  const scheduler = new GameTimeScheduler();
  const player = { position: cellCentre(0, 0) };
  const creep = new GroundCreep(
    { cellRange: () => ({ min: -64, max: 64 }), canHoldCreep: (col, row) => !blocked.has(`${col},${row}`) },
    scheduler,
    () => [player],
  );
  const source = (col: number, row: number, radius: number) => {
    const entity = new GroundCreepEntity({ position: cellCentre(col, row) }, creep);
    entity.SetRadius(radius * WORLD_SCALE);
    return entity;
  };
  const covered = () => {
    const cells: string[] = [];
    for (let row = -64; row < 64; row++) {
      for (let col = -64; col < 64; col++) {
        if (creep.IsCreepAtCell(col, row)) {
          cells.push(`${col},${row}`);
        }
      }
    }
    return cells;
  };
  return { scheduler, creep, source, covered, dispose: () => (creep.dispose(), scheduler.dispose()) };
}

let current: ReturnType<typeof setup> | undefined;
afterEach(() => current?.dispose());

describe('GroundCreep', () => {
  it('covers the tiles whose centre is within the radius, as OnCreep reads them, once FastForward fills it', () => {
    const s = (current = setup());
    s.source(0, 0, 9);
    s.creep.FastForward();
    s.scheduler.advance(0);
    // spiderden stage 2: 9 units is 2.25 tiles, so the tiles at (±2, ±1) are in and (±2, ±2) are out.
    expect(s.covered()).toHaveLength(21);
    expect(s.creep.IsCreepAtCell(2, 1)).toBe(true);
    expect(s.creep.IsCreepAtCell(2, 2)).toBe(false);
    // OnCreep is per tile: the far edge of a covered tile still counts.
    expect(s.creep.OnCreep(new Vector3(2.99 * TILE_SIZE, 0, 0.5 * TILE_SIZE))).toBe(true);
    expect(s.creep.OnCreep(new Vector3(3.01 * TILE_SIZE, 0, 0.5 * TILE_SIZE))).toBe(false);
    expect(s.creep.changes.value).toEqual({ minCol: -2, minRow: -2, maxCol: 3, maxRow: 3 });
  });

  it('grows from the seeded tile one ring per update, then recedes from its bare edges after SetRadius(0)', () => {
    const s = (current = setup());
    const den = s.source(0, 0, 9);
    s.scheduler.advance(1);
    expect(s.covered()).toEqual(['0,0']);
    s.scheduler.advance(1);
    expect(s.covered()).toHaveLength(9);
    s.scheduler.advance(1);
    expect(s.covered()).toHaveLength(21);

    den.SetRadius(0);
    s.scheduler.advance(1);
    const receding = s.covered();
    // The outer tiles, with more than 2 bare neighbours, go first; the inner ring and centre are still there.
    expect(receding.length).toBeGreaterThan(0);
    expect(receding.length).toBeLessThan(21);
    expect(receding).toContain('0,0');
    s.scheduler.advance(5);
    expect(s.covered()).toEqual([]);
  });

  it('keeps creep off tiles that cannot hold it and does not simulate chunks no player has come near', () => {
    const s = (current = setup(new Set(['1,0'])));
    s.source(0, 0, 9);
    // 200 units from the player: only SetRadius's own seed is placed.
    s.source(50, 50, 9);
    s.creep.FastForward();
    s.scheduler.advance(0);
    expect(s.creep.IsCreepAtCell(1, 0)).toBe(false);
    // The near den's 21 tiles less the blocked one, plus the far den's seed alone.
    expect(s.covered()).toHaveLength(21);
    expect(s.creep.IsCreepAtCell(50, 50)).toBe(true);
    expect(s.creep.IsCreepAtCell(51, 50)).toBe(false);
  });

  it('triggers the sources within their radius plus half a tile, and forgets a removed one', () => {
    const s = (current = setup());
    const den = s.source(0, 0, 5);
    const at = (units: number) => cellCentre(0, 0).add(new Vector3(units * WORLD_SCALE, 0, 0));
    expect(s.creep.GetTriggeredCreepSpawners(at(7))).toEqual([den.inst]);
    expect(s.creep.GetTriggeredCreepSpawners(at(7.01))).toEqual([]);
    den.OnRemoveFromEntity();
    expect(s.creep.GetTriggeredCreepSpawners(at(0))).toEqual([]);
  });
});
