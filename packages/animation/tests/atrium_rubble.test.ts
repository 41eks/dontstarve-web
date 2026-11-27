import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { atriumRubblePrefabs, ATRIUM_RUBBLE_ID, AtriumRubbleInstance } from '../../prefab/src/atrium_rubble';
import { ATRIUM_RUBBLE_CONFIG } from '../../prefab/src/generated/atrium_rubble.schema';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { EntitySaveRecord } from '../../prefab/src/saveRecord';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { createPickupInventory } from './pickupFixture';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(playerPosition = new THREE.Vector3()) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))),
  );
  const scene = new THREE.Scene(),
    scheduler = new GameTimeScheduler(),
    awake = createSignal(true);
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {
    tickingarea: () => createMemo(() => awake.get()),
    scheduler,
  });
  const definitions = atriumRubblePrefabs({ scheduler });
  prefabs.register(definitions);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.atriumRubbles);
  const spawn = (record: EntitySaveRecord) => prefabs.restore(ATRIUM_RUBBLE_ID, record) as AtriumRubbleInstance;
  const records = () => registry.exportRecords().atrium_rubble ?? [];
  const requested = (archive: string) =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url]) =>
      String(url).endsWith(`/dst/data/anim/${archive}`),
    );
  const dispose = () => {
    registry.dispose();
    prefabs.dispose();
    displays.dispose();
    scheduler.dispose();
  };
  return { scene, awake, prefabs, registry, definitions, spawn, records, requested, dispose };
}
/** The imported default cave's rubble, as the game's save reader parses it. */
async function importedRubble(): Promise<EntitySaveRecord[]> {
  const cave = JSON.parse(
    await readFile(new URL('../../../public/saves/Cluster_1/Caves.json', import.meta.url), 'utf8'),
  );
  cave.players = { local: { ...initialWorld.players.local, shardId: cave.world.shardId } };
  return deserializeSave(JSON.stringify(cave), SAVE_CATALOG).world.entities.atrium_rubble! as EntitySaveRecord[];
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('loads the imported save records with the clip, tags, bank and components atrium_rubble.lua declares', async () => {
  const rubble = await importedRubble();
  expect(rubble).toHaveLength(25);
  // OnSave always writes animid; no story line has been handed out yet.
  const ids = rubble.map(record => record.components.atriumRubble?.animid);
  expect(new Set(ids)).toEqual(new Set([1, 2]));
  expect(rubble.every(record => record.components.atriumRubble?.storyprogress === undefined)).toBe(true);
  const { spawn, records, definitions, requested, dispose } = setup();
  try {
    // fn draws the other id first, so OnLoad's SetAnimId plays the saved clip over it.
    const two = rubble.find(record => record.components.atriumRubble!.animid === 2)!;
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const inst = spawn(two);
    vi.mocked(Math.random).mockRestore();
    // MakeObstaclePhysics's blocker, then inspectable's constructor tag.
    expect(inst.listTags()).toEqual(['blocker', 'inspectable']);
    // PlayAnimation("idle"..tostring(id)) without looping.
    expect(inst.animid).toBe(2);
    expect(inst.sprite.sprite.value).toMatchObject({
      clip: { name: 'idle2', loop: false },
      queue: [],
      billboard: true,
    });
    expect(definitions.atrium_rubble).toMatchObject({
      assets: { animationArchive: 'atrium_rubble.zip', buildArchives: ['atrium_rubble.zip'], bank: 'atrium_rubble' },
      physics: { radius: 0.5 },
      minimapIcon: 'atrium_rubble.png',
    });
    expect(Object.keys(inst.components)).toEqual(['inspectable', 'hauntable', 'roseinspectable']);
    expect(inst.scrapbook_specialinfo).toBe('ATRIUMRUBBLE');
    expect(inst.storyprogress).toBeUndefined();
    expect(records()).toEqual([two]);
    await prefabDisplay(inst.transform.model)!.artLoaded();
    expect(requested('atrium_rubble.zip')).toBe(true);
    expect(inst.sprite.currentAnimation).toBe('idle2');

    const one = rubble.find(record => record.components.atriumRubble!.animid === 1)!;
    const first = spawn(one);
    expect(first.sprite.sprite.value.clip).toMatchObject({ name: 'idle1', loop: false });
  } finally {
    dispose();
  }
});

it('rebuilds the declared clip and appearance after tile sleep, and spawns only the preset anim ids', async () => {
  const { scene, awake, spawn, records, prefabs, dispose } = setup();
  try {
    const saved: EntitySaveRecord = {
      id: 'sleeping-rubble',
      transform: { position: [1, 0, 3], rotationY: 0 },
      components: { atriumRubble: { animid: 2, storyprogress: 4 } },
    };
    const inst = spawn(saved);
    const model = inst.transform.model,
      before = inst.sprite.sprite.value;
    await prefabDisplay(model)!.artLoaded();
    awake.set(false);
    await settle();
    expect(inst.status.value).toBe('asleep');
    expect(inst.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true);
    await settle();
    await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(scene);
    expect(inst.sprite.currentAnimation).toBe('idle2');
    expect(inst.sprite.sprite.value.clip).toMatchObject({ name: 'idle2', loop: false });
    expect(inst.sprite.sprite.value.appearance).toEqual(before.appearance);
    expect(records()).toEqual([saved]);

    // fn's SetAnimId(inst, math.random(2)) on a fresh rubble: only ids of the preset, each with its clip.
    for (const draw of [0, 0.99]) {
      vi.spyOn(Math, 'random').mockReturnValue(draw);
      const fresh = prefabs.spawn(ATRIUM_RUBBLE_ID, new THREE.Vector3()) as AtriumRubbleInstance;
      vi.mocked(Math.random).mockRestore();
      expect(ATRIUM_RUBBLE_CONFIG.animIds).toContain(fresh.animid);
      expect(fresh.sprite.sprite.value.clip.name).toBe(`idle${fresh.animid}`);
    }
  } finally {
    dispose();
  }
});

it('keeps a c_spawn rubble through getstatus, c_save and a reload, and rejects c_give', async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)),
    second = setup(),
    inventory = createPickupInventory();
  try {
    expect(
      (await executeDebugCommand('c_spawn("atrium_rubble")', inventory, prefab => first.registry.spawn(prefab))).ok,
    ).toBe(true);
    expect((await executeDebugCommand('c_give("atrium_rubble")', inventory)).ok).toBe(false);
    const spawned = [...first.prefabs.instances(ATRIUM_RUBBLE_ID)][0] as AtriumRubbleInstance;
    // OnSave writes animid; storyprogress stays nil until an inspection.
    expect(first.records()[0]!.components).toEqual({ atriumRubble: { animid: spawned.animid } });
    // getstatus hands out the next story line once and keeps it.
    const status = spawned.components.inspectable.GetStatus();
    expect(status).toMatch(/^LINE_[1-5]$/);
    expect(spawned.components.inspectable.GetStatus()).toBe(status);
    const story = Number(status!.slice('LINE_'.length));
    const before = first.registry.exportRecords();
    let json = '';
    expect(
      (
        await executeDebugCommand('c_save()', inventory, undefined, () => {
          json = serializeSave(
            deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
            {
              entities: before,
              inventory: inventory.exportSaved(),
              elapsedSeconds: 1,
              playerTransform: { position: [3, 0, -6], rotationY: 0 },
            },
            SAVE_CATALOG,
          );
        })
      ).ok,
    ).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.atrium_rubble!;
    expect(saved).toEqual(before.atrium_rubble);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      id: spawned.entityId,
      transform: { position: [3, 0, -6] },
      components: { atriumRubble: { animid: spawned.animid, storyprogress: story } },
    });
    await second.registry.restoreAll({ atrium_rubble: saved });
    const loaded = second.prefabs.get(saved[0]!.id);
    if (!(loaded instanceof AtriumRubbleInstance)) {
      throw new Error('The saved rubble did not load');
    }
    expect(loaded.position.toArray()).toEqual([3, 0, -6]);
    expect(loaded.animid).toBe(spawned.animid);
    expect(loaded.sprite.sprite.value.clip).toMatchObject({ name: `idle${spawned.animid}`, loop: false });
    expect(loaded.storyprogress).toBe(story);
    expect(loaded.components.inspectable.GetStatus()).toBe(status);
    expect(second.records()).toEqual(saved);
  } finally {
    first.dispose();
    second.dispose();
    inventory.dispose();
  }
});
