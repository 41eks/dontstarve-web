import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { createMemo, createSignal, GameTimeScheduler } from '@dontstarve-web/signals';
import { atriumGatePrefabs, ATRIUM_GATE_ID, type AtriumGateInstance } from '../../prefab/src/atrium_gate';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { PlacementSaveRecord } from '../../prefab/src/saveRecord';
import { Pathfinder } from '../../prefab/src/pathfinder';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { createInventoryStore } from '../../../src/inventory';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { createClusterSaveZip } from '../../../src/save/download';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const record = (x: number, components: PlacementSaveRecord['components']) =>
  ({ id: `atrium-${x}`, transform: { position: [x, 0, 7] as [number, number, number], rotationY: 0 }, components });

function setup(pathfinder?: Pathfinder) {
  const scene = new THREE.Scene(), awake = createSignal(true), scheduler = new GameTimeScheduler();
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { tickingarea: () => createMemo(() => awake.get()) });
  prefabs.register(atriumGatePrefabs({ scheduler, pathfinder, spawnPrefab: (id, position) => prefabs.spawn(id, position) }) as never);
  const registry = new EntityRegistry([], prefabs, () => new THREE.Vector3(12, 0, -6)), inventory = createInventoryStore([]);
  registry.registerPrefabs(PREFAB_DEFINITIONS.atriumGates);
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const instances = (prefab: string) => scene.children.map(model => prefabInstance<PrefabInstance>(model)!).filter(inst => inst?.prefab === prefab && !inst.isRemoved);
  return { scene, awake, prefabs, registry, inventory, instances,
    gate: (components: PlacementSaveRecord['components'], x = 5) =>
      prefabs.spawn(ATRIUM_GATE_ID, new THREE.Vector3(x, 0, 7), record(x, components)) as AtriumGateInstance,
    save: () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
      playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG),
    dispose() { registry.dispose(); prefabs.dispose(); displays.dispose(); inventory.dispose(); scheduler.dispose(); } };
}

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('restores the source save states with their clips, build, children and component records', async () => {
  const s = setup();
  try {
    const gate = s.gate({ pickable: { picked: true } });
    expect(gate.listTags()).toEqual(expect.arrayContaining(['gemsocket', 'stargate', 'give_dolongaction']));
    expect(gate.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: false });
    expect(gate.sprite.sprite.peek().queue).toEqual([]);
    // An unrepaired gate draws only SetBuild("atrium_gate"), never pieces of the repaired build.
    expect(gate.sprite.sprite.peek().appearance.get('archive-build')).toMatchObject({ archive: 'atrium_gate.zip' });
    expect(gate.minimap.json.peek()).toMatchObject({ icon: 'atrium_gate.png' });
    const [floor] = s.instances('atrium_gate_floor');
    expect(floor.listTags()).toEqual(['DECOR', 'NOCLICK']);
    expect(s.instances('atrium_gate_terraform_blocker')).toHaveLength(24);
    const exported = s.prefabs.exportRecords();
    // Children are never saved, and the gate's record parses back to itself.
    expect(exported.map(({ prefabId }) => prefabId)).toEqual([ATRIUM_GATE_ID]);
    expect(exported[0].record).toMatchObject({ id: 'atrium-5', components: { pickable: { picked: true } } });
    expect(PREFAB_DEFINITIONS.atriumGates.parseComponents(exported[0].record.components, 'atrium', {} as never)).toEqual(exported[0].record.components);
    await prefabDisplay(gate.transform.model)!.artLoaded();
    expect(gate.sprite.currentAnimation).toBe('idle');

    const cooldownSave = { charliecutscene: { gatefixed: true as const }, worldsettingstimer: { timers: { cooldown: { timeleft: .5, paused: false } } } };
    const cooldown = s.gate(cooldownSave, 8);
    expect(cooldown.sprite.sprite.peek().clip).toMatchObject({ name: 'cooldown', loop: true });
    expect(cooldown.sprite.sprite.peek().appearance.get('archive-build')).toMatchObject({ archive: 'atrium_gate_build.zip' });
    expect(cooldown.minimap.json.peek()).toMatchObject({ icon: 'atrium_gate_fixed.png' });
    expect(cooldown.GetPersistData()).toEqual({ pickable: { picked: true }, ...cooldownSave });

    const destabilizing = s.gate({ atriumGate: { vault_key_socketed: true }, worldsettingstimer: { timers: { destabilizing: { timeleft: .5, paused: false } } } }, 11);
    expect(destabilizing.sprite.sprite.peek()).toMatchObject({ clip: { name: 'overload_pre', loop: false },
      queue: [expect.objectContaining({ name: 'overload_loop', loop: true })] });
    expect(destabilizing.sprite.sprite.peek().appearance.get('layer:KEY')).toEqual({ kind: 'layer', layer: 'KEY', hidden: false });
    const [fx] = s.instances('atrium_gate_activatedfx');
    expect(fx.listTags()).toEqual(['DECOR', 'NOCLICK']);
    // Its display is already up when SetFX plays: the unloaded pre settles per ResidentSprite's contract into the queued loop.
    expect(fx.sprite.sprite.peek().clip).toMatchObject({ name: 'overload_loop', loop: true });

    // OnKeyGiven with a queued destabilize: interaction is off again, so the save drops caninteractwith.
    const delayed = s.gate({ pickable: { picked: true, caninteractwith: true }, worldsettingstimer: { timers: { destabilizedelay: { timeleft: .5, paused: false } } } }, 14);
    expect(delayed.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_fight', loop: true });
    expect(delayed.hasTag('intense')).toBe(false);
    expect(delayed.minimap.json.peek()).toMatchObject({ icon: 'atrium_gate_active.png' });
    expect(delayed.GetPersistData().pickable).toBeUndefined();
    const powered = s.gate({ pickable: { picked: true, caninteractwith: true } }, 17);
    expect(powered.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_active' });
    expect(powered.GetPersistData().pickable).toEqual({ caninteractwith: true });

    destabilizing.remove();
    expect(fx.isRemoved).toBe(true);
  } finally { s.dispose(); }
});

it('rebuilds the declared idle clip and floor after tile sleep', async () => {
  const s = setup();
  try {
    const gate = s.gate({ pickable: { picked: true } }, 1);
    const [floor] = s.instances('atrium_gate_floor');
    await prefabDisplay(gate.transform.model)!.artLoaded(); await prefabDisplay(floor.transform.model)!.artLoaded();
    s.awake.set(false); await turn();
    expect(gate.status.peek()).toBe('asleep');
    expect([gate.sprite.loaded, floor.sprite.loaded]).toEqual([false, false]);
    expect(gate.transform.model.parent).toBeNull();
    s.awake.set(true); await turn();
    expect(gate.transform.model.parent).toBe(s.scene);
    expect(gate.sprite.currentAnimation).toBe('idle');
    expect(floor.sprite.currentAnimation).toBe('idle_active');
    await prefabDisplay(floor.transform.model)!.artLoaded();
    // LAYER_BACKGROUND: its own mesh draws after every turf layer (< -0.6), outside the depth-writing instance batch.
    const meshes = floor.transform.model.getObjectsByProperty('isMesh', true) as THREE.Mesh[];
    expect(meshes.filter(mesh => mesh.visible).map(mesh => mesh.renderOrder)).toEqual([-.56]);
    for (let node = meshes[0].parent; node && node !== floor.transform.model; node = node.parent) expect(node.renderOrder).toBe(0);
  } finally { s.dispose(); }
});

it('walls off its 2×2 path tiles until it is removed', () => {
  const pathfinder = new Pathfinder({ isPassableAtPoint: () => true, isOceanAtWorld: () => false });
  const s = setup(pathfinder);
  const clear = (z: number) => pathfinder.IsClear({ x: 0, y: 0, z }, { x: 12, y: 0, z });
  const gate = s.prefabs.spawn(ATRIUM_GATE_ID, new THREE.Vector3(6, 0, 6));
  // Each of the four corners stands .5 DST units (1.5 here) from the centre.
  expect([clear(4.5), clear(7.5), clear(0), clear(12)]).toEqual([false, false, true, true]);
  gate.remove();
  expect([clear(4.5), clear(7.5)]).toEqual([true, true]);
  expect(s.instances('atrium_gate_floor')).toEqual([]);
  s.dispose();
});

it('c_spawn, c_save and reload keep the gate records, and c_give is refused', async () => {
  const first = setup(); let zip!: Uint8Array, records!: ReturnType<EntityRegistry['exportRecords']>;
  try {
    await first.registry.restoreAll({ atrium_gate: [record(8, { pickable: { picked: true }, charliecutscene: { gatefixed: true } })] });
    expect((await executeDebugCommand('c_spawn("atrium_gate")', first.inventory, spawned => first.registry.spawn(spawned))).ok).toBe(true);
    expect((await executeDebugCommand('c_give("atrium_gate")', first.inventory)).ok).toBe(false);
    records = first.registry.exportRecords();
    expect(records.atrium_gate).toEqual([
      expect.objectContaining({ id: 'atrium-8', components: { pickable: { picked: true }, charliecutscene: { gatefixed: true } } }),
      expect.objectContaining({ transform: { position: [12, 0, -6], rotationY: 0 }, components: { pickable: { picked: true } } }),
    ]);
    expect(Object.keys(records)).toEqual(['atrium_gate']);
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
    const gates = second.instances(ATRIUM_GATE_ID);
    expect(gates.map(gate => [gate.entityId, gate.sprite.sprite.peek().clip.name])).toEqual(records.atrium_gate.map(({ id }) => [id, 'idle']));
    expect(second.registry.exportRecords()).toEqual(records);
  } finally { second.dispose(); }
});
