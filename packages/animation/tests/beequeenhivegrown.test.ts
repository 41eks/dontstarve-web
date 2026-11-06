import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { beeQueenHivePrefabs, BEEQUEENHIVEGROWN_ID, type BeeQueenHiveInstance } from '../../prefab/src/beequeenhivegrown';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { createInventoryStore } from '../../../src/inventory';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function setup(spawnAt = new THREE.Vector3(2, 0, 3)) {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true), physics = new CANNON.World();
  const displays = new PrefabDisplayGroup(scene), inventory = createInventoryStore([]);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { tickingarea: () => createMemo(() => awake.get()), physics });
  prefabs.register(beeQueenHivePrefabs({ scheduler }) as never);
  const registry = new EntityRegistry([], prefabs, () => spawnAt);
  registry.registerPrefabs(PREFAB_DEFINITIONS.beeQueenHives);
  const spawn = async () => {
    expect((await executeDebugCommand(`c_spawn("${BEEQUEENHIVEGROWN_ID}")`, inventory, id => registry.spawn(id))).ok).toBe(true);
    return prefabs.get(prefabs.exportRecords()[0].record.id) as BeeQueenHiveInstance;
  };
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = async () => {
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
        playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    return deserializeSave(json, SAVE_CATALOG).world.entities;
  };
  return { scene, scheduler, awake, displays, prefabs, registry, spawn, save,
    dispose: () => { registry.dispose(); prefabs.dispose(); displays.dispose(); inventory.dispose(); scheduler.dispose(); } };
}

it('declares the Lua large_hit then nonlooping large sequence on a hammer hit and c_save reloads its work and timer', async () => {
  const s = setup();
  let entities;
  try {
    const hive = await s.spawn(), model = hive.transform.model;
    await prefabDisplay(model)!.artLoaded();
    expect(hive.listTags()).toEqual(expect.arrayContaining(['event_trigger', 'antlion_sinkhole_blocker']));
    expect(hive.minimap.icon).toBe('beequeenhivegrown.png');
    expect(hive.physicsBody).toBeDefined();
    expect(model.scale.x).toBeCloseTo(1.4);
    expect(hive.sprite.sprite.peek().clip).toMatchObject({ name: 'large', loop: false });
    hive.components.workable.WorkedBy({});
    expect(hive.sprite.sprite.peek().clip).toMatchObject({ name: 'large_hit', loop: false });
    expect(hive.sprite.sprite.peek().queue).toEqual([{ name: 'large', loop: false }]);
    for (let i = 0; i < 120; i++) s.displays.update(.1);
    expect(hive.sprite.currentAnimation).toBe('large');
    hive.components.workable.WorkedBy({});
    entities = await s.save();
    expect(entities.beequeenhivegrown).toEqual([expect.objectContaining({ id: hive.entityId,
      transform: { position: [2, 0, 3], rotationY: 0 },
      components: { workable: { maxwork: 16, workleft: 14 },
        beeQueenHiveTimer: { timers: { hiveregen: expect.objectContaining({ timeleft: 120 }) } } } })]);
  } finally { s.dispose(); }

  const restored = setup();
  try {
    await restored.registry.restoreAll({ beequeenhivegrown: entities.beequeenhivegrown });
    const hive = restored.prefabs.get(entities.beequeenhivegrown[0].id) as BeeQueenHiveInstance;
    expect(hive.position.toArray()).toEqual([2, 0, 3]);
    expect(hive.components.workable.GetWorkLeft()).toBe(14);
    // RefreshHoneyState shows honey level 2 for 14 work left once the saved state loads.
    const honey = (level: number) => hive.sprite.sprite.peek().appearance.get(`archive-hidden:honey${level}`);
    expect(honey(2)).toMatchObject({ hidden: false }); expect(honey(3)).toMatchObject({ hidden: true });
    // The saved hiveregen timer resumes: one work back after its 120s, then one per segment.
    restored.scheduler.advance(120);
    expect(hive.components.workable.GetWorkLeft()).toBe(15);
    restored.scheduler.advance(30);
    expect(hive.components.workable.GetWorkLeft()).toBe(16);
  } finally { restored.dispose(); }
});

it('settles the hit on tile sleep and rebuilds the declared large pose and honey appearance', async () => {
  const s = setup(new THREE.Vector3(1, 0, 4));
  try {
    const hive = await s.spawn(), model = hive.transform.model;
    await prefabDisplay(model)!.artLoaded();
    hive.components.workable.WorkedBy({});
    s.awake.set(false); await settle();
    expect(hive.status.peek()).toBe('asleep');
    expect(hive.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    expect(hive.sprite.sprite.peek().clip).toMatchObject({ name: 'large', loop: false, finished: true });
    s.awake.set(true); await settle();
    expect(model.parent).toBe(s.scene);
    expect(hive.sprite.currentAnimation).toBe('large');
    expect(hive.sprite.sprite.peek().appearance.get('archive-hidden:honey3')).toMatchObject({ hidden: false });
  } finally { s.dispose(); }
});
