import { wilsonStateInst } from './wilsonStateInst';
import { testPlayer } from './testPlayer';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Inspectable } from '../../componets/src/inspectable';
import { GetDescription, STRINGS } from '../../componets/src/stringutil';
import { Talker } from '../../componets/src/talker';
import { addComponent } from '../../prefab/src/components';
import { registerActionEntity } from '../../prefab/src/actionEntity';
import { createEmptyEntity } from '../../prefab/src/prefabInstance';
import { createBufferedAction } from '../../stategraphs/src/actionfns';
import { getActionPriority } from '../../stategraphs/src/actions';
import { collectSceneActions } from '../../stategraphs/src/componentactions';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { WilsonStateGraph, type WilsonStateName } from '../../stategraphs/src/SGwilson';
import { ItemEntity } from '../../inventory/src';

const describeStrings = STRINGS.CHARACTERS.GENERIC.DESCRIBE;
/** The player inst that looks: its character and tags choose the line. */
const viewer = (prefab = 'wilson', tags: string[] = []) => testPlayer({ prefab, tags });

function entity(prefab = 'birdcage') {
  const { instance, display } = createEmptyEntity(prefab);
  const inspectable = addComponent(instance, 'inspectable', Inspectable);
  return { instance, display, inspectable, dispose() { instance.remove(); display.dispose(); } };
}

afterEach(() => vi.restoreAllMocks());

describe('stringutil.lua GetDescription', () => {
  it('reads the status line, a random numbered line, a character override and the fallback', () => {
    expect(GetDescription(viewer(), { prefab: 'birdcage' }, 'DEAD')).toBe(describeStrings.BIRDCAGE.DEAD);
    // An unknown status falls back to the topic's GENERIC.
    expect(GetDescription(viewer(), { prefab: 'birdcage' }, 'NOSUCHSTATUS')).toBe(describeStrings.BIRDCAGE.GENERIC);
    vi.spyOn(Math, 'random').mockReturnValue(.99);
    const lines = describeStrings.ABIGAIL.LEVEL1;
    expect(GetDescription(viewer(), { prefab: 'abigail' }, 'LEVEL1')).toBe(lines[lines.length - 1]);
    vi.restoreAllMocks();
    expect(GetDescription(viewer('wortox'), { prefab: 'birdcage' }, 'DEAD')).toBe(STRINGS.CHARACTERS.WORTOX.DESCRIBE.BIRDCAGE.DEAD);
    expect(GetDescription(viewer(), { prefab: 'no_such_prefab' })).toBe(STRINGS.CHARACTERS.GENERIC.DESCRIBE_GENERIC);
    expect(GetDescription(viewer('wilson', ['playerghost']), { prefab: 'birdcage' })).toMatch(/^[Oo]/);
    expect(GetDescription(viewer(), { prefab: 'rock', nameoverride: 'birdcage' }, 'DEAD')).toBe(describeStrings.BIRDCAGE.DEAD);
  });
});

describe('inspectable.lua', () => {
  it('prefers getstatus, then the component states, and says nothing about the viewer itself', () => {
    const { instance, inspectable, dispose } = entity();
    expect(inspectable.GetDescription(viewer())).toBe(describeStrings.BIRDCAGE.GENERIC);
    instance.addTag('burnt');
    expect(inspectable.GetStatus()).toBe('BURNT');
    inspectable.getstatus = () => 'DEAD';
    expect(inspectable.GetDescription(viewer())).toBe(describeStrings.BIRDCAGE.DEAD);
    expect(inspectable.GetDescription(instance as never)).toBeUndefined();
    inspectable.SetDescription('a fixed line');
    expect(inspectable.GetDescription(viewer())).toBe('a fixed line');
    expect(inspectable.GetDescription(viewer('wilson', ['mime']))).toBe('');
    dispose();
  });

  it('lets every item be examined', () => {
    const rocks = new ItemEntity({ itemId: 'rocks', count: 1 });
    expect(rocks.components.inspectable!.GetDescription(viewer())).toBe((describeStrings as Record<string, unknown>).ROCKS);
    expect(rocks.hasTag('inspectable')).toBe(true);
    rocks.destroy();
  });
});

describe('talker.lua', () => {
  it('shows one line for its duration, and a new line ends the one being said', () => {
    const scheduler = new GameTimeScheduler(), PushEvent = vi.fn();
    const talker = new Talker({ PushEvent }, scheduler);
    talker.Say('first');
    expect(talker.line.peek()).toBe('first');
    expect(PushEvent).toHaveBeenLastCalledWith('ontalk', { noanim: undefined, duration: 2.5 });
    scheduler.advance(1);
    talker.Say('second', 20, true);
    expect(PushEvent.mock.calls.map(([name]) => name)).toEqual(['ontalk', 'donetalking', 'ontalk']);
    expect(PushEvent).toHaveBeenLastCalledWith('ontalk', { noanim: true, duration: 8 });
    scheduler.advance(7.9);
    expect(talker.IsTalking()).toBe(true);
    scheduler.advance(.1);
    expect(talker.line.peek()).toBeUndefined();
    expect(PushEvent).toHaveBeenLastCalledWith('donetalking');
    new Talker({ PushEvent, components: { health: { IsDead: () => true } } }, scheduler).Say('ignored');
    expect(PushEvent).toHaveBeenCalledTimes(4);
    talker.OnRemoveEntity();
    scheduler.dispose();
  });
});

describe('ACTIONS.LOOKAT', () => {
  /** The player inst in a state of its stategraph, whose tags LOOKAT reads. */
  const sgDoer = (state: WilsonStateName) => {
    const doer = testPlayer();
    doer.SetStateGraph(() => new WilsonStateGraph(wilsonStateInst())).goToState(state);
    return doer;
  };

  it('is offered to an idle doer on both buttons at the lowest priority, and not while it moves', () => {
    const { instance, dispose } = entity();
    expect(collectSceneActions(instance, sgDoer('idle'), false)).toEqual(['LOOKAT']);
    expect(collectSceneActions(instance, sgDoer('idle'), true)).toEqual(['LOOKAT']);
    expect(collectSceneActions(instance, sgDoer('run'), false)).toEqual([]);
    expect(collectSceneActions(instance, sgDoer('dolongaction'), false)).toEqual([]);
    expect(getActionPriority({ action: 'LOOKAT' })).toBeLessThan(getActionPriority({ action: 'RUMMAGE' }));
    dispose();
  });

  it('says the description and takes the talk state until the line ends', () => {
    const { instance, dispose } = entity();
    const scheduler = new GameTimeScheduler();
    const graph = new WilsonStateGraph(wilsonStateInst(undefined, () => 1));
    // The player inst says the line with its own talker; its talk events reach its stategraph.
    const doer = viewer();
    doer.SetStateGraph(() => graph);
    const talker = addComponent(doer, 'talker', Talker, scheduler);
    expect(createBufferedAction('LOOKAT', { doer, target: instance }).do()).toBe(true);
    expect(talker.line.peek()).toBe(describeStrings.BIRDCAGE.GENERIC);
    expect(graph.stateName).toBe('talk');
    scheduler.advance(2.5);
    expect(graph.stateName).toBe('idle');
    graph.dispose(); scheduler.dispose(); dispose();
  });

  it('Alt examines a target even when the click would do something else, on the move too', () => {
    const { instance, display, dispose } = entity();
    new THREE.Scene().add(display.model);
    registerActionEntity(instance);
    const pointer = { trackPointer() {}, beginFrame() {}, endFrame() {}, pickMouseTarget: () => ({ object: display.model as THREE.Object3D }), groundPoint: () => undefined, dispose() {} };
    const picker = new PlayerActionPicker(pointer as never);
    const doer = sgDoer('run');
    picker.bindPlayer(doer, () => undefined);
    expect(picker.getMouseActions({} as PointerEvent).left).toBeUndefined();
    expect(picker.getMouseActions({ altKey: true } as PointerEvent).left?.action).toBe('LOOKAT');
    dispose();
  });
});
