import { expect, it } from 'vitest';
import { SpriteState } from '../../display/src/spriteState';
import { PrefabInstance } from '../../prefab/src/prefabInstance';
import { smallHash } from '../src/animationAssets';

it('inst.AnimState plays, loops and queues clips on the sprite and holds the symbol overrides on the same object', () => {
  const inst = new PrefabInstance('test', new SpriteState({ name: 'idle' }));
  const anim = inst.AnimState;
  expect(inst.AnimState).toBe(anim);

  anim.PlayAnimation('idle_loop', true);
  expect(inst.sprite.sprite.value.clip).toMatchObject({ name: 'idle_loop', loop: true, finished: false });
  anim.PlayAnimation('hit');
  expect(inst.sprite.sprite.value.clip).toMatchObject({ name: 'hit', loop: false });
  anim.PushAnimation('idle_loop', true);
  expect(inst.sprite.sprite.value.queue).toEqual([{ name: 'idle_loop', loop: true }]);

  anim.OverrideSymbol('swap_object', 'swap_axe', 'swap_axe');
  inst.sprite.setAnimState(anim.json);
  const declared = inst.sprite.sprite.value.appearance.get('anim-state');
  expect(declared?.kind === 'anim-state' && declared.state.value.overrides.has(smallHash('swap_object'))).toBe(true);
});
