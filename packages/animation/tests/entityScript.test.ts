import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { SpriteState } from '../../display/src';
import { HomeSeeker } from '../../componets/src/homeseeker';
import { GameTimeScheduler } from '../../signals/src';
import { GetTaskRemaining, PrefabInstance } from '../../prefab/src/prefabInstance';
import type { PrefabWorldContext } from '../../prefab/src/worldContext';
import { StateGraphInstance } from '../../stategraphs/src/stategraph';
import { Brain } from '../../brains/src/brain';
import type { BehaviourContext } from '../../brains/src/behaviourtree';

const entity = (prefab: string) => new PrefabInstance(prefab, new SpriteState({ name: 'idle' }));

describe('EntityScript events and Remove on PrefabInstance', () => {
  it('calls fn(source, data) and drops a cross-entity listener when either side is removed', () => {
    const listener = entity('spider'), source = entity('spiderden'), other = entity('spiderden');
    const fn = vi.fn();
    listener.ListenForEvent('attacked', fn, source);
    source.PushEvent('attacked', { damage: 10 });
    expect(fn).toHaveBeenCalledExactlyOnceWith(source, { damage: 10 });

    // The listener retires: its registration on the source goes with it.
    listener.remove();
    source.PushEvent('attacked', { damage: 10 });
    expect(fn).toHaveBeenCalledOnce();

    // The source retires: what the listener recorded about it goes too, and nothing calls it again.
    const watcher = entity('spider'), seen = vi.fn();
    watcher.ListenForEvent('onremove', seen, other);
    other.remove();
    expect(seen).toHaveBeenCalledExactlyOnceWith(other, undefined);
    watcher.ListenForEvent('ping', seen);
    watcher.PushEvent('ping');
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('forwards a pushed event to the stategraph only when it listens, then to the brain', () => {
    const inst = entity('pigman');
    const handled: string[] = [];
    const sg = new StateGraphInstance<null, 'idle' | 'hit'>(null, [
      { name: 'idle', events: [{ name: 'attacked', fn: () => handled.push('attacked') }] },
      { name: 'hit' },
    ]);
    sg.goToState('idle');
    inst.sg = sg;
    // GoToState's "newstate" reaches its own followers, and the inst echoing it does not loop back into the stategraph.
    const follow = vi.fn(() => inst.PushEvent('newstate'));
    sg.onNewState(follow);
    sg.goToState('idle');
    expect(follow).toHaveBeenCalledOnce();

    class EventBrain extends Brain<BehaviourContext> { protected OnStart(): void {} }
    const brain = inst.brain = new EventBrain(inst as unknown as BehaviourContext);
    const heard = vi.fn();
    brain.AddEventHandler('attacked', heard);
    inst.PushEvent('attacked', { attacker: 'wilson' });
    inst.PushEvent('ignored');
    expect(handled).toEqual(['attacked']);
    expect(heard).toHaveBeenCalledExactlyOnceWith({ attacker: 'wilson' });
  });

  it('removes in EntityScript order: onremove while valid, tasks cancelled, components, then OnRemoveEntity', () => {
    const scheduler = new GameTimeScheduler();
    const inst = entity('molehill');
    inst.worldServices = { scheduler } as unknown as PrefabWorldContext;
    const order: string[] = [];
    const task = vi.fn(), periodic = vi.fn();
    inst.DoTaskInTime(1, task);
    inst.DoPeriodicTask(.5, periodic);
    scheduler.advance(.5);
    expect(periodic).toHaveBeenCalledOnce();
    inst.ListenForEvent('onremove', () => order.push(`onremove valid=${inst.isValid()}`));
    inst.onRemove(() => order.push('component'));
    inst.OnRemoveEntity = () => order.push('OnRemoveEntity');
    inst.remove();
    expect(order).toEqual(['onremove valid=true', 'component', 'OnRemoveEntity']);
    expect(inst.isValid()).toBe(false);
    expect(inst.persists).toBe(false);
    scheduler.advance(5);
    expect(task).not.toHaveBeenCalled();
    expect(periodic).toHaveBeenCalledOnce();
    scheduler.dispose();
  });

  it('pushes an event in time, reports a task\'s remaining time, and keeps it when the entity joins another scheduler', () => {
    const first = new GameTimeScheduler(), second = new GameTimeScheduler(100);
    const inst = entity('lightflier');
    inst.BindScheduler(first);
    const heard = vi.fn();
    inst.ListenForEvent('timerdone', (_inst, data) => heard(data));
    const pushed = inst.PushEventInTime(2, 'timerdone', { name: 'grow' });
    const periodic = vi.fn(), repeating = inst.DoPeriodicTask(1, periodic, 0);
    first.advance(0);
    expect(periodic).toHaveBeenCalledOnce();
    first.advance(.5);
    expect(GetTaskRemaining(pushed, first.now)).toBe(1.5);
    // Moving to another world's game time keeps what is left of each task, and the old scheduler no longer runs them.
    inst.BindScheduler(second);
    expect(pushed.NextTime()).toBe(101.5);
    first.advance(10);
    expect(heard).not.toHaveBeenCalled(); expect(periodic).toHaveBeenCalledOnce();
    second.advance(1.5);
    expect(heard).toHaveBeenCalledExactlyOnceWith({ name: 'grow' });
    expect(pushed.NextTime()).toBeUndefined(); expect(GetTaskRemaining(pushed, second.now)).toBe(-1);
    expect(periodic).toHaveBeenCalledTimes(3);
    // A periodic task cancelled from its own callback does not run again.
    periodic.mockImplementation(() => repeating.Cancel());
    second.advance(1); second.advance(5);
    expect(periodic).toHaveBeenCalledTimes(4);
    first.dispose(); second.dispose();
  });

  it('removes AddChild children after its components and before OnRemoveEntity, and parented entities as it retires', () => {
    const inst = entity('vault_pillar'), order: string[] = [];
    const child = entity('flies'), released = entity('flies'), bottom = entity('vault_pillar_bottom'), moved = entity('fx');
    inst.AddChild(child);
    inst.AddChild(released);
    inst.RemoveChild(released);
    bottom.entityParent = inst;
    moved.entityParent = inst;
    moved.entityParent = entity('other');
    expect(child.parent).toBe(inst);
    expect(child.entityParent).toBe(inst);
    child.ListenForEvent('onremove', () => order.push('child'));
    bottom.onRemove(() => order.push('bottom'));
    inst.onRemove(() => order.push('component'));
    inst.OnRemoveEntity = () => order.push(`OnRemoveEntity bottom valid=${bottom.isValid()}`);
    inst.remove();
    expect(order).toEqual(['component', 'child', 'OnRemoveEntity bottom valid=true', 'bottom']);
    expect([child.isValid(), bottom.isValid(), released.isValid(), moved.isValid()]).toEqual([false, false, true, true]);

    // A child removed first leaves its parent, which then has nothing of it to remove.
    const parent = entity('poop'), flies = entity('flies');
    parent.AddChild(flies);
    flies.remove();
    expect(flies.parent).toBeUndefined();
    const stray = vi.fn();
    flies.ListenForEvent('onremove', stray);
    parent.remove();
    expect(stray).not.toHaveBeenCalled();
  });

  it('lets a homeseeker learn that its PrefabInstance home was removed', () => {
    const home = entity('molehill'), seeker = new HomeSeeker<PrefabInstance>();
    seeker.SetHome(home);
    home.remove();
    expect(seeker.home).toBeUndefined();
  });
});

describe('EntityScript queries on PrefabInstance', () => {
  it('measures distance and angle on the ground, and FacePoint waits while the stategraph is busy', () => {
    const inst = entity('beefalo'), other = entity('wilson');
    other.setPosition(3, 0, -4);
    expect(inst.GetDistanceSqToInst(other)).toBe(25);
    expect(inst.IsNear(other, 5)).toBe(false);
    expect(inst.IsNear(other, 5.01)).toBe(true);
    expect(inst.IsNear(undefined, 100)).toBe(false);
    // atan2(z1 - z, x - x1): -z is 90 degrees; at the entity's own position the angle is its rotation.
    expect(inst.GetAngleToPoint(0, 0, -2)).toBeCloseTo(90);
    inst.setRotation(30);
    expect(inst.GetAngleToPoint(inst.getPosition())).toBeCloseTo(30);

    const sg = new StateGraphInstance<null, 'idle' | 'attack'>(null, [{ name: 'idle' }, { name: 'attack', tags: ['busy'] }]);
    inst.sg = sg;
    sg.goToState('attack');
    inst.FacePoint(0, 0, -2);
    expect(inst.rotation).toBeCloseTo(30);
    inst.ForceFacePoint(0, 0, -2);
    expect(inst.rotation).toBeCloseTo(90);
    sg.goToState('idle');
    inst.FacePoint(new THREE.Vector3(-2, 0, 0));
    expect(inst.rotation).toBeCloseTo(180);

    other.remove();
    expect(() => inst.GetDistanceSqToInst(other)).toThrow();
  });

  it('tests several tags at once, sleeps with its tile or in limbo, and keeps its age across schedulers', () => {
    const inst = entity('rabbit');
    inst.AddOrRemoveTag('animal', true);
    inst.AddOrRemoveTag('prey', true);
    inst.AddOrRemoveTag('prey', false);
    expect(inst.HasTags(['animal'])).toBe(true);
    expect(inst.HasTags(['animal', 'prey'])).toBe(false);
    expect(inst.HasOneOfTags(['prey', 'animal'])).toBe(true);
    expect(inst.HasOneOfTags([])).toBe(false);

    expect(inst.IsAsleep()).toBe(false);
    inst.setActive(false);
    expect(inst.IsAsleep()).toBe(true);
    inst.setActive(true);
    inst.RemoveFromScene();
    expect(inst.IsAsleep()).toBe(true);
    inst.ReturnToScene();
    expect(inst.IsAsleep()).toBe(false);

    const first = new GameTimeScheduler(10), second = new GameTimeScheduler(100);
    expect(() => inst.GetTimeAlive()).toThrow();
    inst.BindScheduler(first);
    first.advance(4);
    expect(inst.GetTimeAlive()).toBe(4);
    inst.BindScheduler(second);
    second.advance(1);
    expect(inst.GetTimeAlive()).toBe(5);
    first.dispose(); second.dispose();
  });

  it('makes the brain with SetBrain, holds it stopped per reason, and drops it while asleep for a new one on waking', () => {
    const inst = entity('pigman');
    const made: string[] = [];
    class TestBrain extends Brain<BehaviourContext> {
      protected OnStart(): void { made.push('start'); }
      protected override OnStop(): void { made.push('stop'); }
    }
    inst.SetBrain(owner => new TestBrain(owner as unknown as BehaviourContext));
    const first = inst.brain!;
    expect(first.stopped).toBe(false);

    inst.StopBrain('sleeper');
    inst.StopBrain('frozen');
    expect(first.stopped).toBe(true);
    inst.RestartBrain('sleeper');
    expect(first.stopped).toBe(true);

    // Asleep, the brain is dropped; on waking a new one is made, still held by the remaining reason.
    inst.setActive(false);
    expect(inst.brain).toBeUndefined();
    inst.setActive(true);
    const second = inst.brain!;
    expect(second).not.toBe(first);
    expect(second.stopped).toBe(true);
    inst.RestartBrain('frozen');
    expect(second.stopped).toBe(false);

    // In limbo it goes the same way, and SetBrain there only keeps the constructor until the entity returns.
    inst.RemoveFromScene();
    expect(inst.brain).toBeUndefined();
    inst.SetBrain(owner => new TestBrain(owner as unknown as BehaviourContext));
    expect(inst.brain).toBeUndefined();
    inst.ReturnToScene();
    expect(inst.brain?.stopped).toBe(false);
    expect(made).toEqual(['start', 'stop', 'start', 'stop', 'start']);
  });
});
