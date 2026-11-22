import { emitPrefabSignatures } from './stickhead-signatures.mjs';

const instance = 'MoondialInstance';
const phases = ['new', 'quarter', 'half', 'threequarter', 'full'];
const state = moonphase => ({ moonphase, iswaxingmoon: moonphase !== 'half', isalterawake: false });

export const moondialProfile = {
  file: 'prefabs/moondial.lua',
  scenarios: [
    { name: 'client', master: false, seed: 42, state: state('new') },
    ...phases.map(phase => ({ name: `master-${phase}`, master: true, seed: 42, state: state(phase) })),
  ],
  typeImports: [
    ['EntityPersistData', '../saveRecord'],
    ['LootDropper', '../../../componets/src/lootdropper'],
    ['WorldMoonPhase', '@dontstarve-web/signals'],
    [instance, '../moondial'],
  ],
};

function args(recording, target, name, kind = 'call') {
  const calls = recording.operations.filter(
    operation =>
      operation.entity === recording.entity &&
      operation.kind === kind &&
      operation.target === target &&
      operation.name === name,
  );
  if (calls.length !== 1) {
    throw new Error(`Expected one ${target}.${name} in ${recording.scenario.name}, found ${calls.length}`);
  }
  return calls[0].args;
}

export function moondialConfig(snapshot) {
  const [client, master] = snapshot.recordings;
  const [bank] = args(client, 'AnimState', 'SetBank');
  const [build] = args(client, 'AnimState', 'SetBuild');
  const [idleAnimation] = args(client, 'AnimState', 'PlayAnimation');
  const archives = client.assets.filter(asset => asset.type === 'ANIM').map(asset => asset.path);
  const animation = `anim/${bank}.zip`;
  const buildArchive = `anim/${build}.zip`;
  const waning = snapshot.recordings.find(r => r.scenario.state.moonphase === 'half');
  const reflections = waning.operations.filter(
    op => op.entity === waning.entity && op.target === 'AnimState' && op.name === 'OverrideSymbol',
  );
  if (
    !archives.includes(animation) ||
    !archives.includes(buildArchive) ||
    !reflections.length ||
    reflections.some(op => op.args[0] !== op.args[2] || op.args[1] !== reflections[0].args[1]) ||
    !archives.includes(`anim/${reflections[0].args[1]}.zip`)
  ) {
    throw new Error('Unsupported moondial animation archive or reflection layout');
  }
  const [physicsRadius, physicsHeight] = args(client, 'Physics', 'SetCapsule');
  if (physicsHeight !== 2 || !Number.isFinite(physicsRadius) || physicsRadius <= 0) {
    throw new Error('Expected moondial obstacle physics with a positive radius and default height');
  }
  const [deployRadius] = args(client, 'inst', 'SetDeploySmartRadius');
  const [workLeft] = args(master, 'components.workable', 'SetWorkLeft');
  const [workAction] = args(master, 'components.workable', 'SetWorkAction');
  if (workAction?.name !== 'ACTIONS.HAMMER' || !Number.isSafeInteger(workLeft) || workLeft <= 0) {
    throw new Error('Expected moondial HAMMER work configuration');
  }
  if (args(master, 'inst', 'SetStateGraph')[0] !== 'SGmoondial') {
    throw new Error('Expected SGmoondial');
  }
  return {
    archive: animation.slice(5),
    buildArchive: buildArchive.slice(5),
    bank,
    idleAnimation,
    tags: client.operations.filter(op => op.entity === client.entity && op.name === 'AddTag').map(op => op.args[0]),
    physicsRadius,
    deployRadius,
    workable: { action: workAction.name.slice('ACTIONS.'.length), workLeft },
    minimap: {
      icon: args(client, 'MiniMapEntity', 'SetIcon')[0],
      cache: args(client, 'MiniMapEntity', 'SetCanUseCache')[0],
      overFog: args(client, 'MiniMapEntity', 'SetDrawOverFogOfWar')[0],
    },
    reflectionBuild: reflections[0].args[1],
    reflectionSymbols: reflections.map(op => op.args[0]),
    light: {
      colour: args(client, 'Light', 'SetColour'),
      falloff: args(client, 'Light', 'SetFalloff')[0],
      intensity: args(client, 'Light', 'SetIntensity')[0],
      phases: Object.fromEntries(
        snapshot.recordings.slice(1).map(recording => {
          const override = args(recording, 'AnimState', 'SetLightOverride')[0];
          const radius = args(recording, 'Light', 'SetRadius')[0];
          const enabled = recording.operations
            .filter(op => op.entity === recording.entity && op.target === 'Light' && op.name === 'Enable')
            .at(-1);
          return [recording.scenario.state.moonphase, { override, radius: enabled.args[0] ? radius : 0 }];
        }),
      ),
    },
  };
}

export function moondialSignatures(snapshot) {
  return emitPrefabSignatures([snapshot], {
    typeImports: moondialProfile.typeImports,
    staticContracts: new Map([
      ['Prefab', { parameters: [], returnType: instance }],
      ['DoTaskInTime', { parameters: [instance], returnType: 'void' }],
    ]),
    registrations: [
      {
        target: 'inst',
        name: 'WatchWorldState',
        kind: 'call',
        state: 'moonphase',
        parameters: [instance, 'WorldMoonPhase | undefined'],
        returnType: 'void',
      },
      {
        target: 'inst',
        name: 'WatchWorldState',
        kind: 'call',
        state: 'isalterawake',
        parameters: [instance, 'boolean'],
        returnType: 'void',
      },
      {
        target: 'components.workable',
        name: 'SetOnFinishCallback',
        kind: 'call',
        parameters: [instance],
        returnType: 'void',
      },
      {
        target: 'components.lootdropper',
        name: 'SetLootSetupFn',
        kind: 'call',
        parameters: ['LootDropper'],
        returnType: 'void',
      },
      {
        target: 'components.inspectable',
        name: 'getstatus',
        kind: 'write',
        parameters: [instance, '{ hasTag?(tag: string): boolean } | undefined'],
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
