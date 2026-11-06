import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { PILLAR_RUINS_ID, pillarPrefabs } from '../../prefab/src/pillar';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { createInventoryStore } from '../../../src/inventory';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { createClusterSaveZip } from '../../../src/save/download';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { CLUSTER_SAVE_ZIP_TIMEOUT } from './importedSave';

const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const record = { id: 'saved-pillar', transform: { position: [3, 0, 6] as [number, number, number], rotationY: 0 }, components: {} };

function setup() {
  const scene = new THREE.Scene(), awake = createSignal(true);
  const tickingarea = () => createMemo(() => awake.get());
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { tickingarea });
  prefabs.register(pillarPrefabs() as never);
  const registry = new EntityRegistry([], prefabs, () => new THREE.Vector3(12, 0, -6)), inventory = createInventoryStore([]);
  registry.registerPrefabs(PREFAB_DEFINITIONS.pillarRuins);
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  return { scene, awake, prefabs, registry, inventory,
    pillar: () => scene.children.map(model => prefabInstance<PrefabInstance>(model)!).find(inst => inst.prefab === PILLAR_RUINS_ID)!,
    save: () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
      playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG),
    dispose() { registry.dispose(); prefabs.dispose(); displays.dispose(); inventory.dispose(); } };
}
const artLoaded = (inst: PrefabInstance) => prefabDisplay(inst.transform.model)!.artLoaded();

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('restores a saved pillar with its Lua clip, tags, bank and obstacle', async () => {
  const s = setup();
  try {
    const pillar = s.prefabs.spawn(PILLAR_RUINS_ID, new THREE.Vector3(3, 0, 6), record);
    for (const tag of ['charge_barrier', 'quake_on_charge', 'blocker']) expect(pillar.hasTag(tag)).toBe(true);
    expect(pillar.hasTag('NOBLOCK')).toBe(false);
    expect(pillar.sprite.sprite.peek()).toMatchObject({ clip: { name: 'idle', loop: true }, queue: [], billboard: true });
    expect(pillar.getPhysicsRadius()).toBeCloseTo(2.35 * 3);
    expect(pillar.physics.json.peek()!.capsule.height).toBe(2);
    await artLoaded(pillar);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/dst/data/anim/pillar_ruins.zip'));
    expect(pillar.sprite.currentAnimation).toBe('idle');
    expect(s.registry.exportRecords().pillar_ruins).toEqual([record]);
  } finally { s.dispose(); }
});

it('sleeping releases the sprite and waking rebuilds the declared looping clip', async () => {
  const s = setup();
  try {
    const pillar = s.prefabs.spawn(PILLAR_RUINS_ID, new THREE.Vector3(3, 0, 6), record);
    await artLoaded(pillar);
    const before = s.registry.exportRecords();
    s.awake.set(false); await turn();
    expect(pillar.status.peek()).toBe('asleep');
    expect(pillar.sprite.loaded).toBe(false);
    s.awake.set(true); await turn();
    await artLoaded(pillar);
    expect(pillar.sprite.loaded).toBe(true);
    expect(pillar.sprite.currentAnimation).toBe('idle');
    expect(pillar.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: true });
    expect(s.registry.exportRecords()).toEqual(before);
  } finally { s.dispose(); }
});

it('c_spawn, c_save and reload keep the id, position and clip, and c_give is refused', async () => {
  const first = setup(); let zip!: Uint8Array, records!: ReturnType<EntityRegistry['exportRecords']>;
  try {
    expect((await executeDebugCommand('c_spawn("pillar_ruins")', first.inventory, id => first.registry.spawn(id))).ok).toBe(true);
    expect((await executeDebugCommand('c_give("pillar_ruins")', first.inventory)).ok).toBe(false);
    records = first.registry.exportRecords();
    expect(records.pillar_ruins).toHaveLength(1);
    expect(records.pillar_ruins[0]).toMatchObject({ transform: { position: [12, 0, -6] }, components: {} });
    expect((await executeDebugCommand('c_save()', first.inventory, undefined, async () => {
      zip = await createClusterSaveZip(first.save(), 'forest');
    })).ok).toBe(true);
  } finally { first.dispose(); }
  const files = unzipSync(zip), text = strFromU8(files['Cluster_1/Master.json']);
  const exported = JSON.parse(text) as { session: { playerFile: string } };
  const { player } = JSON.parse(strFromU8(files[`Cluster_1/${exported.session.playerFile}`])) as { player: unknown };
  const saved = deserializeSave(text, SAVE_CATALOG, player), second = setup();
  try {
    expect(saved.world.entities).toEqual(records);
    await second.registry.restoreAll(saved.world.entities);
    const pillar = second.pillar();
    expect(pillar.entityId).toBe(records.pillar_ruins[0].id);
    expect(pillar.position.toArray()).toEqual([12, 0, -6]);
    expect(pillar.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: true });
    await artLoaded(pillar);
    expect(pillar.sprite.currentAnimation).toBe('idle');
    expect(second.registry.exportRecords()).toEqual(records);
  } finally { second.dispose(); }
}, CLUSTER_SAVE_ZIP_TIMEOUT);
