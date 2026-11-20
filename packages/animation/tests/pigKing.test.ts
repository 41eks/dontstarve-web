import { fixedCamera } from '../../prefab/src/followcamera';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { pigKingPrefabs, PIGKING_ID, PigKingInstance } from '../../prefab/src/pigking';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindTestWorld } from './worldContentFixture';
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

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), physics = new CANNON.World();
  const world = bindTestWorld(scheduler), displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { physics });
  prefabs.register(pigKingPrefabs({ TheCamera: fixedCamera(45), scheduler, getWatchWorldContent: world.getWatchWorldContent, dropLoot: vi.fn() }));
  const registry = new EntityRegistry([], prefabs, () => new THREE.Vector3(12, 0, -6)), inventory = createInventoryStore([]);
  registry.registerPrefabs(PREFAB_DEFINITIONS.pigKings);
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  return { scene, scheduler, physics, world, prefabs, registry, inventory,
    king: () => scene.children.map(model => prefabInstance<PrefabInstance>(model)!).find(inst => inst?.prefab === PIGKING_ID) as PigKingInstance,
    save: () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportSaved(), elapsedSeconds: 0,
      playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG),
    dispose() { registry.dispose(); prefabs.dispose(); displays.dispose(); inventory.dispose(); world.unbind(); scheduler.dispose(); } };
}

describe('Pig King prefab', () => {
  it('stands on its feet with obstacle physics, the Lua tags and a camera-facing sprite', async () => {
    const s = setup();
    try {
      const king = s.prefabs.spawnAs(PigKingInstance, PIGKING_ID, new THREE.Vector3(-13, 2, -25));
      expect(king.listTags()).toEqual(['blocker', 'king', 'birdblocker', 'antlion_sinkhole_blocker', 'inspectable', 'trader']);
      // pigking.lua MakeObstaclePhysics(inst, 2, .5): a static body on the feet origin; the height is dropped.
      const body = king.physicsBody!;
      expect(s.physics.bodies).toContain(body);
      expect(king.position.toArray()).toEqual([-13, 0, -25]);
      expect(king.getPhysicsRadius(undefined)).toBe(6);
      expect(king.minimap.peek()).toMatchObject({ icon: 'pigking.png', priority: 1 });
      expect(king.sprite.sprite.peek()).toMatchObject({ clip: { name: 'idle', loop: true }, billboard: true, depthOffset: true });
      await prefabDisplay(king.transform.model)!.artLoaded();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(king.sprite.currentAnimation).toBe('idle');
      // alignBottom: the art's lowest point is on the feet.
      expect(new THREE.Box3().setFromObject(king.transform.model).min.y).toBeCloseTo(0);
      king.remove();
      expect(s.physics.bodies).not.toContain(body);
      expect(king.hasTag('trader')).toBe(false);
      expect(king.minimap.peek().enabled).toBe(false);
    } finally { s.dispose(); }
  });

  it('c_spawn, c_save and reload keep its identity and position, and c_give is refused', async () => {
    const first = setup(); let zip!: Uint8Array, records!: ReturnType<EntityRegistry['exportRecords']>;
    try {
      expect((await executeDebugCommand(`c_spawn("${PIGKING_ID}")`, first.inventory, id => first.registry.spawn(id))).ok).toBe(true);
      expect((await executeDebugCommand(`c_give("${PIGKING_ID}")`, first.inventory)).ok).toBe(false);
      records = first.registry.exportRecords();
      // pigking.lua has no OnSave.
      expect(records.pigking).toEqual([{ id: first.king().entityId, transform: { position: [12, 0, -6], rotationY: 0 }, components: {} }]);
      expect((await executeDebugCommand('c_save()', first.inventory, undefined, async () => {
        zip = await createClusterSaveZip(first.save(), 'forest');
      })).ok).toBe(true);
    } finally { first.dispose(); }
    const files = unzipSync(zip), text = strFromU8(files['Cluster_1/Master.json']);
    const exported = JSON.parse(text) as { session: { playerFile: string } };
    const { player } = JSON.parse(strFromU8(files[`Cluster_1/${exported.session.playerFile}`])) as { player: unknown };
    const saved = deserializeSave(text, SAVE_CATALOG, player), second = setup();
    try {
      expect(saved.world.entities.pigking).toEqual(records.pigking);
      await second.registry.restoreAll({ pigking: saved.world.entities.pigking });
      expect(second.king().entityId).toBe(records.pigking[0].id);
      expect(second.registry.exportRecords()).toEqual(records);
    } finally { second.dispose(); }
  }, CLUSTER_SAVE_ZIP_TIMEOUT);
});

it('ends its clips on game time while its art never loads', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  const s = setup();
  const king = s.prefabs.spawnAs(PigKingInstance, PIGKING_ID, new THREE.Vector3(-13, 2, -25));
  try {
    // unimpressed is 56 frames; its animover returns SGpigking to idle.
    king.pigking.goToState('unimpressed');
    s.scheduler.advance(55.5 / 30);
    expect(king.pigking.stateName).toBe('unimpressed');
    s.scheduler.advance(1 / 30);
    expect(king.pigking.stateName).toBe('idle');
    expect(king.sprite.loaded).toBe(false);
  } finally { s.dispose(); }
});
