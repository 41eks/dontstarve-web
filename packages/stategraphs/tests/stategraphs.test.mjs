import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActionHandler, BufferedAction, FRAMES, StateGraphInstance, TimeEvent, WilsonStateGraph } from '../src/index.ts';

function taggedObject(prefab, tags = []) {
  return { prefab, hasTag: tag => tags.includes(tag) };
}
const reskinTool = taggedObject('reskin_tool', ['veryquickcast']);
const bugnet = taggedObject('bugnet', ['NET_tool']);

function actor() {
  const played = [], sounds = [], casting = [];
  const frames = {
    pickaxe_pre: 9, pickaxe_loop: 20, pickaxe_pst: 5,
    bugnet_pre: 6, bugnet: 24,
    shovel_pre: 10, shovel_loop: 40, shovel_pst: 6,
    staff_pre: 15, staff: 65, atk_pre: 5, atk: 15,
  };
  const graph = new WilsonStateGraph({
    playAnimation: (clip) => {
      played.push(clip.name);
      return (frames[clip.key] ?? 30) / ((clip.frameRate ?? 30) * (clip.playbackRate ?? 1));
    },
    playSound: (cue) => sounds.push(cue),
    setCasting: (value) => casting.push(value),
    onStateChanged() {},
  });
  return { graph, played, sounds, casting };
}

for (const [label, action, commitFrame, invobject] of [
  ['MINE', 'MINE', 16], ['CASTSPELL', 'CASTSPELL', 53], ['reskin CASTSPELL', 'CASTSPELL', 9, reskinTool],
]) {
  test(`${label} commits once at its source frame, including the correct pre-animation clock`, () => {
    const { graph } = actor();
    const events = [];
    let executed = 0;
    graph.listenForEvent('performaction', ({ action: buffered }) => {
      events.push(buffered.action);
      assert.equal(executed, 0); // Lua's notification is before execution.
    });
    assert.equal(graph.pushBufferedAction(new BufferedAction(action, () => { executed++; }, undefined, { invobject })), true);
    assert.equal(graph.isPerformingAction(action), true);
    assert.equal(graph.pushBufferedAction(new BufferedAction(action, () => { executed++; }, undefined, { invobject })), false);
    graph.update((commitFrame - 0.5) * FRAMES);
    assert.equal(executed, 0);
    graph.update(0.5 * FRAMES);
    assert.equal(executed, 1);
    graph.update(10);
    assert.equal(executed, 1);
    assert.deepEqual(events, [action]);
    assert.equal(graph.stateName, 'idle');
    assert.equal(graph.isPerformingAction(action), false);
  });

  if (invobject === reskinTool) for (const reason of ['unequip', 'cancel']) {
    test(`${label} discards uncommitted work on ${reason}`, () => {
      const { graph } = actor();
      let executed = 0;
      const failures = [];
      graph.listenForEvent('actionfailed', ({ action }) => failures.push(action.action));
      graph.pushBufferedAction(new BufferedAction(action, () => { executed++; }, undefined, { invobject }));
      graph.update(2 * FRAMES);
      if (reason === 'unequip') graph.pushEvent('unequip');
      if (reason === 'cancel') graph.cancelAction();
      graph.update(10);
      assert.equal(executed, 0);
      assert.deepEqual(failures, [action]);
      assert.equal(graph.stateName, 'idle');
    });
  }
}

test('cast sound precedes commitment, committed effects keep running and early interruption removes them', () => {
  const { graph, sounds, casting } = actor();
  graph.pushBufferedAction(new BufferedAction('CASTSPELL', () => {}));
  assert.deepEqual(casting, [true]);
  graph.update(12 * FRAMES);
  assert.deepEqual(sounds, []);
  graph.update(FRAMES);
  assert.deepEqual(sounds, ['cast']);
  graph.update(100 * FRAMES);
  assert.deepEqual(casting, [true]);
  graph.pushBufferedAction(new BufferedAction('CASTSPELL', () => {}));
  graph.update(12 * FRAMES);
  graph.cancelAction();
  graph.update(10);
  assert.deepEqual(sounds, ['cast']);
  assert.deepEqual(casting, [true, true, false]);
});

test('a performaction listener can cancel before the action runs and unsubscribe afterward', () => {
  const { graph } = actor();
  let executed = 0;
  const unsubscribe = graph.listenForEvent('performaction', () => graph.cancelAction());
  graph.pushBufferedAction(new BufferedAction('TERRAFORM', () => { executed++; }));
  graph.update(25 * FRAMES);
  assert.equal(executed, 0);
  assert.equal(graph.stateName, 'idle');
  unsubscribe();
  graph.pushBufferedAction(new BufferedAction('TERRAFORM', () => { executed++; }));
  graph.update(25 * FRAMES);
  assert.equal(executed, 1);
});

test('pending actions revalidate at execution and report failure without performing work', () => {
  const { graph } = actor();
  let valid = true, executed = 0;
  const failures = [];
  graph.listenForEvent('actionfailed', ({ action }) => failures.push(action.action));
  graph.pushBufferedAction(new BufferedAction('NET', () => { executed++; }, () => valid, { invobject: bugnet }));
  graph.update(8 * FRAMES);
  valid = false;
  graph.update(20 * FRAMES);
  assert.equal(executed, 0);
  assert.deepEqual(failures, ['NET']);
});

test('an action may change states at its commit frame without damaging the new state', () => {
  const { graph } = actor();
  let casts = 0;
  graph.pushBufferedAction(new BufferedAction('TERRAFORM', () => {
    graph.cancelAction();
    graph.pushBufferedAction(new BufferedAction('CASTSPELL', () => { casts++; }, undefined, { invobject: reskinTool }));
  }));
  graph.update(25 * FRAMES);
  assert.equal(graph.stateName, 'veryquickcastspell');
  assert.equal(graph.hasStateTag('busy'), true);
  graph.update(9 * FRAMES);
  assert.equal(casts, 1);
  assert.equal(graph.hasStateTag('busy'), false);
});

test('movement, crafting, equipment transitions and half-speed pickup return to the requested state', () => {
  const { graph } = actor();
  graph.requestOneShot('pickup');
  graph.requestMovement('run');
  graph.update(1.99);
  assert.equal(graph.stateName, 'pickup');
  graph.update(0.01);
  assert.equal(graph.stateName, 'run');
  graph.requestCrafting(true);
  assert.equal(graph.pushBufferedAction(new BufferedAction('MINE', () => {})), false);
  graph.requestOneShot('item_out');
  graph.update(1);
  assert.equal(graph.stateName, 'build');
  graph.requestCrafting(false);
  assert.equal(graph.stateName, 'run');
  graph.requestMovement('jump');
  assert.equal(graph.pushBufferedAction(new BufferedAction('TERRAFORM', () => {})), false);
});

test('emote queues emit each animation completion and loop only their final clip', () => {
  const { graph, played } = actor();
  const events = [];
  graph.listenForEvent('animover', () => events.push('animover'));
  graph.listenForEvent('animqueueover', () => events.push('animqueueover'));
  graph.requestEmote(['emote_pre', 'emote_loop'], true);
  graph.update(3.2);
  assert.deepEqual(played.slice(1), ['emote_pre', 'emote_loop', 'emote_loop', 'emote_loop']);
  assert.deepEqual(events, ['animover', 'animover', 'animover']);
  assert.ok(Math.abs(graph.animationTime - 0.2) < 1e-8);
  graph.requestMovement('walk');
  assert.equal(graph.stateName, 'walk');
  graph.requestEmote(['wave_pre', 'wave'], false);
  graph.update(2);
  assert.equal(graph.stateName, 'walk');
  assert.equal(events.at(-1), 'animqueueover');
});

test('the timeline runner preserves overshoot and drops the old state timeline on transition', () => {
  const observed = [];
  const graph = new StateGraphInstance({}, [
    { name: 'first', tags: ['old'], timeline: [
      TimeEvent(0.2, (inst) => { observed.push('first'); inst.goToState('second'); }),
      TimeEvent(0.2, () => observed.push('stale')),
    ] },
    { name: 'second', timeline: [TimeEvent(0.1, () => observed.push('second'))] },
  ]);
  graph.goToState('first');
  graph.update(0.35);
  assert.deepEqual(observed, ['first', 'second']);
  assert.ok(Math.abs(graph.timeInState - 0.15) < 1e-8);
  assert.equal(graph.hasStateTag('old'), false);
  graph.update(1);
  assert.deepEqual(observed, ['first', 'second']);
});


test('mining keeps Lua pre-state tags and enters idle while the post-animation still plays', () => {
  const { graph, played } = actor();
  graph.pushBufferedAction(new BufferedAction('MINE', () => {}));
  assert.equal(graph.hasStateTag('premine'), true);
  assert.equal(graph.hasStateTag('working'), true);
  assert.equal(graph.hasStateTag('mining'), false);
  assert.equal(graph.hasStateTag('oneshot'), false);
  // An event before actual animation completion must not advance the state.
  graph.pushEvent('animover');
  assert.equal(graph.stateName, 'mine_start');
  graph.update(9 * FRAMES);
  assert.equal(graph.stateName, 'mine');
  assert.equal(graph.hasStateTag('mining'), true);
  graph.update(20 * FRAMES);
  assert.equal(graph.stateName, 'idle');
  assert.equal(graph.hasStateTag('mining'), false);
  assert.equal(graph.hasStateTag('canrotate'), true);
  assert.equal(graph.animationClip.name, 'pickaxe_pst');
  graph.update(2 * FRAMES);
  assert.ok(Math.abs(graph.animationTime - 2 * FRAMES) < 1e-8);
  graph.update(3 * FRAMES);
  assert.equal(graph.animationClip.name, 'idle_loop');
  assert.deepEqual(played.slice(1), ['pickaxe_pre', 'pickaxe_loop', 'pickaxe_pst', 'idle_loop']);
});

test('short actions commit at frame 6 and time out at frame 10 without restarting their animation queue', () => {
  const { graph, played } = actor();
  let executed = 0;
  graph.pushBufferedAction(new BufferedAction('PLANT', () => { executed++; }));
  graph.update(6 * FRAMES);
  assert.equal(executed, 1);
  assert.equal(graph.stateName, 'doshortaction');
  assert.equal(graph.hasStateTag('busy'), false);
  graph.update(4 * FRAMES);
  assert.equal(graph.stateName, 'idle');
  assert.equal(graph.animationClip.name, 'pickup');
  assert.ok(Math.abs(graph.animationTime - 10 * FRAMES) < 1e-8);
  assert.deepEqual(played.slice(1), ['pickup']);
  graph.update(50 * FRAMES);
  assert.deepEqual(played.slice(1), ['pickup', 'pickup_pst', 'idle_loop']);
  assert.equal(executed, 1);
});

test('state callbacks receive entry data, run timeout before a simultaneous timeline, and update once after callbacks', () => {
  const observed = [];
  const graph = new StateGraphInstance({}, [{
    name: 'active',
    onenter: (inst, data) => { observed.push(['enter', data]); inst.setTimeout(0.2); },
    timeline: [TimeEvent(0.2, () => observed.push(['timeline']))],
    ontimeout: () => observed.push(['timeout']),
    onupdate: (inst, dt) => observed.push(['update', dt, inst.timeInState]),
    onexit: (_inst, nextState) => observed.push(['exit', nextState]),
  }, { name: 'done' }]);
  graph.goToState('active', { value: 7 });
  graph.update(0.3);
  graph.goToState('done');
  assert.deepEqual(observed, [
    ['enter', { value: 7 }], ['timeout'], ['timeline'], ['update', 0.3, 0.3], ['exit', 'done'],
  ]);
});

test('a timeout transition drops old callbacks and updates the next state with the remaining time', () => {
  const observed = [];
  const graph = new StateGraphInstance({}, [{
    name: 'first',
    onenter: (inst) => inst.setTimeout(0.2),
    ontimeout: (inst) => inst.goToState('second'),
    timeline: [TimeEvent(0.2, () => observed.push('stale timeline'))],
    onupdate: () => observed.push('stale update'),
    onexit: () => observed.push('exit'),
  }, {
    name: 'second',
    onupdate: (_inst, dt) => observed.push(dt),
  }]);
  graph.goToState('first');
  graph.update(0.3);
  assert.equal(observed[0], 'exit');
  assert.equal(observed.length, 2);
  assert.ok(Math.abs(observed[1] - 0.1) < 1e-8);
});


test('action handlers receive the incoming action, evaluate conditions, and support constant or rejected destinations', () => {
  const received = [];
  const context = { enabled: true };
  const graph = new StateGraphInstance(context, [
    { name: 'idle', tags: ['idle'] },
    { name: 'work', tags: ['working'] },
  ], [
    ActionHandler('STATIC', 'idle'),
    ActionHandler('DYNAMIC', (inst, action) => {
      received.push(action);
      return action.target?.hasTag('workable') ? 'work' : null;
    }, (inst) => inst.context.enabled),
  ]);
  graph.goToState('idle');
  const target = taggedObject('rock1', ['workable']);
  const action = new BufferedAction('DYNAMIC', () => {}, undefined, { target });
  assert.equal(graph.startAction(action), true);
  assert.equal(graph.stateName, 'work');
  assert.deepEqual(received, [action]);
  graph.update(0.3);
  graph.statemem.retained = 7;
  context.enabled = false;
  assert.equal(graph.startAction(action), false);
  assert.equal(received.length, 1); // A failed condition never calls the destination function.
  context.enabled = true;
  assert.equal(graph.startAction(new BufferedAction('DYNAMIC', () => {})), false);
  assert.equal(graph.startAction(new BufferedAction('UNKNOWN', () => {})), false);
  assert.equal(graph.stateName, 'work');
  assert.equal(graph.hasStateTag('working'), true);
  assert.equal(graph.timeInState, 0.3);
  assert.equal(graph.statemem.retained, 7);
  assert.equal(graph.startAction(new BufferedAction('STATIC', () => {})), true);
  assert.deepEqual(graph.statemem, {});
});

test('mining repeats from the loop after premine clears, preserving pending work when an early repeat is rejected', () => {
  const { graph, played } = actor();
  let hits = 0;
  const first = new BufferedAction('MINE', () => { hits++; });
  graph.pushBufferedAction(first);
  graph.update(9 * FRAMES);
  const repeat = new BufferedAction('MINE', () => { hits++; });
  assert.equal(graph.pushBufferedAction(repeat), false);
  assert.equal(graph.getBufferedAction(), first);
  graph.update(9 * FRAMES);
  assert.equal(hits, 1);
  assert.equal(graph.hasStateTag('premine'), false);
  assert.equal(graph.pushBufferedAction(repeat), true);
  assert.equal(graph.stateName, 'mine');
  assert.equal(played.filter(name => name === 'pickaxe_pre').length, 1);
  graph.update(7 * FRAMES);
  assert.equal(hits, 2);
  graph.update(10);
  assert.equal(hits, 2);
});

test('NET without a NET_tool object takes the source short-action path', () => {
  const { graph } = actor();
  let picked = 0;
  graph.pushBufferedAction(new BufferedAction('NET', () => { picked++; }));
  assert.equal(graph.stateName, 'doshortaction');
  graph.update(6 * FRAMES);
  assert.equal(picked, 1);
});

test('leaving a committed short action preserves its replacement buffered action', () => {
  const { graph } = actor();
  let planted = 0, cast = 0;
  graph.pushBufferedAction(new BufferedAction('PLANT', () => { planted++; }));
  graph.update(6 * FRAMES);
  assert.equal(planted, 1);
  const replacement = new BufferedAction('CASTSPELL', () => { cast++; }, undefined, { invobject: reskinTool });
  assert.equal(graph.pushBufferedAction(replacement), true);
  assert.equal(graph.getBufferedAction(), replacement);
  assert.equal(graph.stateName, 'veryquickcastspell');
  graph.update(9 * FRAMES);
  assert.equal(cast, 1);
});

test('emote admission uses source tags and cancels interrupted working actions', () => {
  const { graph } = actor();
  let mined = 0;
  graph.pushBufferedAction(new BufferedAction('MINE', () => { mined++; }));
  assert.equal(graph.canEmote(), true); // working/premine are not source emote blockers.
  graph.requestEmote(['wave'], false);
  assert.equal(graph.getBufferedAction(), null);
  assert.equal(graph.isPerformingAction('MINE'), false);
  assert.equal(graph.canEmote(), false);
  graph.update(.5);
  assert.equal(graph.canEmote(), true);
  graph.update(2);
  assert.equal(mined, 0);
  graph.requestMovement('jump');
  assert.equal(graph.pushBufferedAction(new BufferedAction('CASTSPELL', () => {})), false);
  assert.equal(graph.canEmote(), false);
});
