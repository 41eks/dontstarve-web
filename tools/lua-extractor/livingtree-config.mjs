import { readBankClips } from './anim-bin.mjs';
import { clipCatalog } from './clip-scan.mjs';
import { emitPrefabSignatures } from './stickhead-signatures.mjs';

const instance = 'LivingTreeInstance';
const finish = { setter: 'SetOnFinishCallback', x: -1 };
const tuning = ['LUNARHAIL_BUILDUP_DECAY_TICK_TIME', 'LUNARHAIL_BUILDUP_DECAY_RATE'];

export const livingTreeProfile = {
  file: 'prefabs/livingtree.lua',
  scenarios: [
    { name: 'client', master: false, seed: 42 },
    { name: 'master', master: true, seed: 42, tuning },
    {
      name: 'master-snow-buildup',
      master: true,
      seed: 43,
      offlineSkins: true,
      state: { issnowcovered: true },
      lunarHailWorkable: true,
    },
    {
      name: 'master-burnt',
      master: true,
      seed: 44,
      online: true,
      instanceCalls: [['OnLoad', { burnt: true }]],
      runTasks: [0.5],
      workCallbacks: [finish],
    },
    {
      name: 'master-stump',
      master: true,
      seed: 45,
      instanceCalls: [['OnLoad', { stump: true }]],
      workCallbacks: [finish],
    },
    {
      name: 'master-fall-right',
      master: true,
      seed: 46,
      workCallbacks: [{ setter: 'SetOnWorkCallback', tag: 'beaver', x: -1 }, finish],
      runWorkTasks: [0.4],
    },
    {
      name: 'master-fall-left',
      master: true,
      seed: 47,
      lunarHailWorkable: true,
      workCallbacks: [
        { setter: 'SetOnWorkCallback', tag: 'playerghost', x: 1 },
        { ...finish, x: 1 },
      ],
    },
    { name: 'master-hallowed-nights', master: true, seed: 48, specialEvent: 'hallowed_nights' },
  ],
  typeImports: [
    [instance, '../livingtree'],
    ['Worker', '../../../componets/src/workable'],
    ['EntityPersistData', '../saveRecord'],
  ],
};

const call = (recording, target, name) => recording.operations.filter(op => op.target === target && op.name === name);

function one(recording, target, name) {
  const operations = call(recording, target, name);
  if (operations.length !== 1) {
    throw new Error(`Expected one ${target}.${name} in ${recording.scenario.name}, found ${operations.length}`);
  }
  return operations[0].args;
}

/** Settings from standardcomponents.lua. Confirm all draws fit and continue to use the source preset at runtime. */
function propagator(recordings, preset, which, ranges, damageRange) {
  const draws = recordings.map(recording => {
    const read = name => call(recording, 'components.propagator', name).at(which)?.args[0];
    const random = Object.entries(ranges).map(([name, [min, max]]) => {
      const value = read(name);
      if (!Number.isFinite(value) || value < min || value > max) {
        throw new Error(`Unexpected ${preset} propagator ${name} in ${recording.scenario.name}`);
      }
      return value;
    });
    if (
      read('acceptsheat') !== true ||
      read('damages') !== true ||
      read('decayrate') !== 0.5 ||
      read('damagerange') !== damageRange
    ) {
      throw new Error(`Unexpected ${preset} propagator configuration in ${recording.scenario.name}`);
    }
    return JSON.stringify(random);
  });
  if (new Set(draws).size < 2) {
    throw new Error(`Expected distinct ${preset} propagator draws`);
  }
  return preset;
}

export function livingTreeConfig(snapshot) {
  const [client, master, snow, burnt, stump, fallRight, fallLeft, halloween] = snapshot.recordings;
  const [bank] = one(client, 'AnimState', 'SetBank');
  const [build] = one(client, 'AnimState', 'SetBuild');
  const [animation] = client.assets.filter(asset => asset.type === 'ANIM').map(asset => asset.path);
  const [initialClip, loop] = one(client, 'AnimState', 'PlayAnimation');
  if (
    animation !== `anim/${bank}.zip` ||
    bank !== build ||
    loop !== true ||
    call(client, 'Transform', 'SetFourFaced').length ||
    call(client, 'Transform', 'SetEightFaced').length
  ) {
    throw new Error('Unsupported livingtree art layout');
  }
  const bankClips = readBankClips(new URL(`../../public/dst/data/${animation}`, import.meta.url), bank);
  const clipSeconds = Object.fromEntries(
    [...bankClips].map(([name, { entries }]) => {
      const lengths = new Set(entries.map(({ frames, frameRate }) => frames / frameRate));
      const [seconds] = lengths;
      if (lengths.size !== 1 || !(seconds > 0) || !Number.isFinite(seconds)) {
        throw new Error(`Expected one positive duration for livingtree's ${name}`);
      }
      return [name, seconds];
    }),
  );
  const [snowSymbol, snowBuild, snowSource] = one(client, 'AnimState', 'OverrideSymbol');
  const snowLayer = one(client, 'AnimState', 'Hide')[0];
  const snowTag = client.operations.find(
    op => op.name === 'AddTag' && op.source.file === 'standardcomponents.lua' && op.args[0] !== 'blocker',
  ).args[0];
  const buildup = recording => call(recording, 'AnimState', 'OverrideSymbol').at(1).args[2];
  const tags = call(client, 'inst', 'AddTag').map(op => op.args[0]);
  const icon = recording => call(recording, 'MiniMapEntity', 'SetIcon').at(-1).args[0];
  const work = (recording, expectedAction, index = 0) => {
    const [{ name }] = call(recording, 'components.workable', 'SetWorkAction')[index].args;
    if (name !== `ACTIONS.${expectedAction}`) {
      throw new Error(`Unexpected livingtree work action ${name}`);
    }
    return { action: expectedAction, count: call(recording, 'components.workable', 'SetWorkLeft').at(index).args[0] };
  };
  const burnable = (recording, index) => {
    const [prefab, offset, follow] = call(recording, 'components.burnable', 'AddBurnFX')[index].args;
    if (prefab !== 'fire' || follow.kind !== 'nil' || [offset.x, offset.y, offset.z].some(axis => axis !== 0)) {
      throw new Error('Expected livingtree fire at the foot with no follow symbol');
    }
    return {
      prefab,
      offset,
      time: call(recording, 'components.burnable', 'SetBurnTime')[index].args[0],
      level: call(recording, 'components.burnable', 'SetFXLevel').at(index === 0 ? 0 : -1).args[0],
    };
  };
  const cooldown = recording => call(recording, 'components.hauntable', 'cooldown').at(-1).args[0];
  const [normalLoot] = one(master, 'components.lootdropper', 'SetLoot');
  const [chancePrefab, chance] = one(snow, 'components.lootdropper', 'AddChanceLoot');
  if (
    call(master, 'components.lootdropper', 'AddChanceLoot').length ||
    JSON.stringify(one(burnt, 'components.lootdropper', 'AddChanceLoot')) !== JSON.stringify([chancePrefab, chance])
  ) {
    throw new Error('Unexpected livingtree reskin-tool loot condition');
  }
  const [mode, duration, speed, scale, source, radius] = one(fallRight, 'global', 'ShakeAllCameras');
  if (mode !== 0 || source.entity !== fallRight.entity) {
    throw new Error('Expected full camera shake centered on the livingtree');
  }
  const delay = (recording, callback) =>
    call(recording, 'inst', 'DoTaskInTime').find(op => op.args[1]?.name === callback).args[0];
  const fx = call(fallRight, 'components.lootdropper', 'DropLoot').at(-1).args[0];
  const leftDrop = call(fallLeft, 'components.lootdropper', 'DropLoot').at(-1).args[0];
  if (!(fx.x > 0) || leftDrop.x !== -fx.x || fx.y !== 0 || fx.z !== 0 || leftDrop.y !== 0 || leftDrop.z !== 0) {
    throw new Error('Expected livingtree loot to fall on opposite sides along the camera right vector');
  }
  const [crumble, axe] = call(burnt, 'SoundEmitter', 'PlaySound').map(op => op.args[0]);
  const [beaver, hit, fall, die] = call(fallRight, 'SoundEmitter', 'PlaySound').map(op => op.args[0]);
  const [burntWork] = call(burnt, 'components.workable', 'SetWorkLeft').at(-1).args;
  const [radiusDST, height] = one(client, 'Physics', 'SetCapsule');
  return {
    prefab: snapshot.prefab,
    archive: animation.slice('anim/'.length),
    bank,
    build,
    initialClip,
    ...clipCatalog({ plays: snapshot.clipPlays, bankClips, facings: 1 }),
    clipSeconds,
    tags: tags.filter(tag => tag !== snowTag),
    snow: {
      tag: snowTag,
      symbol: snowSymbol,
      build: snowBuild,
      source: snowSource,
      layer: snowLayer,
      buildup: buildup(fallLeft),
      snowyBuildup: buildup(snow),
    },
    lunarHail: {
      work: one(master, 'components.lunarhailbuildup', 'SetTotalWorkAmount')[0],
      moonGlass: one(master, 'components.lunarhailbuildup', 'SetMoonGlassAmount')[0],
      decayPeriod: master.tuning.LUNARHAIL_BUILDUP_DECAY_TICK_TIME,
      decayRate: master.tuning.LUNARHAIL_BUILDUP_DECAY_RATE,
    },
    physics: { radius: radiusDST, height, deployRadius: one(client, 'inst', 'SetDeploySmartRadius')[0] },
    tree: {
      icon: icon(client),
      work: work(master, 'CHOP'),
      burnable: burnable(master, 0),
      finalFireLevel: call(master, 'components.burnable', 'SetFXLevel').at(-1).args[0],
      propagator: propagator(
        snapshot.recordings.slice(1),
        'medium',
        0,
        { flashpoint: [15, 25], propagaterange: [5, 7], heatoutput: [5, 8.5] },
        3,
      ),
      hauntCooldown: cooldown(master),
    },
    stump: {
      tag: call(stump, 'inst', 'AddTag').at(-1).args[0],
      icon: icon(stump),
      work: work(stump, 'DIG', 1),
      burnable: burnable(stump, 1),
      propagator: propagator(
        [stump, fallRight, fallLeft],
        'small',
        1,
        { flashpoint: [5, 10], propagaterange: [3, 5], heatoutput: [3, 5] },
        2,
      ),
      hauntCooldown: cooldown(stump),
      loot: one(stump, 'components.lootdropper', 'SpawnLootPrefab')[0],
    },
    burnt: {
      tag: call(burnt, 'inst', 'AddTag').at(-1).args[0],
      icon: icon(burnt),
      work: burntWork,
      loot: one(burnt, 'components.lootdropper', 'SpawnLootPrefab')[0],
      rayTestOnBB: one(burnt, 'AnimState', 'SetRayTestOnBB')[0],
      extinguishDelay: delay(burnt, 'Extinguish'),
      hauntCooldown: cooldown(burnt),
    },
    sounds: { crumble, axe, beaver, hit, fall, die },
    loot: { normal: normalLoot, chance: { prefab: chancePrefab, chance }, fallOffset: fx.x },
    shake: { delay: delay(fallRight, 'ShakeCamera'), duration, speed, scale, radius },
    halloween: { event: halloween.scenario.specialEvent, delay: delay(halloween, 'OnHalloweenSetup') },
  };
}

export function livingTreeSignatures(snapshot) {
  return emitPrefabSignatures([snapshot], {
    typeImports: livingTreeProfile.typeImports,
    staticContracts: new Map([
      ['Prefab', { parameters: [], returnType: instance }],
      ['DoTaskInTime', { parameters: [instance], returnType: 'void' }],
    ]),
    localContracts: { makestump: { parameters: [instance, 'boolean | undefined'], returnType: 'void' } },
    registrations: [
      {
        target: 'components.workable',
        name: 'SetOnWorkCallback',
        kind: 'call',
        parameters: [instance, 'Worker', 'number'],
        returnType: 'void',
      },
      {
        target: 'components.workable',
        name: 'SetOnFinishCallback',
        kind: 'call',
        parameters: [instance, 'Worker'],
        returnType: 'void',
      },
      { target: 'components.burnable', name: 'SetOnBurntFn', kind: 'call', parameters: [instance], returnType: 'void' },
      ...['OnSave', 'OnLoad'].map(name => ({
        target: 'inst',
        name,
        kind: 'write',
        parameters: [instance, 'EntityPersistData'],
        returnType: 'void',
      })),
    ],
  });
}
