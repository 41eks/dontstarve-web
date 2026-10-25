import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemEntity } from '@dontstarve-web/inventory';
import * as CANNON from 'cannon-es';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PigKingManager } from '../../prefab/src/pigking';
import { configureTradableEntity } from '../../prefab/src/tradable';
import { bindTestWorld } from './worldContentFixture';
import { prefabInstance } from '../../prefab/src/prefabInstance';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const bytes = await readFile(new URL(`../../../public${url}`, import.meta.url));
    return new Response(bytes);
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const item = (itemId: string, tradable = true) => {
  const entity = new ItemEntity({ itemId, count: 1 });
  if (tradable) configureTradableEntity(entity);
  return entity;
};

async function setup() {
  const scheduler = new GameTimeScheduler();
  const world = bindTestWorld(scheduler);
  const dropLoot = vi.fn();
  const kings = new PigKingManager(new THREE.Scene(), '/dst/data/anim', {
    camera: new THREE.PerspectiveCamera(), scheduler, physics: new CANNON.World(), dropLoot });
  const model = await kings.spawn(new THREE.Vector3(6, 0, 6));
  const king = kings.get(model)!;
  // WatchWorldState("isnight") reads the world's day phase.
  const setNight = (night: boolean) => world.cycle.set(night ? 'night' : 'day');
  const run = (seconds: number) => {
    for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 30) { scheduler.advance(1 / 30); kings.update(1 / 30); }
  };
  const dispose = () => { kings.dispose(); world.unbind(); scheduler.dispose(); };
  return { kings, king, model, setNight, scheduler, dropLoot, run, dispose };
}

const give = (king: { trader: { AcceptGift(item: ItemEntity, take: () => boolean, giver?: unknown): boolean } }, entity: ItemEntity, giver?: unknown) => {
  const take = vi.fn(() => true);
  return { accepted: king.trader.AcceptGift(entity, take, giver), take };
};

describe('Pig King trading and sleeping', () => {
  it('pays its goldvalue in gold thrown toward the giver two thirds of a second after the toss', async () => {
    const { king, dropLoot, run, dispose } = await setup();
    const { accepted, take } = give(king, item('meat'), { position: new THREE.Vector3(26, 0, 6) });
    expect(accepted).toBe(true);
    expect(take).toHaveBeenCalledWith(true);
    expect(king.sg.stateName).toBe('cointoss');
    run(0.5);
    expect(dropLoot).not.toHaveBeenCalled();
    run(0.25);
    expect(dropLoot).toHaveBeenCalledTimes(1);
    const [items, origin, launch] = dropLoot.mock.calls[0];
    expect(items).toEqual([{ itemId: 'goldnugget', count: 1 }]);
    expect(origin.toArray()).toEqual([6, 0, 6]);
    const toss = launch();
    expect(Math.abs(toss.angle)).toBeLessThanOrEqual(Math.PI / 6);
    expect(toss).toMatchObject({ height: 4.5, speed: { min: 2, range: 4 }, ySpeed: { min: 8, range: 2 } });
    run(6);
    expect(king.sg.stateName).toBe('idle');
    dispose();
  });

  it('refuses items without gold value, and non-tradable items cannot be given at all', async () => {
    const { king, dropLoot, run, dispose } = await setup();
    const monster = give(king, item('monstermeat'));
    expect(monster.accepted).toBe(false);
    expect(monster.take).not.toHaveBeenCalled();
    expect(king.sg.stateName).toBe('unimpressed');
    run(2);
    expect(king.sg.stateName).toBe('idle');
    expect(king.trader.AbleToAccept(item('axe', false)).ok).toBe(false);
    run(1);
    expect(dropLoot).not.toHaveBeenCalled();
    dispose();
  });

  it('sleeps at night without trading, then wakes at day and trades again', async () => {
    const { king, model, setNight, run, dispose } = await setup();
    setNight(true);
    await Promise.resolve();
    expect(king.sg.stateName).toBe('sleep');
    expect(prefabInstance(model)!.listTags()).not.toContain('trader');
    expect(king.trader.AbleToAccept(item('goldnugget')).ok).toBe(false);
    expect(give(king, item('goldnugget')).accepted).toBe(false);
    run(3);
    expect(king.sg.stateName).toBe('sleep');
    setNight(false);
    await Promise.resolve();
    expect(king.sg.stateName).toBe('wake');
    expect(prefabInstance(model)!.listTags()).toContain('trader');
    run(5);
    expect(king.sg.stateName).toBe('idle');
    expect(give(king, item('goldnugget')).accepted).toBe(true);
    dispose();
    expect(prefabInstance(model)!.listTags()).not.toContain('trader');
  });

  it('finishes a toss before sleeping when night falls mid-trade', async () => {
    const { king, setNight, run, dispose } = await setup();
    give(king, item('goldnugget'));
    setNight(true);
    await Promise.resolve();
    expect(king.sg.stateName).toBe('cointoss');
    run(5);
    expect(king.sg.stateName).toBe('sleep');
    dispose();
  });
});
