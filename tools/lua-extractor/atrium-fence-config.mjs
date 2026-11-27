import { readBankClips } from './anim-bin.mjs';
import { clipCatalog } from './clip-scan.mjs';
import { parseLuaSource } from './lua-source.mjs';
import { emitPrefabSignatures } from './stickhead-signatures.mjs';

function shapeIds(source) {
  const { body } = parseLuaSource(source).find(node => node.type === 'Chunk');
  const declaration = body.find(node => node.type === 'LocalStatement' && node.variables[0]?.name === 'NUM_SHAPES');
  const limit = declaration?.init[0];
  if (limit?.type !== 'NumericLiteral' || !Number.isInteger(limit.value) || limit.value < 1) {
    throw new Error('Expected a positive NUM_SHAPES for atrium_fence');
  }
  return Array.from({ length: limit.value }, (_, index) => index + 1);
}

const instance = 'AtriumFenceInstance';
const step = (distanceSq, runTask = false) => ({ distanceSq, runTask });
const power = (value, runTask = false) => ({ ...step(0, runTask), event: ['atriumpowered', value] });

export const atriumFenceProfile = {
  file: 'prefabs/atrium_fence.lua',
  scenarios: [
    { name: 'client', master: false, seed: 42 },
    {
      name: 'master-proximity',
      master: true,
      seed: 42,
      proximitySteps: [step(0), step(100, true), power(true), power(false, true)],
    },
    {
      name: 'master-locked',
      master: true,
      seed: 43,
      instanceCalls: [['OnLoad', { fenceid: 5 }]],
      proximitySteps: [power(true, true), step(0), power(false, true)],
    },
    { name: 'master', master: true, seed: 44 },
  ],
  clipDomains: source => ({ 'tostring(inst.fenceid)': shapeIds(source).map(String) }),
  typeImports: [
    [instance, '../atrium_fence'],
    ['EntityPersistData', '../saveRecord'],
  ],
};

const calls = (recording, target, name) =>
  recording.operations.filter(operation => operation.target === target && operation.name === name);

function one(recording, target, name) {
  const matched = calls(recording, target, name);
  if (matched.length !== 1) {
    throw new Error(`Expected one ${target}.${name} in ${recording.scenario.name}, found ${matched.length}`);
  }
  return matched[0].args;
}

export function atriumFenceConfig(snapshot) {
  const [client, proximity, locked] = snapshot.recordings;
  const [bank] = one(client, 'AnimState', 'SetBank');
  const [build] = one(client, 'AnimState', 'SetBuild');
  const [animation] = client.assets.filter(asset => asset.type === 'ANIM').map(asset => asset.path);
  const [initialClip, loop] = one(client, 'AnimState', 'PlayAnimation');
  if (animation !== `anim/${bank}.zip` || bank !== build || loop !== undefined) {
    throw new Error('Unexpected atrium_fence art layout or initial animation');
  }
  const facings = calls(client, 'Transform', 'SetEightFaced').length
    ? 8
    : calls(client, 'Transform', 'SetFourFaced').length
      ? 4
      : 1;
  const plays = snapshot.clipPlays;
  const bankClips = readBankClips(new URL(`../../public/dst/data/${animation}`, import.meta.url), bank);
  const catalog = clipCatalog({ plays, bankClips, facings });
  const at = (within, kind) => plays.filter(play => play.within === within && play.kind === kind);
  const distinct = values => [...new Set(values)];
  const grows = at('transitionclosed', 'play');
  const shape = grows.map(({ clip }) => Number(clip?.match(/^grow([1-9]\d*)$/)?.[1]));
  if (!shape.length || !shape.every(Number.isInteger) || catalog.dynamicClips.length) {
    throw new Error('Expected statically enumerable atrium_fence shapes');
  }
  shape.sort((a, b) => a - b);
  const [min] = shape;
  const max = shape.at(-1);
  if (min !== 1 || shape.length !== max) {
    throw new Error('Expected consecutive atrium_fence shape IDs starting at one');
  }
  const [period] = one(proximity, 'inst', 'DoPeriodicTask');
  const shapeDraws = [],
    phaseDraws = [];
  for (const recording of snapshot.recordings.filter(recording => recording.scenario.master)) {
    const [fenceid] = calls(recording, 'inst', 'fenceid')[0].args;
    const [interval, , phase] = one(recording, 'inst', 'DoPeriodicTask');
    if (!shape.includes(fenceid) || interval !== period || !(phase >= 0 && phase < period)) {
      throw new Error(`Random atrium_fence draw outside the Lua preset in ${recording.scenario.name}`);
    }
    for (const {
      args: [delay],
    } of calls(recording, 'inst', 'DoTaskInTime')) {
      if (!(delay >= 0 && delay < 1)) {
        throw new Error(`Unexpected atrium_fence transition delay in ${recording.scenario.name}`);
      }
    }
    shapeDraws.push(fenceid);
    phaseDraws.push(phase);
  }
  if (distinct(shapeDraws).length < 2 || distinct(phaseDraws).length < 2) {
    throw new Error('Expected distinct atrium_fence constructor draws');
  }

  const choose = (within, kind, name, loop) => {
    const matched = at(within, kind).some(played => played.clip === name && played.loop === loop);
    if (!matched) {
      throw new Error(`Expected atrium_fence ${within} to ${kind} ${name} with loop=${loop}`);
    }
    return name;
  };
  const mask = calls(proximity, 'Physics', 'SetCollisionMask');
  const [group] = calls(client, 'Physics', 'SetCollisionGroup').at(-1).args;
  if (calls(proximity, 'Physics', 'SetCollisionGroup').some(({ args }) => args[0] !== group)) {
    throw new Error('Unexpected atrium_fence collision group');
  }
  const [radius, height] = one(client, 'Physics', 'SetCapsule');
  const [nearSq, farSq] = distinct(calls(proximity, 'global', 'IsAnyPlayerInRangeSq').map(({ args }) => args[3])).sort(
    (a, b) => a - b,
  );
  if (!(nearSq > 0 && farSq > nearSq) || mask.length !== 4 || mask[1].args.join() !== mask[3].args.join()) {
    throw new Error('Unexpected atrium_fence range or collision declarations');
  }
  const sounds = calls(proximity, 'SoundEmitter', 'PlaySound');
  if (
    sounds.length !== 2 ||
    calls(locked, 'SoundEmitter', 'PlaySound')
      .map(op => op.args[0])
      .join() !== sounds.map(op => op.args[0]).join()
  ) {
    throw new Error('Expected both atrium_fence transition sounds');
  }
  return {
    prefab: snapshot.prefab,
    archive: animation.slice('anim/'.length),
    bank,
    facings,
    initialClip,
    tags: calls(client, 'inst', 'AddTag').map(operation => operation.args[0]),
    physics: { radius, height, group, openMask: mask[1].args, closedMask: mask[2].args },
    proximity: { nearSq, farSq, period, initialDelay: { min: 0, maxExclusive: period } },
    transitionDelay: { min: 0, maxExclusive: 1 },
    shapeId: { min, max },
    shapes: shape.map(id => ({
      grow: choose('transitionclosed', 'play', `grow${id}`, 'omitted'),
      idle: choose('transitionclosed', 'push', `idle${id}`, false),
      active: choose('transitionclosed', 'push', `idle${id}_active`, false),
      shrink: choose('transitionopened', 'play', `shrink${id}`, 'omitted'),
    })),
    opened: choose('transitionopened', 'push', initialClip, false),
    sounds: { close: sounds[0].args[0], open: sounds[1].args[0] },
    ...catalog,
  };
}

const entityCallback = { parameters: [instance], returnType: 'void' };
const persistCallback = { parameters: [instance, 'EntityPersistData'], returnType: 'void' };

export function atriumFenceSignatures(snapshot) {
  return emitPrefabSignatures([snapshot], {
    typeImports: atriumFenceProfile.typeImports,
    registrations: [...['OnSave', 'OnLoad'].map(name => ({ target: 'inst', name, kind: 'write', ...persistCallback }))],
    staticContracts: new Map([
      ['Prefab', { parameters: [], returnType: instance }],
      ['DoTaskInTime', entityCallback],
    ]),
    localContracts: {
      setclosedphysics: entityCallback,
      setopenedphysics: entityCallback,
      setclosed: entityCallback,
      setopened: entityCallback,
      onupdate: entityCallback,
      OnPoweredFn: { parameters: [instance, 'boolean'], returnType: 'void' },
    },
  });
}
