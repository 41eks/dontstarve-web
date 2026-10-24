import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActionHandler, BufferedAction, FRAMES, StateGraphInstance, TimeEvent, WilsonStateGraph } from '../src/index.ts';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler.ts';

test('scheduler-backed state timers stay discrete, prioritize timeout and cancel on exit or disposal', () => {
  const scheduler = new GameTimeScheduler(), events = [];
  const graph = new StateGraphInstance({}, [
    { name: 'active',
      onenter: sg => sg.setTimeout(.4),
      timeline: [
        TimeEvent(.2, sg => events.push(['timeline', sg.timeInState])),
        TimeEvent(.4, () => events.push(['obsolete'])),
      ],
      ontimeout: sg => { events.push(['timeout', sg.timeInState]); sg.goToState('stopped'); },
    },
    { name: 'stopped' },
  ], [], scheduler);
  graph.goToState('active');
  const waiting = graph.timeoutSnapshot.peek();
  scheduler.advanceTo(.39);
  assert.equal(graph.timeoutSnapshot.peek(), waiting);
  assert.deepEqual(events, [['timeline', .2]]);
  scheduler.advanceTo(.4);
  assert.deepEqual(events, [['timeline', .2], ['timeout', .4]]);
  assert.equal(graph.stateName, 'stopped');
  assert.deepEqual(graph.timeoutSnapshot.peek(), { status: 'stopped' });
  graph.goToState('active');
  scheduler.advance(.1);
  graph.goToState('stopped');
  scheduler.advance(1);
  assert.equal(events.length, 2);
  graph.goToState('active');
  graph.schedule(.1, () => events.push(['engine']));
  graph.dispose();
  scheduler.advance(1);
  assert.equal(events.length, 2);
  assert.deepEqual(graph.timelineSnapshot.peek(), { status: 'stopped' });
});

function taggedObject(prefab, tags = []) {
  return { prefab, hasTag: tag => tags.includes(tag) };
}
const reskinTool = taggedObject('reskin_tool', ['veryquickcast']);
const bugnet = taggedObject('bugnet', ['NET_tool']);

function actor() {
  const played = [], sounds = [], casting = [], stopped = [];
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
    stopSound: (cue) => stopped.push(cue),
    setCasting: (value) => casting.push(value),
    onStateChanged() {},
  });
  return { graph, played, sounds, casting, stopped };
}

test('HARVEST commits at the one-second long-action timeout and cancellation preserves the product', () => {
  const { graph, played, sounds, stopped } = actor();
  let harvested = 0;
  const action = new BufferedAction('HARVEST', () => { harvested++; });
  assert.equal(graph.pushBufferedAction(action), true);
  assert.equal(graph.stateName, 'dolongaction');
  assert.equal(graph.hasStateTag('doing'), true);
  assert.equal(graph.hasStateTag('nodangle'), true);
  assert.equal(graph.hasStateTag('busy'), true);
  assert.deepEqual(sounds, ['make']);
  graph.update(4 * FRAMES);
  assert.equal(graph.hasStateTag('busy'), false);
  graph.update(.99 - 4 * FRAMES);
  assert.equal(harvested, 0);
  graph.update(.01);
  assert.equal(harvested, 1);
  assert.equal(played.at(-1), 'build_pst');
  assert.deepEqual(stopped, ['make']);
  graph.update(2);
  assert.equal(graph.stateName, 'idle');
  assert.equal(harvested, 1);
  graph.pushBufferedAction(new BufferedAction('HARVEST', () => { harvested++; }));
  graph.update(.5);
  graph.cancelAction('HARVEST');
  assert.deepEqual(stopped, ['make', 'make', 'make']);
  graph.update(2);
  assert.equal(harvested, 1);
  assert.equal(graph.getBufferedAction(), null);
});

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

test('turf DEPLOY commits at frame 6 and times out at frame 10 without restarting its animation queue', () => {
  const { graph, played } = actor();
  let executed = 0;
  graph.pushBufferedAction(new BufferedAction('DEPLOY', () => { executed++; }));
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

test('PICK chooses dolongaction or doshortaction from the pickable quickpick field', () => {
  const { graph } = actor();
  let picked = 0;
  const slow = new BufferedAction('PICK', () => { picked++; }, undefined, { target: taggedObject('flower_cave') });
  assert.equal(graph.pushBufferedAction(slow), true);
  assert.equal(graph.stateName, 'dolongaction');
  graph.cancelAction('PICK');
  const quick = new BufferedAction('PICK', () => { picked++; }, undefined,
    { target: { ...taggedObject('flower'), quickpick: true } });
  assert.equal(graph.pushBufferedAction(quick), true);
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

function readingActor() {
  const log = [];
  const fx = [];
  const frames = { action_uniqueitem_pre: 8, book: 81 };
  let layerPlaying = false;
  const graph = new WilsonStateGraph({
    playAnimation: (clip) => { log.push(`anim:${clip.name}`); return (frames[clip.key] ?? 30) * FRAMES; },
    playSound: (cue, event) => log.push(`sound:${event ?? cue}`),
    playNamedSound: (_name, event) => { layerPlaying = true; log.push(`layer:${event}`); },
    isPlayingNamedSound: () => layerPlaying,
    setNamedSoundVolume: (_name, volume) => log.push(`volume:${volume}`),
    spawnFx: (prefab, follow) => {
      const inst = { prefab, follow, valid: true, detached: false, events: [],
        isValid() { return this.valid; }, remove() { this.valid = false; },
        detach() { this.detached = true; }, pushEvent(name) { this.events.push(name); } };
      fx.push(inst);
      return inst;
    },
    overrideSymbol: (symbol, build, source) => log.push(`symbol:${symbol}=${build}.${source}`),
    setCasting() {},
    onStateChanged() {},
  });
  const book = {
    prefab: 'book_silviculture', swap_build: 'swap_books', swap_prefix: 'book_silviculture',
    def: { fx_under_prefab: 'fx_roots_under_book', layer_sound: { frame: 17, sound: 'silviculture' } },
    hasTag: tag => tag === 'book',
  };
  return { graph, log, fx, book };
}

test('READ plays book then book2, commits at frame 50 and detaches book_fx before restoring symbols', () => {
  const { graph, log, fx, book } = readingActor();
  let reads = 0;
  assert.equal(graph.pushBufferedAction(new BufferedAction('READ', () => { reads++; return true; }, undefined, { invobject: book })), true);
  assert.equal(graph.stateName, 'book');
  assert.deepEqual(fx.map(({ prefab }) => prefab), ['book_fx']);
  graph.update(8 * FRAMES);
  assert.equal(graph.stateName, 'book2');
  assert.deepEqual(fx.map(({ prefab, follow }) => [prefab, follow]),
    [['book_fx', undefined], ['fx_roots_under_book', 'swap_book_fx_under']]);
  graph.update(49 * FRAMES);
  assert.equal(reads, 0);
  assert.equal(graph.hasStateTag('busy'), true);
  graph.update(FRAMES);
  assert.equal(reads, 1);
  assert.equal(graph.hasStateTag('busy'), false);
  assert.equal(fx[0].detached, true);
  graph.update(31 * FRAMES);
  assert.equal(graph.stateName, 'idle');
  assert.deepEqual(log.filter(entry => !entry.startsWith('anim:')), [
    'symbol:book_open=swap_books.book_silviculture_open', 'symbol:book_closed=swap_books.book_silviculture_closed',
    'layer:silviculture', 'sound:bookLight', 'sound:dontstarve/common/book_spell', 'sound:bookClose',
    'symbol:book_open=player_actions_uniqueitem.book_open', 'symbol:book_closed=player_actions_uniqueitem.book_closed',
    'volume:0.5',
  ]);
  // The detached book_fx outlives the state; the follower roots are removed with it.
  assert.deepEqual(fx.map(inst => inst.isValid()), [true, false]);
});

test('a failed READ plays fail_fx, and an interrupt before the layer sound cancels it', () => {
  const failed = readingActor();
  failed.graph.pushBufferedAction(new BufferedAction('READ', () => false, undefined, { invobject: failed.book }));
  failed.graph.update(58 * FRAMES);
  assert.deepEqual(failed.fx[0].events, ['fail_fx']);

  const interrupted = readingActor();
  interrupted.graph.pushBufferedAction(new BufferedAction('READ', () => true, undefined, { invobject: interrupted.book }));
  interrupted.graph.update(12 * FRAMES);
  interrupted.graph.cancelAction('READ');
  interrupted.graph.update(30 * FRAMES);
  assert.equal(interrupted.graph.stateName, 'idle');
  assert.equal(interrupted.log.some(entry => entry.startsWith('layer:') || entry.startsWith('volume:')), false);
  assert.deepEqual(interrupted.fx.map(inst => inst.isValid()), [false, false]);
});

test('toolbroke interrupts work, plays the break feedback and re-equips the same tool on exit', () => {
  const { graph, played, sounds } = actor();
  const spawned = [], equipped = [];
  graph.host.spawnFx = prefab => { spawned.push(prefab); };
  graph.host.equipSamePrefab = prefab => { equipped.push(prefab); return true; };
  let netted = 0;
  graph.pushBufferedAction(new BufferedAction('NET', () => { netted++; }, () => true, { invobject: bugnet }));
  graph.update(2 * FRAMES);
  graph.pushEvent('toolbroke', { tool: { prefab: 'bugnet' } });
  assert.equal(graph.stateName, 'toolbroke');
  assert.equal(played.at(-1), 'hit');
  assert.deepEqual(sounds.at(-1), 'useBreak');
  assert.deepEqual(spawned, ['brokentool']);
  assert.equal(graph.hasStateTag('busy'), true);
  graph.update(30 * FRAMES);
  assert.equal(netted, 0);
  assert.equal(graph.stateName, 'idle');
  assert.deepEqual(equipped, ['bugnet']);

  graph.pushEvent('toolbroke', { tool: { prefab: 'axe', nobrokentoolfx: true } });
  assert.deepEqual(spawned, ['brokentool']);
});
