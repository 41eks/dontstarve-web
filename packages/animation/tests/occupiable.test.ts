import { createEmptyEntity } from '../../prefab/src/prefabInstance';
import { describe, expect, it, vi } from 'vitest';
import { ItemEntity, type ItemOwner } from '../../inventory/src';
import { Occupiable } from '../../componets/src/occupiable';
import { Shelf } from '../../componets/src/shelf';
import { PERISH_CAGE_MULT, PERISH_FAST } from '../../componets/src/perishable';
import { BIRD_PERISH_TIME, configureBirdEntity, generateBirdLoot } from '../../prefab/src/birds';
import { Birdcage, birdcageAcceptsItem, digestedFoodProduct } from '../../prefab/src/birdcage';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { WorldContext } from '../../prefab/src/worldContext';
import type { SpriteAnimationController } from '../src/sprite';
import { createSignal, type WorldPhase } from '../../signals/src';
import { createPerishWorld } from './perishWorldFixture';

function createBird(prefab = 'canary') {
  const perishWorld = createPerishWorld();
  const bird = Object.assign(new ItemEntity({ itemId: prefab, count: 1 }, perishWorld), { perishWorld });
  bird.configure({ perishTime: BIRD_PERISH_TIME, configureEntity: configureBirdEntity });
  return bird;
}
const tags = () => {
  const set = new Set<string>();
  return { set, addTag: (tag: string) => set.add(tag), removeTag: (tag: string) => set.delete(tag) };
};
const settle = (bird: ReturnType<typeof createBird>, seconds: number) => {
  bird.perishWorld.advance(seconds);
  bird.components.perishable.flush();
};

describe('caged birds', () => {
  it('subscribes to sleeper state for status and animation, stops idle tasks and detaches removed sleepers', async () => {
    const scheduler = new GameTimeScheduler();
    const cycle = createSignal<WorldPhase>('day');
    let finish = () => {};
    const controller = {
      start: vi.fn(),
      playOnce: vi.fn((_name: string, onComplete: () => void) => { finish = onComplete; }),
      clearOverrideBuild: vi.fn(),
    };
    const { instance, display } = createEmptyEntity('birdcage');
    const model = display.model;
    instance.entityId = 'birdcage:test';
    vi.spyOn(instance.sprite, 'start').mockImplementation(controller.start);
    vi.spyOn(instance.sprite, 'playOnce').mockImplementation(controller.playOnce);
    vi.spyOn(instance.sprite, 'clearOverrideBuild').mockImplementation(controller.clearOverrideBuild);
    const cage = new Birdcage({ model, instance, animation: controller as unknown as SpriteAnimationController,
      world: { scheduler, cycle } as unknown as WorldContext }, () => .9);
    const bird = createBird();
    cage.occupiable!.Occupy(bird);
    expect(cage.status.peek()).toBe('OCCUPIED');
    const sleeper = cage.sleeper!;
    cycle.set('night');
    await new Promise(resolve => setTimeout(resolve, 0));
    sleeper.StopTesting();
    expect(cage.status.peek()).toBe('SLEEPING');
    expect(controller.playOnce).toHaveBeenLastCalledWith('sleep_pre', expect.any(Function));
    finish();
    expect(controller.start).toHaveBeenLastCalledWith('sleep_loop');
    const calls = controller.playOnce.mock.calls.length;
    scheduler.advance(6);
    expect(controller.playOnce).toHaveBeenCalledTimes(calls);

    sleeper.StartTesting();
    cycle.set('day');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cage.status.peek()).toBe('OCCUPIED');
    expect(controller.playOnce).toHaveBeenLastCalledWith('sleep_pst', expect.any(Function));
    finish();
    expect(controller.start).toHaveBeenLastCalledWith('idle_bird');
    scheduler.advance(6);
    expect(controller.playOnce).toHaveBeenLastCalledWith('hop', expect.any(Function));

    bird.components.perishable.SetPercent(.2);
    cycle.set('night');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sleeper.IsAsleep()).toBe(false);
    expect(cage.status.peek()).toBe('STARVING');
    bird.components.perishable.SetPercent(1);
    scheduler.advance(4.4);
    expect(cage.status.peek()).toBe('SLEEPING');

    sleeper.GoToSleep();
    expect(cage.occupiable!.Harvest()).toBe(bird);
    expect(cage.status.peek()).toBe('GENERIC');
    expect(cage.sleeper).toBeUndefined();
    controller.playOnce.mockClear();
    cycle.set('day');
    await new Promise(resolve => setTimeout(resolve, 0));
    sleeper.WakeUp();
    scheduler.advance(12);
    expect(controller.playOnce).not.toHaveBeenCalled();
    cage.occupiable!.Occupy(bird);
    cage.sleeper!.GoToSleep();
    expect(cage.status.peek()).toBe('SLEEPING');
    const removedSleeper = cage.sleeper!;
    cage.dispose();
    controller.playOnce.mockClear();
    cycle.set('night');
    await new Promise(resolve => setTimeout(resolve, 0));
    removedSleeper.WakeUp();
    scheduler.advance(12);
    expect(controller.playOnce).not.toHaveBeenCalled();
    bird.destroy();
    scheduler.dispose();
    instance.remove(); display.dispose();
  });

  it('starve at the cage rate, not the ground rate, and a ground bird does not starve at all', () => {
    const ground = createBird();
    settle(ground, 600);
    expect(ground.components.perishable.GetPercent()).toBe(1);

    const cage = tags();
    const occupiable = new Occupiable<ItemEntity>(cage);
    occupiable.occupanttype = 'bird';
    const caged = createBird();
    expect(occupiable.Occupy(caged)).toBe(true);
    settle(caged, 600);
    // perishable.lua Update: an occupant with no owner uses its cage's PERISH_CAGE_MULT.
    expect(caged.components.perishable.GetPercent()).toBeCloseTo(1 - 600 * PERISH_CAGE_MULT / BIRD_PERISH_TIME, 5);

    const carried = createBird();
    carried.components.inventoryitem.owner = { address: { containerId: 'player:inventory', slotKey: '0' } } as ItemOwner;
    settle(carried, 600);
    expect(carried.components.perishable.GetPercent()).toBeCloseTo(1 - 600 / BIRD_PERISH_TIME, 5);
  });

  it('Occupy tags the cage, perishing empties it before onperishfn and removes the bird', () => {
    const cage = tags();
    const occupiable = new Occupiable<ItemEntity>(cage);
    occupiable.occupanttype = 'bird';
    expect([...cage.set]).toEqual(['bird_occupiable']);
    const order: string[] = [];
    occupiable.onoccupied = () => order.push('occupied');
    occupiable.onemptied = () => order.push('emptied');
    occupiable.onperishfn = (_cage, bird) => order.push(`perished:${occupiable.GetOccupant() === bird}`);
    const bird = createBird();
    expect(occupiable.CanOccupy(bird)).toBe(true);
    occupiable.Occupy(bird);
    expect([...cage.set]).toEqual(['occupied']);
    expect(occupiable.CanOccupy(createBird('crow'))).toBe(false);

    bird.components.perishable.SetPercent(.0001);
    settle(bird, 30);
    expect(order).toEqual(['occupied', 'emptied', 'perished:true']);
    expect(occupiable.IsOccupied()).toBe(false);
    expect(bird.isRemoved).toBe(true);
    expect([...cage.set]).toEqual(['bird_occupiable']);
  });

  it('Harvest releases the same living bird, and removal empties the cage', () => {
    const occupiable = new Occupiable<ItemEntity>(tags());
    occupiable.occupanttype = 'bird';
    const bird = createBird('robin');
    occupiable.Occupy(bird);
    const emptied = vi.fn();
    occupiable.onemptied = emptied;
    expect(occupiable.Harvest()).toBe(bird);
    expect(bird.isRemoved).toBe(false);
    expect(emptied).toHaveBeenCalledTimes(1);
    const other = createBird('crow');
    occupiable.Occupy(other);
    other.destroy();
    expect(occupiable.IsOccupied()).toBe(false);
    expect(emptied).toHaveBeenCalledTimes(2);
  });

  it('a starved carried bird is replaced by its loot', () => {
    const bird = createBird('canary');
    const replace = vi.fn(() => true), PushEvent = vi.fn();
    bird.components.inventoryitem.owner = { address: { containerId: 'player:inventory', slotKey: '0' }, replace, PushEvent } as unknown as ItemOwner;
    bird.components.perishable.SetPercent(.0001);
    const random = vi.spyOn(Math, 'random');
    try { random.mockReturnValue(.2); settle(bird, 30); }
    finally { random.mockRestore(); }
    expect(replace).toHaveBeenCalledWith('smallmeat');
    expect(PushEvent).toHaveBeenCalledWith('murdered', expect.objectContaining({ victim: bird, negligent: true }));
    // Canary feathers are a tenth as likely as meat; other birds weigh them equally.
    expect(generateBirdLoot('canary', () => .08)).toBe('feather_canary');
    expect(generateBirdLoot('canary', () => .2)).toBe('smallmeat');
    expect(generateBirdLoot('crow', () => .49)).toBe('feather_crow');
    expect(generateBirdLoot('crow', () => .51)).toBe('smallmeat');
  });
});

describe('shelf', () => {
  it('offers the item only once it can be taken and removes it from the holder', () => {
    const cage = tags();
    const meat = new ItemEntity({ itemId: 'smallmeat', count: 1 });
    const holder = { RemoveItem: vi.fn(), DropItem: vi.fn() };
    const shelf = new Shelf<ItemEntity>(cage, holder);
    const taken = vi.fn();
    shelf.SetOnTakeItem((_cage, _taker, item) => taken(item));
    shelf.PutItemOnShelf(meat);
    expect(cage.set.has('takeshelfitem')).toBe(false);
    expect(shelf.TakeItem({ GiveItem: () => true })).toBe(false);
    shelf.cantakeitem = true;
    expect(cage.set.has('takeshelfitem')).toBe(true);
    const given = vi.fn(() => true);
    expect(shelf.TakeItem({ GiveItem: given })).toBe(true);
    expect(taken).toHaveBeenCalledWith(meat);
    expect(holder.RemoveItem).toHaveBeenCalledWith(meat);
    expect(given).toHaveBeenCalledWith(meat);
    expect(cage.set.has('takeshelfitem')).toBe(false);
    expect(PERISH_FAST).toBeGreaterThan(0);
  });
});

describe('what the cage eats', () => {
  it('accepts meat and seeds, refuses eggs and the rest, and picks the digested product', () => {
    expect(['smallmeat', 'meatballs', 'seeds', 'carrot', 'carrot_seeds'].map(birdcageAcceptsItem)).toEqual([true, true, true, true, true]);
    expect(['bird_egg', 'rottenegg', 'log', 'seeds_cooked', 'butterflywings'].map(birdcageAcceptsItem)).toEqual([false, false, false, false, false]);
    expect(digestedFoodProduct('smallmeat')).toBe('bird_egg');
    expect(digestedFoodProduct('carrot')).toBe('carrot_seeds');
    expect(digestedFoodProduct('seeds', () => .32)).toBe('guano');
    expect(digestedFoodProduct('seeds', () => .34)).toBeUndefined();
  });
});
