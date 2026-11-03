import { expect, it, vi } from 'vitest';
import { SpriteState } from '@dontstarve-web/display';
import { addComponent, removeComponent } from '../../prefab/src/components';
import { PrefabInstance } from '../../prefab/src/prefabInstance';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';

function entity() {
  const inst = new PrefabInstance('test', new SpriteState({ name: 'idle' }));
  return inst;
}

it('returns an existing component without replacing its state and keeps it while the entity sleeps', () => {
  const inst = entity(), scheduler = new GameTimeScheduler();
  const burnable = addComponent(inst, 'burnable', scheduler);
  const burnt = vi.fn();
  burnable.SetBurnTime(5);
  burnable.SetOnBurntFn(burnt);
  burnable.Ignite();
  try {
    scheduler.advance(2);
    expect(addComponent(inst, 'burnable', scheduler)).toBe(burnable);
    inst.setActive(false);
    expect(inst.components.burnable).toBe(burnable);
    expect(burnable.IsBurning()).toBe(true);
    scheduler.advance(3);
    expect(burnt).toHaveBeenCalledOnce();
  } finally { inst.remove(); scheduler.dispose(); }
});

it('detaches before teardown, permits reattachment and cleans up exactly once on entity removal', () => {
  const inst = entity(), scheduler = new GameTimeScheduler();
  const burnable = addComponent(inst, 'burnable', scheduler);
  const extinguished = vi.fn(() => expect(inst.components.burnable).toBeUndefined());
  const extinguishEvents = vi.fn();
  inst.ListenForEvent('onextinguish', extinguishEvents);
  burnable.SetOnExtinguishFn(extinguished);
  burnable.Ignite();
  const dispose = vi.spyOn(burnable, 'dispose');
  removeComponent(inst, 'burnable');
  removeComponent(inst, 'burnable');
  expect(extinguished).toHaveBeenCalledOnce();
  expect(extinguishEvents).toHaveBeenCalledOnce();
  expect(dispose).toHaveBeenCalledOnce();

  const replacement = addComponent(inst, 'burnable', scheduler);
  const removed = vi.spyOn(replacement, 'dispose'), burnt = vi.fn();
  expect(replacement).not.toBe(burnable);
  replacement.SetBurnTime(1);
  replacement.SetOnBurntFn(burnt);
  replacement.SetOnExtinguishFn(extinguished);
  replacement.Ignite();
  inst.remove(); inst.remove();
  scheduler.advance(2);
  expect(inst.components.burnable).toBeUndefined();
  expect(removed).toHaveBeenCalledOnce();
  expect(dispose).toHaveBeenCalledOnce();
  expect(extinguished).toHaveBeenCalledOnce();
  expect(extinguishEvents).toHaveBeenCalledOnce();
  expect(burnt).not.toHaveBeenCalled();
  expect(() => addComponent(inst, 'burnable', scheduler)).toThrow('removed entity');
  scheduler.dispose();
});

it('retains the concrete prefab host in workable callbacks and validates constructor arguments', () => {
  const inst = entity();
  const workable = addComponent(inst, 'workable');
  const worked = vi.fn();
  workable.SetWorkAction('HAMMER');
  workable.SetWorkLeft(2);
  workable.SetOnWorkCallback(host => { host.sprite.start('hit'); worked(host); });
  workable.WorkedBy({}, 1);
  expect(worked).toHaveBeenCalledExactlyOnceWith(inst);
  expect(inst.sprite.currentAnimation).toBe('hit');
  const dispose = vi.spyOn(workable, 'dispose');
  inst.remove();
  expect(dispose).toHaveBeenCalledOnce();

  if (false) {
    // @ts-expect-error burnable expects a scheduler rather than a number
    addComponent(inst, 'burnable', 2);
    // @ts-expect-error propagator requires its size and spatial query
    addComponent(inst, 'propagator');
    // @ts-expect-error unknown component names are not accepted
    addComponent(inst, 'missing');
  }
});
