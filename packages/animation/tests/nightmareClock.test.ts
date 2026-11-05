import { describe, expect, it } from 'vitest';
import { GameTimeScheduler } from '../../signals/src';
import { NightmareClock } from '../../componets/src/nightmareclock';
import { createWorldState } from '../../../src/worldState';
import { TUNING } from '../../../src/tuning';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { createInventoryStore } from '../../../src/inventory';
import initialWorld from '../../../public/saves/initial-world.json';
import { testMap } from './tileMapFixture';

function makeClock(random: () => number = () => .5) {
  const scheduler = new GameTimeScheduler();
  const clock = new NightmareClock(scheduler, {
    segs: TUNING.NIGHTMARE_SEGS, segTime: TUNING.SEG_TIME, segVariation: TUNING.NIGHTMARE_SEG_VARIATION, random,
  });
  return { scheduler, clock };
}

/** Cluster_62's Caves snapshot, as nightmareclock.lua OnSave wrote it. */
const SOURCE_SAVE = {
  lengths: { dawn: 2, calm: 12, wild: 5, warn: 3 }, phase: 'calm',
  remainingtimeinphase: 46.403869628906, totaltimeinphase: 408.32238769531,
} as const;

describe('nightmareclock.lua', () => {
  it('runs the phases on game time and carries a long frame into the next phase', () => {
    const { scheduler, clock } = makeClock();
    const seen: string[] = [];
    clock.phase.subscribe(phase => { seen.push(phase); });
    // Initialization has no variation; later phases get segs + .5 * 3 segs.
    expect(clock.remainingTimeInPhase).toBe(360);
    scheduler.advance(359);
    expect(clock.phase.peek()).toBe('calm');
    expect(clock.GetTimeInPhase()).toBeCloseTo(359 / 360);
    scheduler.advance(1);
    expect(seen).toEqual(['warn']);
    expect(clock.remainingTimeInPhase).toBe(135);
    // warn 135 + 10 of wild 195.
    scheduler.advance(145);
    expect(seen).toEqual(['warn', 'wild']);
    expect(clock.remainingTimeInPhase).toBe(185);
    scheduler.advance(185 + 105);
    expect(clock.phase.peek()).toBe('calm');
    expect(seen).toEqual(['warn', 'wild', 'dawn', 'calm']);
    expect(clock.remainingTimeInPhase).toBe(405);
  });

  it('holds a locked phase against time and control events, and moves on when unlocked', () => {
    const { scheduler, clock } = makeClock();
    clock.LockPhase('wild');
    expect(clock.timer.peek().status).toBe('stopped');
    scheduler.advance(10000);
    clock.SetPhase('calm');
    clock.NextPhase();
    clock.NextCycle();
    expect(clock.phase.peek()).toBe('wild');
    expect(clock.OnSave()).toMatchObject({ phase: 'wild', lockedphase: 'wild', remainingtimeinphase: 0 });

    const restored = makeClock();
    restored.clock.OnLoad(clock.OnSave());
    restored.scheduler.advance(10000);
    expect(restored.clock.phase.peek()).toBe('wild');

    clock.LockPhase();
    expect(clock.phase.peek()).toBe('dawn');
    expect(clock.OnSave().lockedphase).toBeUndefined();
    expect(clock.remainingTimeInPhase).toBe(105);
  });

  it('applies the control events', () => {
    const { clock } = makeClock();
    clock.SetPhase('wild');
    expect(clock.remainingTimeInPhase).toBe(195);
    clock.NextPhase();
    expect(clock.phase.peek()).toBe('dawn');
    clock.SetPhase('warn');
    clock.NextCycle();
    expect(clock.phase.peek()).toBe('calm');
    // ms_setnightmaresegs keeps the fraction of the phase left: all of it here, of (2 + 1.5) segs.
    clock.SetSegs({ calm: 2 });
    expect(clock.remainingTimeInPhase).toBe(105);
    expect(clock.OnSave().lengths).toEqual({ calm: 2, warn: 0, wild: 0, dawn: 0 });
    clock.SetSegs();
    expect(clock.OnSave().lengths).toEqual(TUNING.NIGHTMARE_SEGS);
  });

  it('skips a phase that rolls no time, publishing only the one it stops on', () => {
    const { clock } = makeClock(() => 0);
    const seen: string[] = [];
    clock.phase.subscribe(phase => { seen.push(phase); });
    clock.SetSegs({ wild: 2 });
    expect(seen).toEqual(['wild']);
    expect(clock.remainingTimeInPhase).toBe(60);
  });
});

describe('world nightmare clock', () => {
  const base = { map: testMap(48), elapsedSeconds: 0 };

  it('exists only in a cave, whose world content follows it from the saved state', () => {
    const forest = createWorldState({ ...base, prefab: 'forest', systems: {} });
    expect(forest.nightmareclock).toBeUndefined();
    expect(forest.nightmarephase.peek()).toBe('none');
    forest.dispose();

    const cave = createWorldState({ ...base, prefab: 'cave', systems: { nightmareclock: SOURCE_SAVE } });
    const stops: (() => void)[] = [];
    const phase = cave.getWatchWorldContent('nightmarephase', stop => { stops.push(stop); });
    expect(phase.peek()).toBe('calm');
    cave.scheduler.advance(46);
    expect(phase.peek()).toBe('calm');
    cave.scheduler.advance(1);
    expect(phase.peek()).toBe('warn');
    stops.forEach(stop => stop());
    cave.dispose();
  });

  it('survives a save document round trip and rejects what OnSave cannot write', () => {
    const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
    const cave = createWorldState({ ...base, prefab: 'cave', systems: { nightmareclock: SOURCE_SAVE } });
    cave.nightmareclock!.LockPhase('wild');
    const saved = cave.nightmareclock!.OnSave();
    const inventory = createInventoryStore([]);
    const json = serializeSave(template, {
      entities: {}, inventory: inventory.exportState(), elapsedSeconds: 0, playerTransform: { position: [0, 0, 0], rotationY: 0 }, nightmareclock: saved,
    }, SAVE_CATALOG);
    inventory.dispose();
    expect(deserializeSave(json, SAVE_CATALOG).world.systems.nightmareclock).toEqual(saved);
    cave.dispose();

    const invalid = JSON.parse(json);
    invalid.world.systems.nightmareclock.lockedphase = 'none';
    expect(() => deserializeSave(JSON.stringify(invalid), SAVE_CATALOG)).toThrow('lockedphase');
  });
});
