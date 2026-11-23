import assert from 'node:assert/strict';
import test from 'node:test';

import { clipCatalog, scanClipPlays } from './clip-scan.mjs';

const source = [
  'local function _Play(inst, anim, loop)', // 1: a wrapper playing on the entity and its back
  '    inst.AnimState:PlayAnimation(anim, loop)',
  '    if inst.back then',
  '        inst.back.AnimState:PlayAnimation(anim, loop)',
  '    end',
  'end',
  'local function OnHit(inst)', // 7
  '    _Play(inst, "hit")',
  '    inst.AnimState:PushAnimation(inst.awake and "idle_awake" or "idle", false)',
  '    inst.AnimState:PlayAnimation("idle_"..inst.size, true)',
  'end',
].join('\n');

test('finds direct and wrapped plays, two-literal choices, computed clips and the loop each passes', () => {
  const plays = scanClipPlays(source, 'prefabs/test.lua').map(({ file: _file, ...play }) => play);
  assert.deepEqual(plays, [
    { clip: 'hit', kind: 'play', loop: 'omitted', target: 'inst', via: '_Play', line: 8, within: 'OnHit' },
    { clip: 'hit', kind: 'play', loop: 'omitted', target: 'inst.back', via: '_Play', line: 8, within: 'OnHit' },
    { clip: 'idle_awake', kind: 'push', loop: false, target: 'inst', line: 9, within: 'OnHit' },
    { clip: 'idle', kind: 'push', loop: false, target: 'inst', line: 9, within: 'OnHit' },
    { dynamic: '"idle_"..inst.size', kind: 'play', loop: true, target: 'inst', line: 10, within: 'OnHit' },
  ]);
});

test('catalogs the bank, lists clips it lacks and computed ones, and rejects a clip missing a needed facing', () => {
  const plays = scanClipPlays(source, 'prefabs/test.lua');
  const entry = (facing, frames) => ({ facing, frames, frameRate: 30 });
  const bankClips = new Map([
    ['hit', { facings: 0b1111, entries: [entry(0b0101, 9), entry(0b1000, 9), entry(0b0010, 9)] }],
    ['idle', { facings: 0b1111, entries: [entry(0b1111, 1)] }],
    ['unused', { facings: 0b0001, entries: [entry(0b0001, 2)] }],
  ]);
  assert.deepEqual(clipCatalog({ plays, bankClips, facings: 4 }), {
    clips: {
      hit: { name: 'hit', facings: ['right', 'up', 'left', 'down'], frames: 9 },
      idle: { name: 'idle', facings: ['right', 'up', 'left', 'down'], frames: 1 },
      unused: { name: 'unused', facings: ['right'], frames: 2 },
    },
    clipsNotInBank: { idle_awake: ['prefabs/test.lua:9 OnHit'] },
    dynamicClips: [{ expression: '"idle_"..inst.size', at: 'prefabs/test.lua:10 OnHit' }],
  });
  bankClips.set('hit', { facings: 0b0101, entries: [entry(0b0101, 9)] });
  assert.throws(
    () => clipCatalog({ plays, bankClips, facings: 4 }),
    /plays hit, which covers right, left but not up, down/,
  );
});

test('enumerates stategraph clip names built from world state and local helpers, by state', () => {
  const sg = [
    'local function Phase(anim)',
    '    return anim.."_"..TheWorld.state.moonphase',
    'end',
    'local states = {',
    '    State{',
    '        name = "idle",',
    '        onenter = function(inst)',
    '            inst.AnimState:PlayAnimation(Phase("idle"), true)',
    '        end,',
    '    },',
    '}',
    'CommonStates.AddIdle(states)',
  ].join('\n');
  const domains = { 'TheWorld.state.moonphase': ['new', 'full'] };
  const plays = scanClipPlays(sg, 'stategraphs/SGtest.lua', undefined, { domains }).map(
    ({ file: _file, ...play }) => play,
  );
  assert.deepEqual(plays, [
    { clip: 'idle_new', kind: 'play', loop: true, target: 'inst', line: 8, within: 'idle.onenter' },
    { clip: 'idle_full', kind: 'play', loop: true, target: 'inst', line: 8, within: 'idle.onenter' },
    {
      dynamic: 'CommonStates.AddIdle',
      kind: 'commonstates',
      loop: 'dynamic',
      target: 'inst',
      line: 12,
      within: 'main chunk',
    },
  ]);
});

test('expands CommonStates builders with the arguments a stategraph passes', () => {
  const commonstates = [
    'local function onentersleeping(inst)', // 1: referenced by a state, not called with a clip
    '    inst.AnimState:PlayAnimation("sleep_loop")',
    'end',
    'local function get_anim(override, default)',
    '    return (override == nil and default) or (type(override) ~= "function" and override) or override()',
    'end',
    'CommonStates.AddHitState = function(states, anim)', // 7
    '    local hitanim = (anim == nil and "hit") or (type(anim) ~= "function" and anim) or anim(inst)',
    '    table.insert(states, State{ name = "hit", onenter = function(inst)',
    '        inst.AnimState:PlayAnimation(hitanim)',
    '    end })',
    'end',
    'CommonStates.AddWalkStates = function(states, anims)', // 13
    '    table.insert(states, State{ name = "walk", onenter = function(inst)',
    '        inst.AnimState:PlayAnimation(get_anim(anims ~= nil and anims.walk or nil, "walk_loop"), true)',
    '    end })',
    '    table.insert(states, State{ name = "sleeping", onenter = onentersleeping })',
    '    CommonStates.AddHitState(states)',
    'end',
  ].join('\n');
  const sg = [
    'local states = {}',
    'CommonStates.AddHitState(states, "hurt")',
    'CommonStates.AddHitState(states, function(inst) return "x" end)',
    'CommonStates.AddWalkStates(states, { walk = "stroll" })',
    'CommonStates.AddWalkStates(states)',
  ].join('\n');
  const readSource = path => {
    assert.equal(path, 'stategraphs/commonstates.lua');
    return commonstates;
  };
  const plays = scanClipPlays(sg, 'stategraphs/SGtest.lua', undefined, { readSource }).map(
    ({ clip, dynamic, loop, via, source, line }) => [line, clip ?? `dynamic ${dynamic}`, loop, via, source],
  );
  assert.deepEqual(plays, [
    [2, 'hurt', 'omitted', 'CommonStates.AddHitState', 'stategraphs/commonstates.lua:10'],
    // A function override names no clip; the nil and string branches are ruled out by its type.
    [3, 'dynamic hitanim', 'omitted', 'CommonStates.AddHitState', 'stategraphs/commonstates.lua:10'],
    [4, 'stroll', true, 'CommonStates.AddWalkStates', 'stategraphs/commonstates.lua:15'],
    [4, 'sleep_loop', 'omitted', 'CommonStates.AddWalkStates', 'stategraphs/commonstates.lua:2'],
    [4, 'hit', 'omitted', 'CommonStates.AddHitState', 'stategraphs/commonstates.lua:10'],
    [5, 'walk_loop', true, 'CommonStates.AddWalkStates', 'stategraphs/commonstates.lua:15'],
    [5, 'sleep_loop', 'omitted', 'CommonStates.AddWalkStates', 'stategraphs/commonstates.lua:2'],
    [5, 'hit', 'omitted', 'CommonStates.AddHitState', 'stategraphs/commonstates.lua:10'],
  ]);
});
