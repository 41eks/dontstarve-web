import { readBankClips } from './anim-bin.mjs';
import { clipCatalog } from './clip-scan.mjs';
import { emitPrefabSignatures } from './stickhead-signatures.mjs';
import { smallPropagator } from './wood-chair-config.mjs';

const instance = 'StagehandInstance';
export const stagehandProfile = {
  file: 'prefabs/stagehand.lua',
  requires: ['class', 'brain', 'behaviourtree'],
  scenarios: [
    { name: 'client', master: false, seed: 42 },
    {
      name: 'master-day',
      master: true,
      seed: 42,
      skins: true,
      tuning: ['SEG_TIME', 'LUNARHAIL_BUILDUP_DECAY_TICK_TIME', 'LUNARHAIL_BUILDUP_DECAY_RATE'],
    },
    {
      name: 'master-dusk-snow',
      master: true,
      seed: 43,
      lunarHailWorkable: true,
      state: { isdusk: true, issnowcovered: true },
    },
    {
      name: 'master-night-standing',
      master: true,
      seed: 44,
      lunarHailWorkable: true,
      state: { isnight: true, isfullmoon: false },
      instanceCalls: [['ChangePhysics', true]],
    },
  ],
  typeImports: [
    [instance, '../stagehand'],
    ['WorkableOnWorkFn', '../../../componets/src/workable'],
  ],
};

function args(recording, target, name, { kind = 'call', entity = recording.entity, line } = {}) {
  const calls = recording.operations.filter(
    op =>
      op.entity === entity &&
      op.target === target &&
      op.name === name &&
      op.kind === kind &&
      (line === undefined || op.source.line === line),
  );
  if (calls.length !== 1) {
    throw new Error(`Expected one ${target}.${name} in ${recording.scenario.name}, found ${calls.length}`);
  }
  return calls[0].args;
}

function recordedSkins(recording, build) {
  let skinSymbolOverrides;
  const skins = Object.fromEntries(
    recording.skins.map(({ entity, name, operations, spawned }) => {
      const [setSkin, ...overrides] = operations;
      if (
        spawned.length ||
        !setSkin ||
        setSkin.entity !== entity ||
        setSkin.target !== 'AnimState' ||
        setSkin.name !== 'SetSkin' ||
        setSkin.args.length !== 2 ||
        setSkin.args[1] !== build ||
        !overrides.length ||
        overrides.some(
          op =>
            op.entity !== entity ||
            op.target !== 'AnimState' ||
            op.name !== 'OverrideSymbol' ||
            op.args[1] !== build ||
            op.args[0] !== op.args[2],
        )
      ) {
        throw new Error(`Unsupported stagehand skin operations for ${name}`);
      }
      const symbols = overrides.map(op => op.args[0]);
      if (skinSymbolOverrides && JSON.stringify(skinSymbolOverrides) !== JSON.stringify(symbols)) {
        throw new Error(`Inconsistent stagehand skin symbol overrides for ${name}`);
      }
      skinSymbolOverrides = symbols;
      return [name, `dynamic/${setSkin.args[0]}.zip`];
    }),
  );
  if (!skinSymbolOverrides) {
    throw new Error('Expected stagehand skins in the MasterSim recording');
  }
  return { skins, skinSymbolOverrides };
}

export function stagehandConfig(snapshot) {
  const [client, master, snow, standing] = snapshot.recordings;
  const [bank] = args(client, 'AnimState', 'SetBank');
  const [build] = args(client, 'AnimState', 'SetBuild');
  const initial = args(client, 'AnimState', 'PlayAnimation');
  const [animation] = client.assets.filter(asset => asset.type === 'ANIM').map(asset => asset.path);
  const [fxPrefab, offset, followSymbol] = args(master, 'components.burnable', 'AddBurnFX');
  const [workAction] = args(master, 'components.workable', 'SetWorkAction');
  const [lootTable, loot] = args(master, 'global', 'SetSharedLootTable', { entity: 0 });
  if (
    bank !== build ||
    animation !== `anim/${bank}.zip` ||
    initial.length !== 1 ||
    args(client, 'Transform', 'SetFourFaced').length ||
    args(master, 'inst', 'SetStateGraph')[0] !== 'SGstagehand' ||
    !master.prefabDependencies.includes(fxPrefab) ||
    workAction.name !== 'ACTIONS.HAMMER' ||
    args(master, 'components.lootdropper', 'SetChanceLootTable')[0] !== lootTable ||
    loot.length !== 1 ||
    !master.prefabDependencies.includes(loot[0][0])
  ) {
    throw new Error('Unsupported stagehand constructor configuration');
  }

  const tagOps = client.operations.filter(op => op.entity === client.entity && op.name === 'AddTag');
  const [blocker] = args(standing, 'inst', 'RemoveTag');
  const [snowSymbol, snowBuild, snowSource] = args(client, 'AnimState', 'OverrideSymbol');
  const [snowLayer] = args(client, 'AnimState', 'Hide');
  const [snowTag] = tagOps.find(op => op.source.file === 'standardcomponents.lua').args;
  function buildupSymbol(recording) {
    const overrides = recording.operations.filter(op => op.target === 'AnimState' && op.name === 'OverrideSymbol');
    const [symbol, build, source] = overrides.at(-1).args;
    if (overrides.length !== 2 || symbol !== snowSymbol || build !== snowBuild || source === snowSource) {
      throw new Error(`Unexpected stagehand lunar hail art in ${recording.scenario.name}`);
    }
    return source;
  }
  if (tagOps[0].args[0] !== blocker || !snow.operations.some(op => op.name === 'Show' && op.args[0] === snowLayer)) {
    throw new Error('Unexpected stagehand physics or snow appearance');
  }
  const afterStand = standing.operations.slice(standing.operations.findIndex(op => op.name === 'RemoveTag'));
  const standingPhysics = { ...standing, operations: afterStand };
  const facings = 4;
  const bankClips = readBankClips(new URL(`../../public/dst/data/${animation}`, import.meta.url), bank);
  const clipSeconds = Object.fromEntries(
    [...bankClips]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, { entries }]) => {
        const lengths = new Set(entries.map(({ frames, frameRate }) => frames / frameRate));
        if (lengths.size !== 1 || !Number.isFinite([...lengths][0]) || [...lengths][0] <= 0) {
          throw new Error(`Stagehand's ${name} must have one positive duration across its facings`);
        }
        return [name, [...lengths][0]];
      }),
  );
  return {
    prefab: snapshot.prefab,
    archive: animation.slice('anim/'.length),
    bank,
    build,
    initialClip: initial[0],
    facings,
    ...clipCatalog({
      plays: snapshot.clipPlays,
      bankClips,
      facings,
    }),
    clipSeconds,
    ...recordedSkins(master, build),
    tags: tagOps.filter(op => op.source.file === snapshot.file && op.args[0] !== blocker).map(op => op.args[0]),
    physics: {
      blocker,
      capsule: args(client, 'Physics', 'SetCapsule'),
      friction: args(client, 'Physics', 'SetFriction')[0],
      damping: args(client, 'Physics', 'SetDamping')[0],
      hiding: {
        mass: args(client, 'Physics', 'SetMass')[0],
        group: args(client, 'Physics', 'SetCollisionGroup')[0],
        mask: args(client, 'Physics', 'SetCollisionMask'),
      },
      standing: {
        mass: args(standingPhysics, 'Physics', 'SetMass')[0],
        group: args(standingPhysics, 'Physics', 'SetCollisionGroup')[0],
        collidesWith: args(standing, 'Physics', 'CollidesWith')[0],
      },
    },
    snow: {
      tag: snowTag,
      symbol: snowSymbol,
      build: snowBuild,
      source: snowSource,
      layer: snowLayer,
      buildup: buildupSymbol(standing),
      snowyBuildup: buildupSymbol(snow),
    },
    lunarHail: {
      totalWork: args(master, 'components.lunarhailbuildup', 'SetTotalWorkAmount')[0],
      moonGlass: args(master, 'components.lunarhailbuildup', 'SetMoonGlassAmount')[0],
      decayPeriod: master.tuning.LUNARHAIL_BUILDUP_DECAY_TICK_TIME,
      decayRate: master.tuning.LUNARHAIL_BUILDUP_DECAY_RATE,
    },
    scrapbookSpeechStatus: args(master, 'inst', 'scrapbook_speechstatus', { kind: 'write' })[0],
    sounds: args(master, 'inst', 'sounds', { kind: 'write' })[0],
    loot: { table: lootTable, prefab: loot[0][0], chance: loot[0][1] },
    propagator: smallPropagator([master, snow, standing]),
    hauntCooldown: args(master, 'components.hauntable', 'cooldown', { kind: 'write' })[0],
    burnable: {
      fxLevel: args(master, 'components.burnable', 'SetFXLevel')[0],
      burnTime: args(master, 'components.burnable', 'SetBurnTime')[0],
      fxPrefab,
      offset,
      followSymbol,
    },
    workable: {
      action: workAction.name.slice('ACTIONS.'.length),
      workLeft: args(master, 'components.workable', 'SetWorkLeft')[0],
      resetAfterSeconds: master.tuning.SEG_TIME * 0.5,
    },
    locomotor: {
      walkSpeed: args(master, 'components.locomotor', 'walkspeed', { kind: 'write' })[0],
      triggersCreep: args(master, 'components.locomotor', 'SetTriggersCreep')[0],
      pathCaps: args(master, 'components.locomotor', 'pathcaps', { kind: 'write' })[0],
    },
  };
}

export function stagehandSignatures(snapshot) {
  return emitPrefabSignatures([snapshot], {
    typeImports: stagehandProfile.typeImports,
    staticContracts: new Map([['Prefab', { parameters: [], returnType: instance }]]),
    registrations: [
      {
        target: 'components.workable',
        name: 'SetOnWorkCallback',
        kind: 'call',
        parameters: [instance, 'Parameters<WorkableOnWorkFn<StagehandInstance>>[1]'],
        returnType: 'void',
      },
      {
        target: 'components.inspectable',
        name: 'getstatus',
        kind: 'write',
        parameters: [instance],
        returnType: 'string',
      },
      {
        target: 'inst',
        name: 'CanStandUp',
        kind: 'write',
        parameters: [instance],
        returnType: 'boolean',
      },
      {
        target: 'inst',
        name: 'ChangePhysics',
        kind: 'write',
        parameters: [instance, 'boolean'],
        returnType: 'void',
      },
    ],
  });
}
