import { readBankClips } from './anim-bin.mjs';
import { clipCatalog } from './clip-scan.mjs';
import { emitPrefabSignatures } from './stickhead-signatures.mjs';

const instance = 'RockAvocadoBushInstance';

/**
 * prefabs/rock_avocado_bush.lua rock_avocado_bush(). The fn draws the stage from math.random(1, 4) and MakeMediumBurnable
 * / MakeMediumPropagator draw their own values, so two MasterSim seeds expose those. The tuning rows give the four
 * regrow stage times; the clips are read from the bank's anim.bin. MakeWaxablePlant's waxable and the lunar hail buildup
 * are recorded but not ported.
 */
export const rockAvocadoBushProfile = {
  file: 'prefabs/rock_avocado_bush.lua',
  scenarios: [
    { name: 'client', master: false, seed: 42 },
    {
      name: 'master',
      master: true,
      seed: 42,
      tuning: ['ROCK_FRUIT_REGROW', 'ROCK_FRUIT_PICKABLE_CYCLES'],
    },
    {
      name: 'master-seed-43',
      master: true,
      seed: 43,
      tuning: ['ROCK_FRUIT_REGROW', 'ROCK_FRUIT_PICKABLE_CYCLES'],
    },
  ],
  typeImports: [
    [instance, '../rock_avocado_bush'],
    ['EntityPersistData', '../saveRecord'],
  ],
};

function ops(recording, entity, target, name, kind = 'call') {
  return recording.operations.filter(
    operation =>
      operation.entity === entity && operation.kind === kind && operation.target === target && operation.name === name,
  );
}

function args(recording, entity, target, name, kind = 'call') {
  const calls = ops(recording, entity, target, name, kind);
  if (calls.length !== 1) {
    throw new Error(
      `Expected one ${target}.${name} on entity ${entity} in ${recording.scenario.name}, found ${calls.length}`,
    );
  }
  return calls[0].args;
}

/** MakeMediumPropagator: flashpoint 15 + random()*10, range 5 + random()*2, heat 5 + random()*3.5. */
function mediumPropagator(recordings) {
  const draws = recordings.map(recording => {
    const write = name => args(recording, recording.entity, 'components.propagator', name, 'write')[0];
    const draw = {
      flashpoint: write('flashpoint'),
      propagaterange: write('propagaterange'),
      heatoutput: write('heatoutput'),
    };
    const fixed = ['acceptsheat', 'decayrate', 'damagerange', 'damages'].map(name => write(name));
    const inRange = (value, low, width) => value >= low && value <= low + width;
    if (
      JSON.stringify(fixed) !== JSON.stringify([true, 0.5, 3, true]) ||
      !inRange(draw.flashpoint, 15, 10) ||
      !inRange(draw.propagaterange, 5, 2) ||
      !inRange(draw.heatoutput, 5, 3.5)
    ) {
      throw new Error(`Expected MakeMediumPropagator in ${recording.scenario.name}`);
    }
    return draw;
  });
  if (JSON.stringify(draws[0]) === JSON.stringify(draws[1])) {
    throw new Error('Expected the two MasterSim seeds to draw different propagator values');
  }
  return 'medium';
}

export function rockAvocadoBushConfig(snapshot) {
  const [client, master, otherSeed] = snapshot.recordings;
  const [bank] = args(client, client.entity, 'AnimState', 'SetBank');
  const [build] = args(client, client.entity, 'AnimState', 'SetBuild');
  const [initialClip] = args(client, client.entity, 'AnimState', 'PlayAnimation');
  const archives = client.assets.filter(asset => asset.type === 'ANIM').map(asset => asset.path);
  const [diseased] = client.assets.filter(asset => asset.type === 'PKGREF').map(asset => asset.path);
  const [animation] = archives;
  const [buildArchive] = archives.slice(1);
  if (
    archives.length !== 2 ||
    animation !== `anim/${bank}.zip` ||
    buildArchive !== `anim/${build}.zip` ||
    ops(client, client.entity, 'Transform', 'SetFourFaced').length ||
    ops(client, client.entity, 'Transform', 'SetEightFaced').length
  ) {
    throw new Error('Unsupported rock_avocado_bush art layout');
  }
  const tags = ops(client, client.entity, 'inst', 'AddTag')
    .filter(operation => operation.source.file === snapshot.file)
    .map(operation => operation.args[0]);
  const [radius] = args(client, client.entity, 'Physics', 'SetCapsule');
  const [deployRadius] = args(client, client.entity, 'inst', 'SetDeploySmartRadius');
  const [icon] = args(client, client.entity, 'MiniMapEntity', 'SetIcon');
  const [snowSymbol, snowBuild, snowSource] = args(client, client.entity, 'AnimState', 'OverrideSymbol');
  const [snowLayer] = args(client, client.entity, 'AnimState', 'Hide');
  const snowTag = client.operations.find(
    op => op.name === 'AddTag' && op.source.file === 'standardcomponents.lua' && op.args[0] !== 'blocker',
  ).args[0];
  const [fxLevel] = args(master, master.entity, 'components.burnable', 'SetFXLevel');
  const [burnTime] = args(master, master.entity, 'components.burnable', 'SetBurnTime');
  const [numToHarvest] = args(master, master.entity, 'components.pickable', 'numtoharvest', 'write');
  const [maxCycles] = args(master, master.entity, 'components.pickable', 'max_cycles', 'write');
  const [lastStage] = args(master, master.entity, 'components.simplemagicgrower', 'SetLastStage');
  const [work] = args(master, master.entity, 'components.lunarhailbuildup', 'SetTotalWorkAmount');
  const [moonGlass] = args(master, master.entity, 'components.lunarhailbuildup', 'SetMoonGlassAmount');
  const [pickCycles] = [master.tuning.ROCK_FRUIT_PICKABLE_CYCLES];
  if (maxCycles !== pickCycles || maxCycles !== 3 || numToHarvest !== 3) {
    throw new Error('Unsupported rock_avocado_bush pickable configuration');
  }
  const stages = ['EMPTY', 'PREPICK', 'PICK', 'CRUMBLE'].map(name => {
    const { BASE, VAR } = master.tuning.ROCK_FRUIT_REGROW[name];
    if (!Number.isFinite(BASE) || !Number.isFinite(VAR) || VAR !== 60) {
      throw new Error(`Unexpected rock_avocado_bush ${name} regrow tuning`);
    }
    return { base: BASE, var: VAR };
  });
  if (
    JSON.stringify(stages) !==
    JSON.stringify([
      { base: 600, var: 60 },
      { base: 180, var: 60 },
      { base: 900, var: 60 },
      { base: 300, var: 60 },
    ])
  ) {
    throw new Error('Unexpected rock_avocado_bush regrow stages');
  }
  const bankClips = readBankClips(new URL(`../../public/dst/data/${animation}`, import.meta.url), bank);
  return {
    prefab: snapshot.prefab,
    archive: animation.slice('anim/'.length),
    buildArchive: buildArchive.slice('anim/'.length),
    diseasedBuild: diseased.slice('anim/'.length),
    bank,
    build,
    initialClip,
    facings: 1,
    ...clipCatalog({ plays: snapshot.clipPlays, bankClips, facings: 1 }),
    tags,
    physics: { radius },
    deployRadius,
    minimapIcon: icon,
    stages,
    pickable: { numToHarvest, maxCycles },
    burnable: { fxLevel, burnTime },
    propagator: mediumPropagator([master, otherSeed]),
    snow: { tag: snowTag, symbol: snowSymbol, build: snowBuild, source: snowSource, layer: snowLayer },
    lunarHail: { work, moonGlass },
    grower: { lastStage },
  };
}

export function rockAvocadoBushSignatures(snapshot) {
  return emitPrefabSignatures([snapshot], {
    typeImports: rockAvocadoBushProfile.typeImports,
    staticContracts: new Map([['Prefab', { parameters: [], returnType: instance }]]),
    localContracts: {
      play_idle: { parameters: [instance, 'number'], returnType: 'void' },
      play_grow: { parameters: [instance, 'number'], returnType: 'void' },
      set_stage1: { parameters: [instance], returnType: 'void' },
      set_stage2: { parameters: [instance], returnType: 'void' },
      set_stage3: { parameters: [instance], returnType: 'void' },
      set_stage4: { parameters: [instance], returnType: 'void' },
      grow_to_stage1: { parameters: [instance], returnType: 'void' },
      grow_to_stage2: { parameters: [instance], returnType: 'void' },
      grow_to_stage3: { parameters: [instance], returnType: 'void' },
      grow_to_stage4: { parameters: [instance], returnType: 'void' },
      onregenfn: { parameters: [instance], returnType: 'void' },
      on_dug_up: { parameters: [instance], returnType: 'void' },
      onpickedfn: { parameters: [instance], returnType: 'void' },
      makeemptyfn: { parameters: [instance], returnType: 'void' },
      makebarrenfn: { parameters: [instance], returnType: 'void' },
      ontransplantfn: { parameters: [instance], returnType: 'void' },
      on_bush_burnt: { parameters: [instance], returnType: 'void' },
      on_ignite: { parameters: [], returnType: 'void' },
      on_save: { parameters: [instance, 'EntityPersistData'], returnType: 'void' },
      on_load: { parameters: [instance, 'EntityPersistData'], returnType: 'void' },
    },
    registrations: [
      {
        target: 'components.workable',
        name: 'SetOnFinishCallback',
        kind: 'call',
        parameters: [instance],
        returnType: 'void',
      },
      {
        target: 'inst',
        name: 'OnSave',
        kind: 'write',
        parameters: [instance, 'EntityPersistData'],
        returnType: 'void',
      },
      {
        target: 'inst',
        name: 'OnLoad',
        kind: 'write',
        parameters: [instance, 'EntityPersistData'],
        returnType: 'void',
      },
    ],
  });
}
