import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemEntity } from '@dontstarve-web/inventory';
import { createSignal } from '../../signals/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { createPigKing, type PigKingPrefab } from '../../prefab/src/pigking';
import { configureTradableEntity } from '../../prefab/src/tradable';

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
  const king = await createPigKing('/dst/data/anim', { position: new THREE.Vector3(6, 0, 6) });
  const isNight = createSignal(false);
  const scheduler = new GameTimeScheduler();
  const dropLoot = vi.fn();
  king.bind({ camera: new THREE.PerspectiveCamera(), scheduler, isNight, dropLoot });
  const run = (seconds: number) => {
    for (let elapsed = 0; elapsed < seconds; elapsed += 1 / 30) { scheduler.advance(1 / 30); king.update(1 / 30); }
  };
  return { king, isNight, scheduler, dropLoot, run };
}

const give = (king: PigKingPrefab, entity: ItemEntity, giver?: unknown) => {
  const take = vi.fn(() => true);
  return { accepted: king.trader.AcceptGift(entity, take, giver), take };
};

describe('Pig King trading and sleeping', () => {
  it('pays its goldvalue in gold thrown toward the giver two thirds of a second after the toss', async () => {
    const { king, dropLoot, run } = await setup();
    const { accepted, take } = give(king, item('meat'), { position: new THREE.Vector3(26, 0, 6) });
    expect(accepted).toBe(true);
    expect(take).toHaveBeenCalledWith(true);
    expect(king.sg!.stateName).toBe('cointoss');
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
    expect(king.sg!.stateName).toBe('idle');
    king.dispose();
  });

  it('refuses items without gold value, and non-tradable items cannot be given at all', async () => {
    const { king, dropLoot, run } = await setup();
    const monster = give(king, item('monstermeat'));
    expect(monster.accepted).toBe(false);
    expect(monster.take).not.toHaveBeenCalled();
    expect(king.sg!.stateName).toBe('unimpressed');
    run(2);
    expect(king.sg!.stateName).toBe('idle');
    expect(king.trader.AbleToAccept(item('axe', false)).ok).toBe(false);
    run(1);
    expect(dropLoot).not.toHaveBeenCalled();
    king.dispose();
  });

  it('sleeps at night without trading, then wakes at day and trades again', async () => {
    const { king, isNight, run } = await setup();
    isNight.set(true);
    await Promise.resolve();
    expect(king.sg!.stateName).toBe('sleep');
    expect(king.standee.userData.tags).not.toContain('trader');
    expect(king.trader.AbleToAccept(item('goldnugget')).ok).toBe(false);
    expect(give(king, item('goldnugget')).accepted).toBe(false);
    run(3);
    expect(king.sg!.stateName).toBe('sleep');
    isNight.set(false);
    await Promise.resolve();
    expect(king.sg!.stateName).toBe('wake');
    expect(king.standee.userData.tags).toContain('trader');
    run(5);
    expect(king.sg!.stateName).toBe('idle');
    expect(give(king, item('goldnugget')).accepted).toBe(true);
    king.dispose();
    expect(king.standee.userData.tags).not.toContain('trader');
  });

  it('trades again after the scene is torn down and rebuilt around the same king', async () => {
    const { king, isNight } = await setup();
    king.dispose();
    expect(king.standee.userData.tags).not.toContain('trader');
    const dropLoot = vi.fn();
    king.bind({ camera: new THREE.PerspectiveCamera(), scheduler: new GameTimeScheduler(), isNight, dropLoot });
    expect(give(king, item('meat')).accepted).toBe(true);
    king.dispose();
  });

  it('finishes a toss before sleeping when night falls mid-trade', async () => {
    const { king, isNight, run } = await setup();
    give(king, item('goldnugget'));
    isNight.set(true);
    await Promise.resolve();
    expect(king.sg!.stateName).toBe('cointoss');
    run(5);
    expect(king.sg!.stateName).toBe('sleep');
    king.dispose();
  });
});
