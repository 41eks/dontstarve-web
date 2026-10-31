import { expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { LootDropper, type LootRecipe } from '../../componets/src/lootdropper';

const recipes = new Map<string, LootRecipe>([
  ['structure', { ingredients: [{ type: 'boards', amount: 4 }, { type: 'goldnugget', amount: 2 }] }],
]);

it('owns recipe returns, finite uses scaling and burnt charcoal probability', () => {
  let burnt = false, percent = 1;
  const inst = { prefab: 'structure', hasTag: (tag: string) => burnt && tag === 'burnt',
    components: { finiteuses: { GetPercent: () => percent } }, getPosition: () => new Vector3() };
  const loot = new LootDropper(inst, () => undefined, recipes);
  expect(loot.GenerateLoot(() => .8)).toEqual(['boards', 'boards', 'goldnugget']);
  percent = .5;
  expect(loot.GenerateLoot(() => .8)).toEqual(['boards', 'goldnugget']);
  burnt = true; percent = 1;
  expect(loot.GenerateLoot(() => .8)).toEqual(['boards', 'goldnugget']);
  expect(loot.GenerateLoot(() => .39)).toEqual(['boards', 'goldnugget', 'charcoal']);
  expect(loot.GenerateLoot(() => .4)).toEqual(['boards', 'goldnugget']);
});

it('drops through the owning component and keeps source loot events on the spawned entities', () => {
  const position = new Vector3(4, 0, -2), PushEvent = vi.fn(), lootEvent = vi.fn();
  const inst = { prefab: 'structure', getPosition: () => position, PushEvent };
  const spawn = vi.fn(() => ({ PushEvent: lootEvent }));
  const loot = new LootDropper(inst, spawn, recipes);
  loot.DropLoot();
  expect(spawn.mock.calls).toEqual([['boards', position, undefined], ['boards', position, undefined], ['goldnugget', position, undefined]]);
  expect(lootEvent).toHaveBeenCalledTimes(3);
  expect(lootEvent).toHaveBeenCalledWith('on_loot_dropped', { dropper: inst });
  expect(PushEvent).toHaveBeenCalledTimes(3);
});
