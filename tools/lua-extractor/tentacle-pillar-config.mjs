import { readBankClips } from './anim-bin.mjs';
import { clipCatalog } from './clip-scan.mjs';
import { emitPrefabSignatures } from './stickhead-signatures.mjs';

const instance = 'TentaclePillarInstance';

/**
 * prefabs/tentacle_pillar.lua fn. The file's atrium set piece (tentacle_pillar_atrium) requires map/object_layout at the
 * top level to build its layout; the recording stubs that module, since only tentacle_pillar's fn is recorded. One client
 * scenario records the pristine constructor and one MasterSim the components. The fn has no randomness, so one seed each.
 */
export const tentaclePillarProfile = {
  file: 'prefabs/tentacle_pillar.lua',
  stubs: {
    // LayoutForDefinition("TentaclePillarToAtrium") at the file's top level; only tentacle_pillar's fn is recorded.
    'map/object_layout':
      'return { LayoutForDefinition = function() return nil end, ConvertLayoutToEntitylist = function() return {} end }',
  },
  scenarios: [
    { name: 'client', master: false, seed: 42 },
    { name: 'master', master: true, seed: 42 },
  ],
  typeImports: [
    [instance, '../tentacle_pillar'],
    ['EntityPersistData', '../saveRecord'],
    ['Haunter', '../../../componets/src/hauntable'],
    ['CombatActor', '../../../componets/src/combat'],
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

export function tentaclePillarConfig(snapshot) {
  const [client, master] = snapshot.recordings;
  const [bank] = args(client, client.entity, 'AnimState', 'SetBank');
  const [build] = args(client, client.entity, 'AnimState', 'SetBuild');
  const [initialClip, loop] = args(client, client.entity, 'AnimState', 'PlayAnimation');
  const [animation] = client.assets.filter(asset => asset.type === 'ANIM').map(asset => asset.path);
  // One archive holds the tentaclepillar bank and the tentacle_pillar build: its name matches the build, not the bank.
  if (
    animation !== `anim/${build}.zip` ||
    loop !== true ||
    ops(client, client.entity, 'Transform', 'SetFourFaced').length ||
    ops(client, client.entity, 'Transform', 'SetEightFaced').length
  ) {
    throw new Error('Unsupported tentacle_pillar art layout');
  }
  const tags = ops(client, client.entity, 'inst', 'AddTag')
    .filter(operation => operation.source.file === snapshot.file)
    .map(operation => operation.args[0]);
  // MakeObstaclePhysics(inst, 2, 24) adds the `blocker` tag and the capsule; the prefab's own tags exclude it.
  if (tags.some(tag => tag === 'blocker')) {
    throw new Error('Expected the blocker tag from MakeObstaclePhysics, not the prefab');
  }
  const [radius, height] = args(client, client.entity, 'Physics', 'SetCapsule');
  const [icon] = args(client, client.entity, 'MiniMapEntity', 'SetIcon');
  const [maxHealth] = args(master, master.entity, 'components.health', 'SetMaxHealth');
  const [near, far] = args(master, master.entity, 'components.playerprox', 'SetDist');
  const [lootTable] = args(master, master.entity, 'components.lootdropper', 'SetChanceLootTable');
  const [sharedTable, sharedEntries] = args(master, 0, 'global', 'SetSharedLootTable');
  if (lootTable !== sharedTable) {
    throw new Error('Expected the lootdropper to use the file shared loot table');
  }
  const bankClips = readBankClips(new URL(`../../public/dst/data/${animation}`, import.meta.url), bank);
  return {
    prefab: snapshot.prefab,
    archive: animation.slice('anim/'.length),
    bank,
    build,
    initialClip,
    facings: 1,
    ...clipCatalog({ plays: snapshot.clipPlays, bankClips, facings: 1 }),
    tags,
    physics: { radius, height },
    minimapIcon: icon,
    health: { maxHealth },
    playerprox: { near, far },
    loot: { table: lootTable, entries: sharedEntries },
  };
}

export function tentaclePillarSignatures(snapshot) {
  return emitPrefabSignatures([snapshot], {
    typeImports: tentaclePillarProfile.typeImports,
    staticContracts: new Map([['Prefab', { parameters: [], returnType: instance }]]),
    localContracts: {
      CustomOnHaunt: { parameters: [instance, 'Haunter'], returnType: 'boolean' },
      DoRetract: { parameters: [instance, 'boolean | undefined'], returnType: 'void' },
      OnEmergeOver: { parameters: [instance], returnType: 'void' },
    },
    registrations: [
      {
        target: 'components.combat',
        name: 'SetOnHit',
        kind: 'call',
        parameters: [instance, 'CombatActor', 'number'],
        returnType: 'void',
      },
      {
        target: 'components.playerprox',
        name: 'SetOnPlayerFar',
        kind: 'call',
        parameters: [instance],
        returnType: 'void',
      },
      {
        target: 'inst',
        name: 'ListenForEvent',
        kind: 'call',
        state: 'death',
        parameters: [instance],
        returnType: 'void',
      },
      { target: 'inst', name: 'OnEmerge', kind: 'write', parameters: [instance], returnType: 'void' },
      { target: 'inst', name: 'Overtake', kind: 'write', parameters: [instance], returnType: 'unknown' },
      { target: 'inst', name: 'OnEntitySleep', kind: 'write', parameters: [instance], returnType: 'void' },
      { target: 'inst', name: 'OnEntityWake', kind: 'write', parameters: [instance], returnType: 'void' },
      {
        target: 'inst',
        name: 'OnSave',
        kind: 'write',
        parameters: [instance, 'EntityPersistData'],
        returnType: 'void',
      },
      {
        target: 'inst',
        name: 'OnPreLoad',
        kind: 'write',
        parameters: [instance, 'EntityPersistData'],
        returnType: 'void',
      },
      { target: 'inst', name: 'OnLoadPostPass', kind: 'write', parameters: [instance], returnType: 'void' },
    ],
  });
}
