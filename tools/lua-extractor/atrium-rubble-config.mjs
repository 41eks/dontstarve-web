import { readBankClips } from './anim-bin.mjs';
import { clipCatalog } from './clip-scan.mjs';
import { emitPrefabSignatures } from './stickhead-signatures.mjs';

const instance = 'AtriumRubbleInstance';
/** fn's SetAnimId(inst, math.random(2)): the preset each seed's draw must fall in. */
const ANIM_IDS = [1, 2];

export const atriumRubbleProfile = {
  file: 'prefabs/atrium_rubble.lua',
  // componentutil.lua defines MakeRoseTarget_CreateFuel_IncreasedHorror; it reads STRINGS while it loads.
  requires: ['strings', 'componentutil'],
  scenarios: [
    { name: 'client', master: false, seed: 42 },
    // Seed 42 draws 2 (SetAnimId plays idle2); six inspections show getstatus's story line sequence.
    { name: 'master', master: true, seed: 42, inspections: 6 },
    // Seed 50 draws 1, which SetAnimId leaves on fn's idle1.
    { name: 'master-seed-50', master: true, seed: 50 },
    // OnLoad of both saved fields after a draw of 2: SetAnimId plays idle1, and getstatus keeps the loaded line.
    {
      name: 'master-load',
      master: true,
      seed: 42,
      instanceCalls: [['OnLoad', { animid: 1, storyprogress: 3 }]],
      inspections: 1,
    },
  ],
  typeImports: [
    ['EntityPersistData', '../saveRecord'],
    ['AtriumRubbleAnimId', '../atrium_rubble'],
    [instance, '../atrium_rubble'],
  ],
};

const own = recording => recording.operations.filter(op => op.entity === recording.entity);

function args(recording, target, name, kind = 'call') {
  const calls = own(recording).filter(op => op.kind === kind && op.target === target && op.name === name);
  if (calls.length !== 1) {
    throw new Error(`Expected one ${target}.${name} in ${recording.scenario.name}, found ${calls.length}`);
  }
  return calls[0].args;
}

/** The arguments of each AnimState:PlayAnimation on the recorded entity, in order. */
function plays(recording) {
  return own(recording)
    .filter(op => op.target === 'AnimState' && op.name === 'PlayAnimation')
    .map(op => op.args);
}

export function atriumRubbleConfig(snapshot) {
  const [client, master, seed50, load] = snapshot.recordings;
  const [bank] = args(client, 'AnimState', 'SetBank');
  const [build] = args(client, 'AnimState', 'SetBuild');
  const archives = client.assets.filter(asset => asset.type === 'ANIM').map(asset => asset.path);
  const animation = `anim/${bank}.zip`;
  if (bank !== build || archives.length !== 1 || archives[0] !== animation) {
    throw new Error('Unsupported atrium_rubble art layout');
  }
  // fn's PlayAnimation("idle1") without a loop argument; the client stops there.
  const clientPlays = plays(client);
  const [[initialClip, ...initialLoop]] = clientPlays;
  if (clientPlays.length !== 1 || initialLoop.length) {
    throw new Error('Expected one PlayAnimation without a loop argument on the client');
  }
  if (
    own(client).some(op => op.target === 'Transform' && /^Set(Four|Eight)Faced$/.test(op.name)) ||
    own(client).some(op => op.name === 'SetFinalOffset')
  ) {
    throw new Error('Unexpected atrium_rubble face mode or final offset');
  }
  // inst.animid = 1 before SetAnimId(inst, math.random(2)); a draw of 1 plays nothing more.
  const animIdWrites = recording =>
    own(recording).filter(op => op.kind === 'write' && op.target === 'inst' && op.name === 'animid');
  const [defaultAnimId] = animIdWrites(master)[0].args;
  const draws = [master, seed50].map(recording => {
    const id = animIdWrites(recording).at(-1).args[0];
    const clips = plays(recording).map(([clip]) => clip);
    const expected = id === defaultAnimId ? [initialClip] : [initialClip, `idle${id}`];
    if (!ANIM_IDS.includes(id) || JSON.stringify(clips) !== JSON.stringify(expected)) {
      throw new Error(`Unexpected atrium_rubble draw in ${recording.scenario.name}: ${id}, plays ${clips}`);
    }
    return id;
  });
  if (defaultAnimId !== ANIM_IDS[0] || new Set(draws).size !== ANIM_IDS.length) {
    throw new Error('Expected the scenarios to draw every atrium_rubble anim id');
  }
  const loaded = plays(load).map(([clip]) => clip);
  if (JSON.stringify(loaded) !== JSON.stringify([initialClip, 'idle2', 'idle1'])) {
    throw new Error(`Unexpected atrium_rubble OnLoad plays: ${loaded}`);
  }
  // getstatus over fresh entities hands out LINE_1..LINE_n and wraps: n is NUM_STORY_LINES.
  const statuses = master.operations
    .filter(op => op.kind === 'return' && op.target === 'components.inspectable' && op.name === 'getstatus')
    .map(op => op.args[0]);
  const storyLines = statuses.length - 1;
  const expectedStatuses = [...Array.from({ length: storyLines }, (_, i) => `LINE_${i + 1}`), 'LINE_1'];
  if (storyLines < 1 || JSON.stringify(statuses) !== JSON.stringify(expectedStatuses)) {
    throw new Error(`Unexpected atrium_rubble getstatus sequence: ${statuses}`);
  }
  const [loadedStatus] = args(load, 'components.inspectable', 'getstatus', 'return');
  if (loadedStatus !== 'LINE_3') {
    throw new Error(`Expected the loaded story line from getstatus, got ${loadedStatus}`);
  }
  const [physicsRadius, physicsHeight] = args(client, 'Physics', 'SetCapsule');
  if (!(physicsRadius > 0) || physicsHeight !== 2) {
    throw new Error('Expected atrium_rubble obstacle physics with the default height');
  }
  const [hauntCooldown] = args(master, 'components.hauntable', 'cooldown', 'write');
  // atrium_rubble sets no Transform face mode, so every clip needs only its default facing.
  const { clips, clipsNotInBank, dynamicClips } = clipCatalog({
    plays: snapshot.clipPlays,
    bankClips: readBankClips(new URL(`../../public/dst/data/${animation}`, import.meta.url), bank),
    facings: 1,
  });
  // SetAnimId's "idle"..tostring(id) is dynamic: each id of the preset must name a bank clip.
  for (const id of ANIM_IDS) {
    if (!clips[`idle${id}`]) {
      throw new Error(`atrium_rubble's bank has no idle${id}`);
    }
  }
  return {
    archive: animation.slice('anim/'.length),
    bank,
    initialClip,
    defaultAnimId,
    animIds: ANIM_IDS,
    clips,
    clipsNotInBank,
    dynamicClips,
    tags: own(client)
      .filter(op => op.name === 'AddTag')
      .map(op => op.args[0]),
    physicsRadius,
    minimapIcon: args(client, 'MiniMapEntity', 'SetIcon')[0],
    scrapbook: {
      specialinfo: args(client, 'inst', 'scrapbook_specialinfo', 'write')[0],
      speechstatus: args(master, 'inst', 'scrapbook_speechstatus', 'write')[0],
    },
    hauntCooldown,
    storyLines,
    roseinspectable: {
      forcedInduceCooldownOnActivate: args(
        master,
        'components.roseinspectable',
        'SetForcedInduceCooldownOnActivate',
      )[0],
    },
  };
}

export function atriumRubbleSignatures(snapshot) {
  return emitPrefabSignatures([snapshot], {
    typeImports: atriumRubbleProfile.typeImports,
    staticContracts: new Map([['Prefab', { parameters: [], returnType: instance }]]),
    registrations: [
      {
        target: 'components.inspectable',
        name: 'getstatus',
        kind: 'write',
        parameters: [instance],
        returnType: 'string',
      },
      ...['OnSave', 'OnLoad'].map(name => ({
        target: 'inst',
        name,
        kind: 'write',
        parameters: [instance, 'EntityPersistData'],
        returnType: 'void',
      })),
    ],
    localContracts: { SetAnimId: { parameters: [instance, 'AtriumRubbleAnimId'], returnType: 'void' } },
  });
}
