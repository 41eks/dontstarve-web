import * as THREE from 'three';
import { testPlayer } from './testPlayer';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { createMemo, createSignal, GameTimeScheduler } from '@dontstarve-web/signals';
import { portalPrefabs, PORTAL_FX_ID, PORTAL_ID, PortalInstance } from '../../prefab/src/portal';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { PlaySound } from '../../prefab/src/sound';
import { FRAMES } from '../../stategraphs/src/stategraph';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { createClusterSaveZip } from '../../../src/save/download';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { CLUSTER_SAVE_ZIP_TIMEOUT } from './importedSave';
import { createInventoryStore } from './testInventory';

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn(), isPlaying: () => true, setVolume: vi.fn() })),
}));

const JACOB = 'dontstarve/common/together/spawn_vines/spawnportal_jacob';
const SPAWNING = 'dontstarve/common/together/spawn_vines/spawnportal_spawning';
const SHAKE = 'dontstarve/common/together/spawn_vines/spawnportal_shake';
const OPEN = 'dontstarve/common/together/spawn_vines/spawnportal_open';
const turn = () => new Promise(resolve => setTimeout(resolve, 0));

function setup() {
  const scene = new THREE.Scene(),
    awake = createSignal(true),
    portalRez = createSignal(true),
    scheduler = new GameTimeScheduler();
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {
    tickingarea: () => createMemo(() => awake.get()),
  });
  prefabs.register(portalPrefabs({ scheduler, portalRez, spawnPrefab: (id, position) => prefabs.spawn(id, position) }));
  const registry = new EntityRegistry([], prefabs, () => new THREE.Vector3(12, 0, -6)),
    inventory = createInventoryStore([]);
  registry.registerPrefabs(PREFAB_DEFINITIONS.portals);
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  return {
    scene,
    awake,
    portalRez,
    scheduler,
    prefabs,
    registry,
    inventory,
    find: (id: string) =>
      scene.children.map(model => prefabInstance<PrefabInstance>(model)!).find(inst => inst.prefab === id)!,
    save: () =>
      serializeSave(
        template,
        {
          entities: registry.exportRecords(),
          inventory: inventory.exportSaved(),
          elapsedSeconds: 0,
          playerTransform: { position: [0, 0, 0], rotationY: 0 },
        },
        SAVE_CATALOG,
      ),
    dispose() {
      registry.dispose();
      prefabs.dispose();
      displays.dispose();
      inventory.dispose();
      scheduler.dispose();
    },
  };
}
const tags = (inst: PrefabInstance) => inst.listTags();
const sounds = () => vi.mocked(PlaySound).mock.calls.map(([path]) => path);
/** Advances game time to the end of the portal's playing clip, whose animover starts the next state. */
const finishClip = async (scheduler: GameTimeScheduler, portal: PortalInstance) => {
  const playing = portal.animstate.animation.value;
  for (let frame = 0; frame < 300 && portal.animstate.animation.value === playing; frame++) {
    scheduler.advance(FRAMES);
  }
  expect(portal.animstate.animation.value).not.toBe(playing);
  await turn();
};

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('loads with its fx child and runs SGmultiplayerportal idle, spawn and rez states on game time', async () => {
  const s = setup();
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5); // never funnyidle
  try {
    const portal = s.prefabs.spawnAs(PortalInstance, PORTAL_ID, new THREE.Vector3(3, 0, 6), {
      id: 'saved',
      components: {},
    });
    const fx = s.find(PORTAL_FX_ID);
    expect(tags(portal)).toEqual([
      'multiplayer_portal',
      'antlion_sinkhole_blocker',
      'moonportal',
      'moontrader',
      'inspectable',
      'resurrector',
    ]);
    expect(tags(fx)).toEqual(['FX']);
    expect(fx.entityParent).toBe(portal);
    expect(portal.minimap.icon).toBe('portal_dst.png');
    expect(portal.sprite.sprite.value).toMatchObject({ clip: { name: 'idle_loop', loop: false }, billboard: true });
    expect([...portal.sprite.sprite.value.appearance.keys()]).toEqual(
      expect.arrayContaining(['archive-symbol:light', 'archive-symbol:portalbg', 'archive-symbol:spiralfx1']),
    );
    await Promise.all([portal, fx].map(inst => prefabDisplay(inst.transform.model)!.artLoaded()));
    expect(portal.sprite.currentAnimation).toBe('idle_loop');

    // idle: jacob on entry and at frame 30; animover re-enters idle.
    expect(sounds()).toEqual([JACOB]);
    s.scheduler.advance(30 * FRAMES);
    expect(sounds()).toEqual([JACOB, JACOB]);
    await finishClip(s.scheduler, portal);
    expect(portal.sg.stateName).toBe('idle');
    expect(sounds()).toEqual([JACOB, JACOB, JACOB]);

    // A haunting ghost is resurrected here: rez_player opens the portal through spawn_pre, spawn_loop and spawn_pst.
    vi.mocked(PlaySound).mockClear();
    const ghost = testPlayer({ tags: ['playerghost'] }),
      respawn = vi.fn();
    ghost.ListenForEvent('respawnfromghost', (_inst, data) => respawn(data));
    portal.components.hauntable!.DoHaunt(ghost);
    expect(respawn).toHaveBeenCalledWith({ source: portal });
    portal.PushEvent('rez_player');
    expect(portal.sg.stateName).toBe('spawn_pre');
    expect([portal.sprite.sprite.value.clip.name, fx.sprite.sprite.value.clip.name]).toEqual(['pre_fx', 'pre_fx']);
    expect(sounds()).toEqual([SPAWNING, SHAKE]);
    const activate = vi.mocked(PlaySound).mock.results[0].value as { stop: ReturnType<typeof vi.fn> };
    await finishClip(s.scheduler, portal);
    expect(portal.sg.stateName).toBe('spawn_loop');
    expect(activate.stop).not.toHaveBeenCalled();
    s.scheduler.advance(55 * FRAMES);
    expect(sounds()).toEqual([SPAWNING, SHAKE, OPEN]);
    await finishClip(s.scheduler, portal);
    expect(portal.sg.stateName).toBe('spawn_pst');
    expect(activate.stop).toHaveBeenCalledOnce();
    expect(portal.sg.hasStateTag('busy')).toBe(true);
    s.scheduler.advance(12 * FRAMES);
    expect(portal.sg.hasStateTag('busy')).toBe(false);
    await finishClip(s.scheduler, portal);
    expect(portal.sg.stateName).toBe('idle');

    // portal_rez off removes the hauntable and the resurrector tag.
    s.portalRez.set(false);
    await turn();
    expect(portal.components.hauntable).toBeUndefined();
    expect(portal.hasTag('resurrector')).toBe(false);
    s.portalRez.set(true);
    await turn();
    expect(portal.hasTag('resurrector')).toBe(true);

    // Only the portal is saved; removing it removes its fx.
    expect(s.prefabs.exportRecords()).toEqual([
      {
        prefabId: PORTAL_ID,
        record: { id: 'saved', transform: { position: [3, 0, 6], rotationY: 0 }, components: {} },
      },
    ]);
    portal.remove();
    expect(fx.isRemoved).toBe(true);
    const calls = sounds().length;
    s.scheduler.advance(10);
    expect(sounds()).toHaveLength(calls);
  } finally {
    random.mockRestore();
    s.dispose();
  }
});

it('ends its clips on game time whether or not their art is drawn, and holds them while its tile sleeps', async () => {
  const s = setup();
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5); // never funnyidle
  try {
    // Nothing has been drawn yet: pre_fx (12 frames) still ends after its source length, not at once or at load.
    const portal = s.prefabs.spawnAs(PortalInstance, PORTAL_ID, new THREE.Vector3(3, 0, 6), {
      id: 'saved',
      components: {},
    });
    expect(portal.sprite.loaded).toBe(false);
    portal.PushEvent('rez_player');
    expect(portal.sg.stateName).toBe('spawn_pre');
    s.scheduler.advance(11.5 * FRAMES);
    expect(portal.sg.stateName).toBe('spawn_pre');
    s.scheduler.advance(FRAMES);
    expect(portal.sg.stateName).toBe('spawn_loop');
    expect(portal.sprite.loaded).toBe(false);

    // Asleep, the stategraph and its clip wait; awake again, the clip ends after the rest of its length.
    s.scheduler.advance(29.5 * FRAMES);
    s.awake.set(false);
    await turn();
    expect(portal.status.value).toBe('asleep');
    s.scheduler.advance(10);
    expect(portal.sg.stateName).toBe('spawn_loop');
    s.awake.set(true);
    await turn();
    s.scheduler.advance(29.5 * FRAMES);
    expect(portal.sg.stateName).toBe('spawn_loop');
    s.scheduler.advance(FRAMES);
    expect(portal.sg.stateName).toBe('spawn_pst');
  } finally {
    random.mockRestore();
    s.dispose();
  }
});

it(
  'c_spawn, c_save and reload keep the portal, and c_give is refused',
  async () => {
    const first = setup();
    let zip!: Uint8Array, records!: ReturnType<EntityRegistry['exportRecords']>;
    try {
      expect(
        (
          await executeDebugCommand(`c_spawn("${PORTAL_ID}")`, first.inventory, spawned =>
            first.registry.spawn(spawned),
          )
        ).ok,
      ).toBe(true);
      expect((await executeDebugCommand(`c_give("${PORTAL_ID}")`, first.inventory)).ok).toBe(false);
      records = first.registry.exportRecords();
      expect(records[PORTAL_ID]).toEqual([
        expect.objectContaining({ transform: { position: [12, 0, -6], rotationY: 0 }, components: {} }),
      ]);
      expect(records[PORTAL_FX_ID]).toBeUndefined();
      expect(
        (
          await executeDebugCommand('c_save()', first.inventory, undefined, async () => {
            zip = await createClusterSaveZip(first.save(), 'forest');
          })
        ).ok,
      ).toBe(true);
    } finally {
      first.dispose();
    }
    const files = unzipSync(zip),
      text = strFromU8(files['Cluster_1/Master.json']);
    const exported = JSON.parse(text) as { session: { playerFile: string } };
    const { player } = JSON.parse(strFromU8(files[`Cluster_1/${exported.session.playerFile}`])) as { player: unknown };
    const saved = deserializeSave(text, SAVE_CATALOG, player),
      second = setup();
    try {
      expect(saved.world.entities).toEqual(records);
      await second.registry.restoreAll(saved.world.entities);
      const portal = second.find(PORTAL_ID);
      expect(portal.entityId).toBe(records[PORTAL_ID][0].id);
      expect(portal.position.toArray()).toEqual([12, 0, -6]);
      expect(second.find(PORTAL_FX_ID).entityParent).toBe(portal);
      expect(second.registry.exportRecords()).toEqual(records);
    } finally {
      second.dispose();
    }
  },
  CLUSTER_SAVE_ZIP_TIMEOUT,
);
