import { collectEquippedItemActions } from '../../stategraphs/src/componentactions';
import { testPlayer } from './testPlayer';
import { expect, it, vi } from 'vitest';
import { ItemEntity } from '../../inventory/src/entity';
import { Tool } from '../../componets/src/tool';
import { Workable } from '../../componets/src/workable';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { configureReskinToolEntity, nextReskin } from '../../prefab/src/reskin_tool';
import { PrefabInstance } from '../../prefab/src/prefabInstance';
import { SpriteResources, SpriteState } from '@dontstarve-web/display';

it('selects work from component tags, revalidates changes at impact and consumes only successful work', () => {
  const tool = new ItemEntity({ itemId: 'test_tool', count: 1 });
  tool.components.finiteuses.setMaxUses(2);
  tool.components.tool = tool.component('tool', () => new Tool(tool));
  tool.components.tool.SetAction('HAMMER');
  const target = new ItemEntity({ itemId: 'test_structure', count: 1 });
  const work = target.component('workable', () => new Workable(target));
  target.components.workable = work;
  work.SetWorkAction('HAMMER'); work.SetWorkLeft(2);
  const hit = vi.fn(), finish = vi.fn(() => target.destroy());
  work.SetOnWorkCallback(hit); work.SetOnFinishCallback(finish);
  try {
    expect(collectEquippedItemActions(tool, undefined, target, false)).toEqual([]);
    expect(collectEquippedItemActions(tool, undefined, target, true)).toEqual(['HAMMER']);
    expect(performToolWork('HAMMER', target, testPlayer(), tool)).toBe(true);
    expect(work.GetWorkLeft()).toBe(1);
    expect(tool.components.finiteuses.remaining).toBe(1);
    work.SetWorkable(false);
    expect(target.hasTag('HAMMER_workable')).toBe(false);
    expect(performToolWork('HAMMER', target, testPlayer(), tool)).toBe(false);
    expect(tool.components.finiteuses.remaining).toBe(1);
    work.SetWorkable(true);
    expect(performToolWork('HAMMER', target, testPlayer(), tool)).toBe(true);
    expect(hit).toHaveBeenCalledTimes(2); expect(finish).toHaveBeenCalledOnce();
    expect(target.isRemoved).toBe(true); expect(tool.isRemoved).toBe(true);
    expect(tool.hasTag('HAMMER_tool')).toBe(false);
    expect(performToolWork('HAMMER', target, testPlayer(), tool)).toBe(false);
  } finally { target.destroy(); tool.destroy(); }
});

it('validates reskin spells and advances each tool cache only after a successful cast', async () => {
  const first = new ItemEntity({ itemId: 'reskin_tool', count: 1 });
  const second = new ItemEntity({ itemId: 'reskin_tool', count: 1 });
  configureReskinToolEntity(first); configureReskinToolEntity(second);
  // The entity the mouse picks, and a skinned structure the reskin spell is cast on.
  const picked = new ItemEntity({ itemId: 'test_structure', count: 1 });
  const sprite = new SpriteState({ name: '' });
  sprite.setSkinSource({ archives: { skin_a: 'skin_a.zip', skin_b: 'skin_b.zip' }, art: new SpriteResources().archives });
  const target = new PrefabInstance('test_structure', sprite);
  const doer = testPlayer();
  try {
    expect(collectEquippedItemActions(first, undefined, picked, true)).toEqual(['CASTSPELL']);
    // CanCast only asks; the tool's cache advances with a cast.
    expect(first.components.spellcaster!.canCast(doer, target, target.position.clone())).toBe(true);
    expect(first._cached_reskinname!.size).toBe(0);
    sprite.setVisible(false);
    expect(first.components.spellcaster!.canCast(doer, target, target.position.clone())).toBe(false);
    sprite.setVisible(true); picked.addTag('nomagic');
    expect(collectEquippedItemActions(first, undefined, picked, true)).toEqual([]);
    picked.removeTag('nomagic');
    expect(first.components.spellcaster!.castSpell(target, target.position.clone(), doer)).toBe(true);
    expect(sprite.skinId.peek()).toBe('skin_a');
    expect(nextReskin(sprite.skinNames, sprite.skinId.peek(), first._cached_reskinname, target.prefab)).toBe('skin_b');
    expect(nextReskin(sprite.skinNames, sprite.skinId.peek(), second._cached_reskinname, target.prefab)).toBeUndefined();
    first.destroy(); expect(first.hasTag('castontargets')).toBe(false);
  } finally { first.destroy(); second.destroy(); picked.destroy(); target.remove(); }
});
