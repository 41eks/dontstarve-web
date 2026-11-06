import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import { prefabDisplay } from '@dontstarve-web/display';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { chesspiecePrefabs, CHESSPIECE_MALBATROSS_MARBLE_ID, type ChesspieceInstance } from '../../prefab/src/chesspieces';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { PlacementSaveRecord } from '../../prefab/src/saveRecord';
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { createPickupInventory } from './pickupFixture';
import { workTargets } from './workTargets';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const ID = CHESSPIECE_MALBATROSS_MARBLE_ID;

function setup(playerPosition = new THREE.Vector3()) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const displays = new PrefabDisplayGroup(scene), dropped: string[] = [];
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { tickingarea: () => createMemo(() => awake.get()) });
  prefabs.register(chesspiecePrefabs({ scheduler, spawnGroundItem: definition => { dropped.push(definition.itemId); return undefined; } }) as never);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.chesspieces);
  const pieces = {
    /** SpawnSaveRecord. */
    spawn: (record: PlacementSaveRecord) => prefabs.spawn(ID, new THREE.Vector3(...record.transform.position), record) as ChesspieceInstance,
    exportRecords: () => prefabs.exportRecords().map(({ record }) => record),
  };
  const dispose = () => { registry.dispose(); prefabs.dispose(); displays.dispose(); scheduler.dispose(); };
  return { scene, awake, displays, pieces, prefabs, registry, dropped, dispose };
}
const sourceRecord: PlacementSaveRecord = { id: 'dst_session_chesspiece_malbatross_id_210775',
  transform: { position: [12, 0, -6], rotationY: 0 },
  components: { chesspiece: { materialid: 1 }, submersible: { force_no_repositioning: true } } };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('declares the Lua clip, tags and components when loaded from a save record', () => {
  const { pieces, dropped, dispose } = setup();
  try {
    const piece = pieces.spawn(sourceRecord);
    // fn: PlayAnimation("idle") without looping; onload only reapplies the material.
    expect(piece.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: false });
    expect(piece.listTags()).toEqual(expect.arrayContaining(['heavy', 'blocker']));
    expect(piece.listTags()).not.toContain('chess_moonevent');
    expect(Object.keys(piece.components)).toEqual(expect.arrayContaining(['heavyobstaclephysics', 'inspectable', 'lootdropper',
      'inventoryitem', 'equippable', 'workable', 'submersible', 'symbolswapdata', 'hauntable']));
    expect(pieces.exportRecords()).toEqual([sourceRecord]);
    // onworkfinished: one hammer hit drops the material's prefab and removes the piece.
    workTargets('HAMMER').find(target => target.id === sourceRecord.id)!.work();
    expect(dropped).toEqual(['marble']);
    expect(piece.isRemoved).toBe(true);
    expect(pieces.exportRecords()).toEqual([]);
  } finally { dispose(); }
});

it('rebuilds the declared clip after its tile sleeps and wakes', async () => {
  const { scene, awake, pieces, dispose } = setup();
  try {
    const piece = pieces.spawn(sourceRecord);
    const model = piece.transform.model;
    await prefabDisplay(model)!.artLoaded();
    expect(piece.sprite.loaded).toBe(true);
    awake.set(false); await settle();
    expect(piece.status.peek()).toBe('asleep');
    expect(piece.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true);
    await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(scene);
    expect(piece.sprite.loaded).toBe(true);
    expect(piece.sprite.currentAnimation).toBe('idle');
    expect(pieces.exportRecords()).toEqual([sourceRecord]);
  } finally { dispose(); }
});

it('keeps id, position, component fields and clip through c_spawn, c_save and a reload', async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)), second = setup(), inventory = createPickupInventory();
  try {
    expect((await executeDebugCommand(`c_spawn("${ID}")`, inventory, prefab => first.registry.spawn(prefab))).ok).toBe(true);
    expect((await executeDebugCommand(`c_give("${ID}")`, inventory)).ok).toBe(false);
    const before = first.registry.exportRecords();
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
        { entities: before, inventory: inventory.exportState(), elapsedSeconds: 1, playerTransform: { position: [3, 0, -6], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities[ID]!;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(before[ID]![0]);
    expect(saved[0]).toMatchObject({ transform: { position: [3, 0, -6] },
      components: { chesspiece: { materialid: 1 }, submersible: { force_no_repositioning: false } } });
    await second.registry.restoreAll({ [ID]: saved });
    const restored = second.prefabs.get(saved[0].id) as ChesspieceInstance;
    expect(restored.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: false });
    expect(second.pieces.exportRecords()).toEqual(saved);
  } finally { first.dispose(); second.dispose(); inventory.dispose(); }
});
