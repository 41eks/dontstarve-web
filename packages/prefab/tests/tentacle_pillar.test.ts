import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { createMemo, createSignal, GameTimeScheduler } from '@dontstarve-web/signals';
import { tentaclePillarPrefabs, TENTACLE_PILLAR_ID, TentaclePillarInstance } from '../src/tentacle_pillar';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../src/prefabInstance';
import type { EntityPersistData } from '../src/saveRecord';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { createClusterSaveZip } from '../../../src/save/download';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { CLUSTER_SAVE_ZIP_TIMEOUT } from '../../../tests/fixtures/importedSave';
import { bindTestWorld } from '../../../tests/fixtures/worldContentFixture';
import { createInventoryStore } from '../../../tests/fixtures/testInventory';

const at = new THREE.Vector3(3, 0, 6);
const record = (components: EntityPersistData = {}) => ({
  id: 'saved',
  transform: { position: [3, 0, 6] as [number, number, number], rotationY: 0 },
  components,
});

function setup() {
  const scene = new THREE.Scene(),
    awake = createSignal(true),
    scheduler = new GameTimeScheduler();
  const content = bindTestWorld(scheduler);
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {
    tickingarea: () => createMemo(() => awake.get()),
    scheduler,
  });
  prefabs.register(tentaclePillarPrefabs({ scheduler, getWatchWorldContent: content.getWatchWorldContent }));
  const registry = new EntityRegistry([], prefabs, () => new THREE.Vector3(12, 0, -6)),
    inventory = createInventoryStore([]);
  registry.registerPrefabs(PREFAB_DEFINITIONS.tentaclePillars);
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  return {
    scene,
    awake,
    scheduler,
    prefabs,
    registry,
    inventory,
    find: () =>
      scene.children
        .map(model => prefabInstance<TentaclePillarInstance>(model)!)
        .find(inst => inst.prefab === TENTACLE_PILLAR_ID) as TentaclePillarInstance,
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
      content.unbind();
    },
  };
}

const tags = (inst: PrefabInstance) => inst.listTags();
const artLoaded = (inst: PrefabInstance) => prefabDisplay(inst.transform.model)!.artLoaded();
const requested = (archive: string) =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url]) =>
    String(url).endsWith(`/dst/data/anim/${archive}`),
  );

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('save records load with the clip, tags, bank and components their Lua declares', async () => {
  const s = setup();
  try {
    const pillar = s.prefabs.spawnAs(TentaclePillarInstance, TENTACLE_PILLAR_ID, at, record());
    expect(tags(pillar)).toEqual(['blocker', 'cavedweller', 'tentacle_pillar', 'wet', 'NPCcanaggro', 'inspectable']);
    expect(pillar.sprite.sprite.value).toMatchObject({ clip: { name: 'idle', loop: true }, billboard: true });
    expect(pillar.physics.json.value!.capsule).toEqual({ radius: 2, height: 24 });
    expect(pillar.getPhysicsRadius()).toBeCloseTo(2 * 3);
    expect(pillar.minimap.icon).toBe('tentacle_pillar.png');
    expect(pillar.components.health.maxhealth).toBe(750);
    expect(pillar.components.health.nofadeout).toBe(true);
    expect(pillar.components.combat.onhitfn).toBeDefined();
    expect(pillar.components.playerprox).toBeDefined();
    expect(pillar.components.lootdropper).toBeDefined();
    expect(pillar.components.inspectable).toBeDefined();
    await artLoaded(pillar);
    expect(requested('tentacle_pillar.zip')).toBe(true);
    expect(pillar.sprite.currentAnimation).toBe('idle');
    // OnSave: a fresh pillar keeps only its Health record; overtaken is absent until set.
    expect(pillar.GetPersistData()).toEqual({ health: { health: 750, maxhealth: 750 } });

    // A saved overtaken flag restores the field and survives the round trip; a damaged pillar keeps its health.
    const overtaken = s.prefabs.spawnAs(
      TentaclePillarInstance,
      TENTACLE_PILLAR_ID,
      at,
      record({ overtaken: true, health: { health: 500, maxhealth: 750 } }),
    );
    expect(overtaken.overtaken).toBe(true);
    expect(overtaken.components.health.currenthealth).toBe(500);
    expect(overtaken.GetPersistData()).toEqual({ overtaken: true, health: { health: 500, maxhealth: 750 } });
  } finally {
    s.dispose();
  }
});

it('sleeping releases the sprite and waking restores the declared clip', async () => {
  const s = setup();
  try {
    const pillar = s.prefabs.spawnAs(TentaclePillarInstance, TENTACLE_PILLAR_ID, at, record());
    await artLoaded(pillar);
    const before = s.prefabs.exportRecords();

    s.awake.set(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(pillar.status.value).toBe('asleep');
    expect(pillar.sprite.loaded).toBe(false);

    s.awake.set(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    await artLoaded(pillar);
    expect(pillar.sprite.currentAnimation).toBe('idle');
    expect(pillar.sprite.sprite.value.clip).toMatchObject({ name: 'idle', loop: true });
    expect(s.prefabs.exportRecords()).toEqual(before);
  } finally {
    s.dispose();
  }
});

it(
  'c_spawn, c_save and reload keep the pillar, and c_give is refused',
  async () => {
    const first = setup();
    let zip!: Uint8Array, records!: ReturnType<EntityRegistry['exportRecords']>;
    try {
      expect(
        (
          await executeDebugCommand(`c_spawn("${TENTACLE_PILLAR_ID}")`, first.inventory, spawned =>
            first.registry.spawn(spawned),
          )
        ).ok,
      ).toBe(true);
      expect((await executeDebugCommand(`c_give("${TENTACLE_PILLAR_ID}")`, first.inventory)).ok).toBe(false);
      records = first.registry.exportRecords();
      expect(records[TENTACLE_PILLAR_ID]).toHaveLength(1);
      expect(records[TENTACLE_PILLAR_ID][0]).toMatchObject({
        transform: { position: [12, 0, -6] },
        components: { health: { health: 750, maxhealth: 750 } },
      });
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
      const pillar = second.find();
      expect(pillar.entityId).toBe(records[TENTACLE_PILLAR_ID][0].id);
      expect(pillar.position.toArray()).toEqual([12, 0, -6]);
      expect(pillar.sprite.sprite.value.clip).toMatchObject({ name: 'idle', loop: true });
      expect(pillar.components.health.maxhealth).toBe(750);
      expect(second.registry.exportRecords()).toEqual(records);
    } finally {
      second.dispose();
    }
  },
  CLUSTER_SAVE_ZIP_TIMEOUT,
);
