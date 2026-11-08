import { describe, expect, it, vi } from 'vitest';
import { SpriteState } from '../../display/src';
import { HomeSeeker } from '../../componets/src/homeseeker';
import { GameTimeScheduler } from '../../signals/src';
import { PrefabInstance } from '../../prefab/src/prefabInstance';
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

  it('lets a homeseeker learn that its PrefabInstance home was removed', () => {
    const home = entity('molehill'), seeker = new HomeSeeker<PrefabInstance>();
    seeker.SetHome(home);
    home.remove();
    expect(seeker.home).toBeUndefined();
  });
});
