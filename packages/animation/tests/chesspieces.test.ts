import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import { prefabDisplay } from '@dontstarve-web/display';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ChesspieceManager, CHESSPIECE_MALBATROSS_MARBLE_ID, type ChesspieceInstance, type ChesspieceRecord } from '../../prefab/src/chesspieces';
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

function setup() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const displays = new PrefabDisplayGroup(scene), dropped: string[] = [];
  const pieces = new ChesspieceManager(displays, { scheduler, tickingarea: () => createMemo(() => awake.get()),
    spawnGroundItem: definition => { dropped.push(definition.itemId); return undefined; } });
  const dispose = () => { pieces.dispose(); displays.dispose(); scheduler.dispose(); };
  return { scene, awake, pieces, dropped, dispose };
}
const sourceRecord: ChesspieceRecord = { id: 'dst_session_chesspiece_malbatross_id_210775',
  transform: { position: [12, 0, -6], rotationY: 0 },
  components: { chesspiece: { materialid: 1 }, submersible: { force_no_repositioning: true } } };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('declares the Lua clip, tags and components when loaded from a save record', () => {
  const { pieces, dropped, dispose } = setup();
  try {
    const piece = pieces.spawn(new THREE.Vector3(...sourceRecord.transform.position), sourceRecord);
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
    expect(pieces.exportRecords()).toEqual([]);
  } finally { dispose(); }
});

it('rebuilds the declared clip after its tile sleeps and wakes', async () => {
  const { scene, awake, pieces, dispose } = setup();
  try {
    const piece = pieces.spawn(new THREE.Vector3(...sourceRecord.transform.position), sourceRecord);
    const model = piece.model!;
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
  const first = setup(), second = setup(), inventory = createPickupInventory();
  const registry = new EntityRegistry(), playerPosition = new THREE.Vector3(3, 0, -6);
  registry.register(PREFAB_DEFINITIONS.chesspieces, {
    debugSpawn: () => first.pieces.spawn(playerPosition),
    restore: (_, record) => second.pieces.spawn(new THREE.Vector3(...record.transform.position), record as ChesspieceRecord),
    exportRecords: () => first.pieces.exportRecords().map(record => ({ prefabId: ID, record })),
  });
  try {
    expect((await executeDebugCommand(`c_spawn("${ID}")`, inventory, prefab => registry.spawn(prefab))).ok).toBe(true);
    expect((await executeDebugCommand(`c_give("${ID}")`, inventory)).ok).toBe(false);
    const before = registry.exportRecords();
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
    let restored: ChesspieceInstance | undefined;
    second.pieces.spawn = (spawn => (position, record) => (restored = spawn(position, record)))(second.pieces.spawn.bind(second.pieces));
    await registry.restoreAll({ [ID]: saved });
    expect(restored!.entityId).toBe(saved[0].id);
    expect(restored!.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: false });
    expect(second.pieces.exportRecords()).toEqual(saved);
  } finally { first.dispose(); second.dispose(); inventory.dispose(); }
});
