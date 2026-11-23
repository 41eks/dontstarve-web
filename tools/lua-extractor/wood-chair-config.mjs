import { readBankClips } from './anim-bin.mjs';
import { clipCatalog } from './clip-scan.mjs';
import { emitPrefabSignatures } from './stickhead-signatures.mjs';

const instance = 'WoodChairInstance';
const back = 'WoodChairBackInstance';

/**
 * furniture_chairs.lua AddChair("wood_chair", ...). The client stops at SetPristine; MasterSim spawns the back child and
 * adds the components. Two MasterSim seeds expose MakeSmallPropagator's random values.
 */
export const woodChairProfile = {
  file: 'prefabs/furniture_chairs.lua',
  // util.lua's shallowcopy and prefabutil.lua's MakePlacer / MakeDeployableKitItem run while the file builds its list.
  requires: ['util', 'prefabutil'],
  scenarios: [
    { name: 'client', master: false, seed: 42 },
    { name: 'master', master: true, seed: 42, skins: true },
    { name: 'master-seed-43', master: true, seed: 43 },
  ],
  typeImports: [
    ['EntityPersistData', '../saveRecord'],
    ['WorkableOnFinishFn', '../../../componets/src/workable'],
    ['WorkableOnWorkFn', '../../../componets/src/workable'],
    [instance, '../furniture_chairs'],
    [back, '../furniture_chairs'],
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

function look(recording, entity) {
  const [bank] = args(recording, entity, 'AnimState', 'SetBank');
  const [build] = args(recording, entity, 'AnimState', 'SetBuild');
  const play = args(recording, entity, 'AnimState', 'PlayAnimation');
  if (play.length !== 1) {
    throw new Error(`Expected a non-looping PlayAnimation on entity ${entity}`);
  }
  if (args(recording, entity, 'Transform', 'SetFourFaced').length !== 0) {
    throw new Error(`Expected Transform:SetFourFaced on entity ${entity}`);
  }
  return {
    bank,
    build,
    idleAnimation: play[0],
    facings: 4,
    finalOffset: args(recording, entity, 'AnimState', 'SetFinalOffset')[0],
    hiddenLayers: ops(recording, entity, 'AnimState', 'Hide').map(op => op.args[0]),
    tags: ops(recording, entity, 'inst', 'AddTag').map(op => op.args[0]),
  };
}

/**
 * MakeSmallPropagator: flashpoint 5 + random()*5, range 3 + random()*2, heat 3 + random()*2. Both seeds must land in
 * those ranges and draw differently, so the TS 'small' preset (which draws its own) is the matching declaration.
 */
export function smallPropagator(recordings) {
  const draws = recordings.map(recording => {
    const write = name => args(recording, recording.entity, 'components.propagator', name, 'write')[0];
    const draw = {
      flashpoint: write('flashpoint'),
      propagaterange: write('propagaterange'),
      heatoutput: write('heatoutput'),
    };
    const fixed = ['acceptsheat', 'decayrate', 'damagerange', 'damages'].map(name => write(name));
    const inRange = (value, low) => value >= low && value <= low + (low === 5 ? 5 : 2);
    if (
      JSON.stringify(fixed) !== JSON.stringify([true, 0.5, 2, true]) ||
      !inRange(draw.flashpoint, 5) ||
      !inRange(draw.propagaterange, 3) ||
      !inRange(draw.heatoutput, 3)
    ) {
      throw new Error(`Expected MakeSmallPropagator in ${recording.scenario.name}`);
    }
    return draw;
  });
  if (JSON.stringify(draws[0]) === JSON.stringify(draws[1])) {
    throw new Error('Expected the two MasterSim seeds to draw different propagator values');
  }
  return 'small';
}

/**
 * skinprefabs.lua's wood_chair skins, from each recorded init_fn (prefabskin.lua wood_chair_init_fn):
 * basic_init_fn's AnimState:SetSkin(skin build, base build) on the chair, and OverrideItemSkinSymbol of the back's
 * symbols from the same skin build, keyed by the chair's GUID. A skin's build is mirrored as anim/dynamic/<build>.zip.
 * Any other init_fn operation is unsupported.
 */
function recordedSkins(recording, { build: baseBuild, backPrefab }) {
  if (!recording.skins?.length) {
    throw new Error(`Expected the recorded wood_chair skins in ${recording.scenario.name}`);
  }
  let backSymbols;
  const skins = recording.skins.map(({ name, entity, spawned, operations }) => {
    const back = spawned.filter(({ prefab }) => prefab === backPrefab);
    if (back.length !== 1) {
      throw new Error(`Expected the ${name} chair to spawn one ${backPrefab}`);
    }
    const [setSkin, ...overrides] = operations;
    if (
      setSkin?.entity !== entity ||
      setSkin.target !== 'AnimState' ||
      setSkin.name !== 'SetSkin' ||
      setSkin.args.length !== 2 ||
      setSkin.args[1] !== baseBuild
    ) {
      throw new Error(`Expected ${name}'s init_fn to SetSkin the chair over ${baseBuild}`);
    }
    const [skinBuild] = setSkin.args;
    const symbols = overrides.map(({ entity: target, target: object, name: method, args }) => {
      const [symbol, build, sourceSymbol, guid, defaultBuild] = args;
      if (
        target !== back[0].entity ||
        object !== 'AnimState' ||
        method !== 'OverrideItemSkinSymbol' ||
        build !== skinBuild ||
        sourceSymbol !== symbol ||
        guid !== entity ||
        defaultBuild !== baseBuild
      ) {
        throw new Error(`Unsupported ${name} init_fn operation: ${object}.${method}`);
      }
      return symbol;
    });
    if (backSymbols && JSON.stringify(backSymbols) !== JSON.stringify(symbols)) {
      throw new Error(`Expected every wood_chair skin to override the same back symbols, not ${symbols} in ${name}`);
    }
    backSymbols = symbols;
    return [name, `dynamic/${skinBuild}.zip`];
  });
  return { skins: Object.fromEntries(skins), backSkinSymbols: backSymbols };
}

export function woodChairConfig(snapshot) {
  const [client, master, otherSeed] = snapshot.recordings;
  const chair = master.entity;
  const archives = client.assets.filter(asset => asset.type === 'ANIM').map(asset => asset.path);
  const clientLook = look(client, client.entity);
  const chairLook = look(master, chair);
  if (JSON.stringify(clientLook) !== JSON.stringify(chairLook)) {
    throw new Error('Expected the client and MasterSim chair to declare the same look before SetPristine');
  }
  const [spawn] = ops(master, 0, 'global', 'SpawnPrefab');
  const backEntity = spawn?.args[1]?.entity;
  if (!spawn || ops(master, backEntity, 'entity', 'SetParent')[0]?.args[0]?.entity !== chair) {
    throw new Error('Expected the chair to spawn and parent its back');
  }
  const backLook = look(master, backEntity);
  if (args(master, backEntity, 'inst', 'persists', 'write')[0] !== false) {
    throw new Error('Expected the chair back to be persists = false');
  }
  const animation = `anim/${chairLook.bank}.zip`;
  const buildArchive = `anim/${chairLook.build}.zip`;
  if (
    archives.length !== 2 ||
    !archives.includes(animation) ||
    !archives.includes(buildArchive) ||
    backLook.bank !== chairLook.bank ||
    backLook.build !== chairLook.build
  ) {
    throw new Error('Unsupported wood_chair animation archive layout');
  }
  const [physicsRadius, physicsHeight] = args(client, client.entity, 'Physics', 'SetCapsule');
  const [deployRadius] = args(client, client.entity, 'inst', 'SetDeploySmartRadius');
  const [workAction] = args(master, chair, 'components.workable', 'SetWorkAction');
  const [workLeft] = args(master, chair, 'components.workable', 'SetWorkLeft');
  if (workAction?.name !== 'ACTIONS.HAMMER' || !Number.isSafeInteger(workLeft) || workLeft <= 0) {
    throw new Error('Expected wood_chair HAMMER work configuration');
  }
  const [fxLevel] = args(master, chair, 'components.burnable', 'SetFXLevel');
  const [burnTime] = args(master, chair, 'components.burnable', 'SetBurnTime');
  const burnFx = args(master, chair, 'components.burnable', 'AddBurnFX');
  const burntFns = ops(master, chair, 'components.burnable', 'SetOnBurntFn').map(op => op.args[0].name);
  if (JSON.stringify(burntFns) !== JSON.stringify(['DefaultBurntStructureFn', 'OnChairBurnt'])) {
    throw new Error('Expected MakeSmallBurnable(inst, nil, nil, true) followed by SetOnBurntFn(OnChairBurnt)');
  }
  const savedRotation = args(master, chair, 'components.savedrotation', 'dodelayedpostpassapply', 'write')[0];
  const events = ops(master, chair, 'inst', 'ListenForEvent').map(op => op.args[0]);
  const { skins, backSkinSymbols } = recordedSkins(master, { build: chairLook.build, backPrefab: spawn.args[0] });
  // The chair and its back play every clip on the one bank: its anim.bin, as the game loads it from public/dst/data.
  const { clips, clipsNotInBank, dynamicClips } = clipCatalog({
    plays: snapshot.clipPlays,
    bankClips: readBankClips(new URL(`../../public/dst/data/${animation}`, import.meta.url), chairLook.bank),
    facings: chairLook.facings,
  });
  return {
    archive: animation.slice(5),
    buildArchive: buildArchive.slice(5),
    ...chairLook,
    skins,
    clips,
    clipsNotInBank,
    dynamicClips,
    physicsRadius,
    physicsHeight,
    deployRadius,
    burnable: args(master, chair, 'inst', '_burnable', 'write')[0],
    // Prefab(name.."_back", backfn, assets): the back's archives are the chair's, checked above for its bank and build.
    back: {
      prefab: spawn.args[0],
      archive: animation.slice(5),
      buildArchive: buildArchive.slice(5),
      ...backLook,
      skinSymbols: backSkinSymbols,
      persists: false,
    },
    scrapbookFacing: args(master, chair, 'inst', 'scrapbook_facing', 'write')[0],
    inspectable: { nameoverride: args(master, chair, 'components.inspectable', 'nameoverride', 'write')[0] },
    savedrotation: { dodelayedpostpassapply: savedRotation },
    workable: { action: workAction.name.slice('ACTIONS.'.length), workLeft },
    hauntable: { cooldown: args(master, chair, 'components.hauntable', 'cooldown', 'write')[0] },
    burnfx: { prefab: burnFx[0], level: fxLevel, burnTime },
    propagator: smallPropagator([master, otherSeed]),
    events,
  };
}

export function woodChairSignatures(snapshot) {
  return emitPrefabSignatures([snapshot], {
    typeImports: woodChairProfile.typeImports,
    staticContracts: new Map([['Prefab', { parameters: [], returnType: `${instance} | ${back}` }]]),
    // The animation helpers and the burnt handler's CancelSitterAnimOver are called from callbacks, not registered.
    localContracts: {
      _PlayAnimation: { parameters: [instance, 'string', 'boolean | undefined'], returnType: 'void' },
      _PushAnimation: { parameters: [instance, 'string', 'boolean | undefined'], returnType: 'void' },
      _AnimSetTime: { parameters: [instance, 'number'], returnType: 'void' },
      CancelSitterAnimOver: { parameters: [instance], returnType: 'void' },
      backfn: { parameters: [], returnType: back },
      fn: { parameters: [], returnType: instance },
    },
    registrations: [
      {
        target: 'components.workable',
        name: 'SetOnWorkCallback',
        kind: 'call',
        parameters: [
          instance,
          `Parameters<WorkableOnWorkFn<${instance}>>[1]`,
          `Parameters<WorkableOnWorkFn<${instance}>>[2]`,
          `Parameters<WorkableOnWorkFn<${instance}>>[3]`,
        ],
        returnType: 'void',
      },
      {
        target: 'components.workable',
        name: 'SetOnFinishCallback',
        kind: 'call',
        parameters: [instance, `Parameters<WorkableOnFinishFn<${instance}>>[1]`],
        returnType: 'void',
      },
      {
        target: 'inst',
        name: 'ListenForEvent',
        kind: 'call',
        state: 'onbuilt',
        parameters: [instance, 'unknown'],
        returnType: 'void',
      },
      {
        target: 'components.burnable',
        name: 'SetOnBurntFn',
        kind: 'call',
        parameters: [instance],
        returnType: 'void',
      },
      {
        target: 'components.inspectable',
        name: 'getstatus',
        kind: 'write',
        parameters: [instance],
        returnType: 'string | undefined',
      },
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
