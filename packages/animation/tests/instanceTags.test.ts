import { expect, it, vi } from 'vitest';
import { batch } from '../../signals/src';
import { SpriteState } from '../../display/src';
import { Battery } from '../../componets/src/battery';
import { Workable } from '../../componets/src/workable';
import { addComponent, removeComponent } from '../../prefab/src/components';
import { PrefabInstance } from '../../prefab/src/prefabInstance';

class TaggedInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { workable?: Workable; battery?: Battery<TaggedInstance> };
}

it('publishes own and component-derived tags on inst.tags, while hasTag reads the current inputs inside a batch', () => {
  const inst = new TaggedInstance('test_tags', new SpriteState({ name: 'idle' }));
  const changes = vi.fn();
  const stop = inst.tags.subscribe(tags => changes([...tags]));
  try {
    inst.addTag('structure');
    const workable = addComponent(inst, 'workable', Workable);
    workable.SetWorkAction('HAMMER'); workable.SetWorkLeft(2);
    expect(inst.listTags()).toEqual(['structure', 'HAMMER_workable']);
    expect(changes).toHaveBeenLastCalledWith(['structure', 'HAMMER_workable']);

    // The derived tag follows the workable's state, also before the batch's memos settle.
    batch(() => {
      workable.SetWorkable(false);
      expect(inst.hasTag('HAMMER_workable')).toBe(false);
      expect(changes).toHaveBeenLastCalledWith(['structure', 'HAMMER_workable']);
    });
    expect(changes).toHaveBeenLastCalledWith(['structure']);

    // A Lua constructor tag lives on the inst and goes with the component's OnRemoveFromEntity.
    addComponent(inst, 'battery', Battery<TaggedInstance>);
    expect(inst.hasTag('battery')).toBe(true);
    removeComponent(inst, 'battery');
    expect(inst.hasTag('battery')).toBe(false);

    // RemoveComponent ends the derived registration.
    workable.SetWorkLeft(1);
    expect(inst.hasTag('HAMMER_workable')).toBe(true);
    removeComponent(inst, 'workable');
    expect([inst.hasTag('HAMMER_workable'), inst.listTags()]).toEqual([false, ['structure']]);
    expect(changes).toHaveBeenLastCalledWith(['structure']);
  } finally { stop(); inst.remove(); }
});
