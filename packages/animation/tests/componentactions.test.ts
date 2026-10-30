import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { ItemEntity } from '../../inventory/src/entity';
import { Tool } from '../../componets/src/tool';
import { Workable } from '../../componets/src/workable';
import { collectEquippedActions, performToolWork } from '../../stategraphs/src/componentactions';
import { configureReskinToolEntity, nextReskin, reskinTarget } from '../../prefab/src/reskin_tool';
import { SpriteState } from '@dontstarve-web/display';
import type { ReskinTarget } from '../../stategraphs/src/reskin_tool';

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
    expect(collectEquippedActions(tool, target, false)).toEqual([]);
    expect(collectEquippedActions(tool, target, true)).toEqual(['HAMMER']);
    expect(performToolWork('HAMMER', target, {}, tool)).toBe(true);
    expect(work.GetWorkLeft()).toBe(1);
    expect(tool.components.finiteuses.remaining).toBe(1);
    work.SetWorkable(false);
    expect(target.hasTag('HAMMER_workable')).toBe(false);
    expect(performToolWork('HAMMER', target, {}, tool)).toBe(false);
    expect(tool.components.finiteuses.remaining).toBe(1);
    work.SetWorkable(true);
    expect(performToolWork('HAMMER', target, {}, tool)).toBe(true);
    expect(hit).toHaveBeenCalledTimes(2); expect(finish).toHaveBeenCalledOnce();
    expect(target.isRemoved).toBe(true); expect(tool.isRemoved).toBe(true);
    expect(tool.hasTag('HAMMER_tool')).toBe(false);
    expect(performToolWork('HAMMER', target, {}, tool)).toBe(false);
  } finally { target.destroy(); tool.destroy(); }
});

it('validates reskin spells and advances each tool cache only after a successful cast', async () => {
  const first = new ItemEntity({ itemId: 'reskin_tool', count: 1 });
  const second = new ItemEntity({ itemId: 'reskin_tool', count: 1 });
  configureReskinToolEntity(first); configureReskinToolEntity(second);
  let blocked = false, visible = true;
  const sprite = new SpriteState({ name: '' });
  const target: ReskinTarget = reskinTarget({
    id: 'target', prefabId: 'test_structure', model: new THREE.Group(), position: new THREE.Vector3(), sprite,
    skins: ['skin_a', 'skin_b'], isRemoved: false, hasTag: tag => blocked && tag === 'nomagic', isVisible: () => visible,
    isValid: () => true,
  });
  const doer = { position: new THREE.Vector3(), hasTag: () => false, components: {} };
  try {
    expect(collectEquippedActions(first, target, true)).toEqual(['CASTSPELL']);
    // CanCast only asks; the tool's cache advances with a cast.
    expect(first.components.spellcaster!.canCast(doer, target, target.position)).toBe(true);
    expect(first._cached_reskinname!.size).toBe(0);
    visible = false;
    expect(first.components.spellcaster!.canCast(doer, target, target.position)).toBe(false);
    visible = true; blocked = true;
    expect(collectEquippedActions(first, target, true)).toEqual([]);
    blocked = false;
    expect(first.components.spellcaster!.castSpell(target, target.position, doer)).toBe(true);
    expect(sprite.skinId.peek()).toBe('skin_a');
    expect(target.skinId).toBe('skin_a');
    expect(nextReskin(target.skins, target.skinId, first._cached_reskinname, target.prefabId)).toBe('skin_b');
    expect(nextReskin(target.skins, target.skinId, second._cached_reskinname, target.prefabId)).toBeUndefined();
    first.destroy(); expect(first.hasTag('castontargets')).toBe(false);
  } finally { first.destroy(); second.destroy(); }
});
