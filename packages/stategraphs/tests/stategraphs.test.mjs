import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BufferedAction, FRAMES, StateGraphInstance, TimeEvent, WilsonStateGraph } from '../src/index.ts';

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

for (const [action, commitFrame] of [
  ['MINE', 16], ['CASTSPELL', 53], ['RESKIN', 9],
]) {
  test(`${action} commits once at its source frame, including the correct pre-animation clock`, () => {
    const { graph } = actor();
    const events = [];
    let executed = 0;
    graph.listenForEvent('performaction', ({ action: buffered }) => {
      events.push(buffered.action);
      assert.equal(executed, 0); // Lua's notification is before execution.
    });
    assert.equal(graph.pushBufferedAction(new BufferedAction(action, () => { executed++; })), true);
    assert.equal(graph.isPerformingAction(action), true);
    assert.equal(graph.pushBufferedAction(new BufferedAction(action, () => { executed++; })), false);
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

  if (action === 'RESKIN') for (const reason of ['unequip', 'cancel']) {
    test(`${action} discards uncommitted work on ${reason}`, () => {
      const { graph } = actor();
      let executed = 0;
      const failures = [];
      graph.listenForEvent('actionfailed', ({ action }) => failures.push(action.action));
      graph.pushBufferedAction(new BufferedAction(action, () => { executed++; }));
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

test('cast sound precedes commitment and its light stops on exit or interruption', () => {
  const { graph, sounds, casting } = actor();
  graph.pushBufferedAction(new BufferedAction('CASTSPELL', () => {}));
  assert.deepEqual(casting, [true]);
  graph.update(12 * FRAMES);
  assert.deepEqual(sounds, []);
  graph.update(FRAMES);
  assert.deepEqual(sounds, ['cast']);
  graph.update(100 * FRAMES);
  assert.deepEqual(casting, [true, false]);
  graph.pushBufferedAction(new BufferedAction('CASTSPELL', () => {}));
  graph.update(12 * FRAMES);
  graph.cancelAction();
  graph.update(10);
  assert.deepEqual(sounds, ['cast']);
  assert.deepEqual(casting, [true, false, true, false]);
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
  graph.pushBufferedAction(new BufferedAction('NET', () => { executed++; }, () => valid));
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
    graph.pushBufferedAction(new BufferedAction('RESKIN', () => { casts++; }));
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
  graph.playOneShot('pickup');
  graph.start('run');
  graph.update(1.99);
  assert.equal(graph.stateName, 'pickup');
  graph.update(0.01);
  assert.equal(graph.stateName, 'run');
  graph.setCrafting(true);
  assert.equal(graph.pushBufferedAction(new BufferedAction('MINE', () => {})), false);
  graph.playOneShot('item_out');
  graph.update(1);
  assert.equal(graph.stateName, 'build');
  graph.setCrafting(false);
  assert.equal(graph.stateName, 'run');
  graph.start('jump');
  assert.equal(graph.pushBufferedAction(new BufferedAction('TERRAFORM', () => {})), false);
});

test('emote queues emit each animation completion and loop only their final clip', () => {
  const { graph, played } = actor();
  const events = [];
  graph.listenForEvent('animover', () => events.push('animover'));
  graph.listenForEvent('animqueueover', () => events.push('animqueueover'));
  graph.playEmote(['emote_pre', 'emote_loop'], true);
  graph.update(3.2);
  assert.deepEqual(played.slice(1), ['emote_pre', 'emote_loop', 'emote_loop', 'emote_loop']);
  assert.deepEqual(events, ['animover', 'animover', 'animover']);
  assert.ok(Math.abs(graph.animationTime - 0.2) < 1e-8);
  graph.start('walk');
  assert.equal(graph.stateName, 'walk');
  graph.playEmote(['wave_pre', 'wave'], false);
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
