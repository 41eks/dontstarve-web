import { prefabInstance } from '../../prefab/src/prefabInstance';
import { findActionEntity } from '../../prefab/src/actionEntity';
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { batch } from '../../signals/src';
import { Workable } from '../../componets/src/workable';
import { ItemEntity } from '../../inventory/src/entity';
import { actionEntity } from '../../prefab/src/actionEntity';

function itemWorkable(workleft = 3) {
  const entity = new ItemEntity({ itemId: 'test_workable', count: 1 });
  const work = entity.component('workable', () => new Workable(entity));
  entity.components.workable = work;
  work.SetWorkAction('HAMMER'); work.SetWorkLeft(workleft);
  return { entity, work };
}

it('publishes readonly work and derived eligibility, while successful work explicitly finishes in Lua event order', () => {
  const { entity, work } = itemWorkable();
  const changed = vi.fn(), finish = vi.fn(), events: string[] = [];
  const stop = work.workleft.subscribe(changed);
  entity.ListenForEvent('worked', () => {
    events.push('worked');
    expect(entity.hasTag('HAMMER_workable')).toBe(work.workleft.peek() > 0);
  });
  entity.ListenForEvent('workfinished', () => events.push('workfinished'));
  const worker = { PushEvent: (name: string) => events.push(name) };
  work.SetOnWorkCallback(() => events.push('onwork'));
  work.SetOnFinishCallback(() => { events.push('onfinish'); finish(); });
  try {
    for (const signal of [work.workleft, work.enabled, work.action, work.canBeWorked, work.actionTag, entity.removal]) {
      expect('set' in signal).toBe(false);
    }
    expect(work.WorkedBy(worker)).toBe(true);
    expect(work.workleft.peek()).toBe(2);
    work.SetWorkable(false);
    expect(work.GetWorkLeft()).toBe(0);
    expect(work.workleft.peek()).toBe(2);
    expect(work.canBeWorked.peek()).toBe(false);
    expect(entity.hasTag('HAMMER_workable')).toBe(false);
    expect(work.WorkedBy(worker)).toBe(false);
    expect(changed).toHaveBeenCalledExactlyOnceWith(2, 3);
    work.SetWorkable(true);
    work.WorkedBy(worker); work.WorkedBy(worker);
    expect(work.workleft.peek()).toBe(0);
    expect(work.canBeWorked.peek()).toBe(false);
    expect(work.actionTag.peek()).toBeUndefined();
    expect(entity.hasTag('HAMMER_workable')).toBe(false);
    expect(events).toEqual(['working', 'worked', 'onwork', 'working', 'worked', 'onwork',
      'working', 'worked', 'onwork', 'onfinish', 'workfinished', 'finishedwork']);
    expect(finish).toHaveBeenCalledOnce();
    expect(work.WorkedBy(worker)).toBe(false);
    work.SetWorkLeft(2); work.OnLoad({ workleft: 0 });
    expect(finish).toHaveBeenCalledOnce(); // Restoring zero updates state; it does not perform work.
  } finally { stop(); entity.destroy(); }
});

it('reads current action eligibility during a transaction and publishes only the committed derived state', () => {
  const { entity, work } = itemWorkable(2);
  const canWork = vi.fn(), tags = vi.fn(), finish = vi.fn();
  const stopWork = work.canBeWorked.subscribe(canWork), stopTags = work.actionTag.subscribe(tags);
  work.SetOnFinishCallback(finish);
  try {
    batch(() => {
      work.SetWorkable(false);
      expect(work.CanBeWorked()).toBe(false);
      expect(entity.hasTag('HAMMER_workable')).toBe(false);
      work.SetWorkLeft(3);
      expect(work.CanBeWorked()).toBe(true);
      work.SetWorkAction('NET');
      expect(entity.hasTag('HAMMER_workable')).toBe(false);
      expect(entity.hasTag('NET_workable')).toBe(true);
      work.OnLoad({ workleft: 0 });
      expect(entity.hasTag('NET_workable')).toBe(false);
      expect(work.WorkedBy({})).toBe(false);
      expect(canWork).not.toHaveBeenCalled();
      expect(tags).not.toHaveBeenCalled();
    });
    expect(work.canBeWorked.peek()).toBe(false);
    expect(canWork).toHaveBeenCalledExactlyOnceWith(false, true);
    expect(tags).toHaveBeenCalledExactlyOnceWith(undefined, 'HAMMER_workable');
    expect(finish).not.toHaveBeenCalled();
  } finally { stopWork(); stopTags(); entity.destroy(); }
});

it('preserves savestate rules and reacts to world removal, releasing memo dependencies on component disposal', () => {
  const source = itemWorkable(), ordinary = itemWorkable(), persistent = itemWorkable();
  const model = new THREE.Group(), entity = actionEntity(model, 'test_world');
  const work = new Workable(entity);
  (findActionEntity(model)?.components ?? prefabInstance(model)!.components).workable = work;
  const reads = vi.spyOn(entity.removal, 'get'), eligibility = vi.fn(), finish = vi.fn();
  const stop = work.canBeWorked.subscribe(eligibility);
  work.SetOnFinishCallback(finish);
  try {
    source.work.WorkedBy({});
    expect(source.work.OnSave()).toEqual({});
    ordinary.work.OnLoad(source.work.OnSave());
    expect(ordinary.work.workleft.peek()).toBe(3);
    source.work.savestate = true;
    expect(source.work.OnSave()).toEqual({ workleft: 2 });
    persistent.work.OnLoad(source.work.OnSave());
    expect(persistent.work.workleft.peek()).toBe(2);
    expect(persistent.work.canBeWorked.peek()).toBe(true);
    model.userData.removed = true;
    expect(entity.isRemoved).toBe(true);
    expect(work.canBeWorked.peek()).toBe(false);
    expect(entity.hasTag('CHOP_workable')).toBe(false);
    expect(eligibility).toHaveBeenCalledExactlyOnceWith(false, true);
    expect(finish).not.toHaveBeenCalled();
    work.dispose();
    reads.mockClear();
    // A retained old model changing cannot re-run a disposed component's derivations.
    model.userData.removed = false;
    work.SetWorkLeft(20);
    expect(reads).not.toHaveBeenCalled();
    expect(work.workleft.peek()).toBe(10);
    expect(work.canBeWorked.peek()).toBe(false);
    expect(work.actionTag.peek()).toBeUndefined();
  } finally { stop(); reads.mockRestore(); work.dispose(); source.entity.destroy(); ordinary.entity.destroy(); persistent.entity.destroy(); }
});
