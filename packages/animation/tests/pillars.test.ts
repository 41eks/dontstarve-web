import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { createMemo, createSignal, GameTimeScheduler } from '@dontstarve-web/signals';
import { CAVE_PILLAR_IDS, pillarPrefabs } from '../../prefab/src/pillar';
import { atriumPillarPrefabs, PILLAR_ATRIUM_ID } from '../../prefab/src/atrium_pillar';
import { archivePillarPrefabs, ARCHIVE_PILLAR_ID, type ArchivePillarInstance } from '../../prefab/src/archive_pillar';
import { vaultPillarPrefabs, VAULT_PILLAR_ID, type VaultPillarInstance } from '../../prefab/src/vault_pillar';
import { monkeyPillarPrefabs, MONKEYPILLAR_ID, type MonkeyPillarInstance } from '../../prefab/src/monkeypillar';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { PlacementSaveRecord } from '../../prefab/src/saveRecord';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { createInventoryStore } from '../../../src/inventory';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { createClusterSaveZip } from '../../../src/save/download';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

const IDS = [...CAVE_PILLAR_IDS, PILLAR_ATRIUM_ID, ARCHIVE_PILLAR_ID, VAULT_PILLAR_ID, MONKEYPILLAR_ID];
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const at = new THREE.Vector3(3, 0, 6);
const record = (components: PlacementSaveRecord['components'] = {}) => ({ id: 'saved', transform: { position: [3, 0, 6] as [number, number, number], rotationY: 0 }, components });

function setup() {
  const scene = new THREE.Scene(), awake = createSignal(true), scheduler = new GameTimeScheduler();
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { tickingarea: () => createMemo(() => awake.get()) });
  for (const declared of [pillarPrefabs(), atriumPillarPrefabs(), archivePillarPrefabs(), monkeyPillarPrefabs({ scheduler }),
    vaultPillarPrefabs({ spawnPrefab: (id, position) => prefabs.spawn(id, position) })]) prefabs.register(declared as never);
  const registry = new EntityRegistry([], prefabs, () => new THREE.Vector3(12, 0, -6)), inventory = createInventoryStore([]);
  for (const definition of [PREFAB_DEFINITIONS.cavePillars, PREFAB_DEFINITIONS.atriumPillars, PREFAB_DEFINITIONS.archivePillars,
    PREFAB_DEFINITIONS.vaultPillars, PREFAB_DEFINITIONS.monkeyPillars]) registry.registerPrefabs(definition);
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  return { scene, awake, scheduler, prefabs, registry, inventory,
    find: <Instance extends PrefabInstance = PrefabInstance>(id: string) => scene.children.map(model => prefabInstance<PrefabInstance>(model)!).find(inst => inst.prefab === id) as Instance,
    save: () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
      playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG),
    dispose() { registry.dispose(); prefabs.dispose(); displays.dispose(); inventory.dispose(); scheduler.dispose(); } };
}
/** The Lua tags, in order; `tickingarea` is this project's own activity tag. */
const tags = (inst: PrefabInstance) => inst.listTags().filter(tag => tag !== 'tickingarea');
const artLoaded = (inst: PrefabInstance) => prefabDisplay(inst.transform.model)!.artLoaded();
const requested = (archive: string) => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).endsWith(`/dst/data/anim/${archive}`));
/** Frames the drawn clip to its end, as the display group does: its animover replaces the declared clip, even with one of the same name. */
const finishClip = async (inst: PrefabInstance) => {
  const clip = inst.sprite.sprite.peek().clip;
  for (let frame = 0; frame < 300 && inst.sprite.sprite.peek().clip === clip; frame++) inst.sprite.update(1 / 30);
  expect(inst.sprite.sprite.peek().clip).not.toBe(clip);
  await turn();
};

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('save records load with the clip, tags and bank their Lua declares', async () => {
  const s = setup();
  try {
    for (const id of CAVE_PILLAR_IDS) {
      const pillar = s.prefabs.spawn(id, at, record());
      expect(tags(pillar)).toEqual(['blocker']);
      expect(pillar.sprite.sprite.peek()).toMatchObject({ clip: { name: 'idle', loop: true }, billboard: true });
      expect(pillar.getPhysicsRadius()).toBeCloseTo(2.35 * 3);
      await artLoaded(pillar);
      expect(requested(`${id}.zip`)).toBe(true);
      expect(pillar.sprite.currentAnimation).toBe('idle');
      pillar.remove();
    }

    const atrium = s.prefabs.spawn(PILLAR_ATRIUM_ID, at, record());
    expect(tags(atrium)).toEqual(['blocker', 'groundhole', 'pillar_atrium']);
    expect(atrium.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: true });
    expect(atrium.physics.json.peek()!.capsule).toEqual({ radius: 2.35, height: 6 });
    await artLoaded(atrium);
    expect(requested('pillar_atrium.zip')).toBe(true);

    // choosebroken: a saved true sets the broken bank; a saved false never restores what the constructor's roll picked.
    const random = vi.spyOn(Math, 'random').mockReturnValue(.5);
    const whole = s.prefabs.spawn(ARCHIVE_PILLAR_ID, at, record({ broken: false })) as ArchivePillarInstance;
    expect(tags(whole)).toEqual(['blocker', 'archive_pillar']);
    expect(whole.physics.json.peek()!.capsule).toEqual({ radius: 1.8, height: 6 });
    expect(whole.minimap.icon).toBe('pillar_archive.png');
    expect(whole.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: true });
    await artLoaded(whole);
    expect(requested('pillar_archive.zip')).toBe(true);
    expect(requested('pillar_archive_broken.zip')).toBe(false);
    const broken = s.prefabs.spawn(ARCHIVE_PILLAR_ID, at, record({ broken: true })) as ArchivePillarInstance;
    expect(broken.bank).toBe('pillar_archive_broken');
    await artLoaded(broken);
    expect(requested('pillar_archive_broken.zip')).toBe(true);
    expect(broken.GetPersistData()).toEqual({ broken: true });
    random.mockReturnValue(.1);
    const rolled = s.prefabs.spawn(ARCHIVE_PILLAR_ID, at, record({ broken: false })) as ArchivePillarInstance;
    expect([rolled.broken, rolled.bank]).toEqual([false, 'pillar_archive_broken']);
    random.mockRestore();

    const clips = { idle_upper: {}, idle_upper_capped: { capped: 1 }, idle_upper_capped_2: { capped: 2 }, idle_upper_broken: { broken: 1 } } as const;
    for (const [clip, components] of Object.entries(clips)) {
      const vault = s.prefabs.spawn(VAULT_PILLAR_ID, at, record(components)) as VaultPillarInstance;
      expect(tags(vault)).toEqual(['decor', 'nomagic', 'nohighlight']);
      expect(vault.sprite.sprite.peek().clip).toMatchObject({ name: clip, loop: false });
      await artLoaded(vault);
      expect(vault.sprite.currentAnimation).toBe(clip);
      expect(vault.GetPersistData()).toEqual(components);
      vault.remove();
    }
    expect(requested('pillar_vault_deep.zip')).toBe(true);
    const vault = s.prefabs.spawn(VAULT_PILLAR_ID, at, record());
    const bottom = s.find('vault_pillar_bottom');
    expect(tags(bottom)).toEqual(['decor', 'NOCLICK']);
    expect(bottom.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_lower', loop: false });
    expect(s.prefabs.exportRecords().map(entry => entry.prefabId)).not.toContain('vault_pillar_bottom');
    vault.remove();
    expect(bottom.isRemoved).toBe(true);

    // AnimState starts empty; OnLoad's setpillartype plays the saved idle once and animover chains the next.
    const monkey = s.prefabs.spawn(MONKEYPILLAR_ID, at, record({ pillar_id: 3 })) as MonkeyPillarInstance;
    expect(tags(monkey)).toEqual(['blocker', 'SnowCovered', 'inspectable']);
    expect(monkey.sprite.sprite.peek()).toMatchObject({ clip: { name: 'idle3', loop: false }, frame: { at: expect.any(Number) }, lightOverride: .25 });
    expect(monkey.physics.json.peek()!.capsule).toEqual({ radius: .6, height: 24 });
    expect(monkey.light.peek()).toMatchObject({ intensity: .6, falloff: .8 });
    await artLoaded(monkey);
    expect(requested('pillar_monkey.zip') && requested('snow.zip')).toBe(true);
    await finishClip(monkey);
    expect(monkey.sprite.sprite.peek().clip).toMatchObject({ name: 'idle3', loop: false, finished: false });
    s.scheduler.advance(26);
    await finishClip(monkey);
    expect(monkey.sprite.sprite.peek().clip).toMatchObject({ name: 'idle3_move', loop: false, finished: false });
    await finishClip(monkey);
    expect(monkey.sprite.sprite.peek().clip.name).toBe('idle3');
    expect(monkey.GetPersistData()).toEqual({ pillar_id: 3 });
  } finally { s.dispose(); }
});

it('sleeping releases the sprite and waking restores the declared clip and appearance', async () => {
  const s = setup();
  try {
    const looping = s.prefabs.spawn('pillar_cave', at, record());
    const broken = s.prefabs.spawn(ARCHIVE_PILLAR_ID, at, record({ broken: true })) as ArchivePillarInstance;
    const capped = s.prefabs.spawn(VAULT_PILLAR_ID, at, record({ capped: 2 }));
    const monkey = s.prefabs.spawn(MONKEYPILLAR_ID, at, record({ pillar_id: 2 })) as MonkeyPillarInstance;
    const pillars = [looping, broken, capped, monkey] as PrefabInstance[];
    await Promise.all(pillars.map(artLoaded));
    const before = s.prefabs.exportRecords();

    s.awake.set(false); await turn();
    for (const pillar of pillars) {
      expect(pillar.status.peek()).toBe('asleep');
      expect(pillar.sprite.loaded).toBe(false);
    }
    expect(monkey._moveanim_task).toBeUndefined();

    s.awake.set(true); await turn();
    await Promise.all(pillars.map(artLoaded)); await turn();
    expect(looping.sprite.currentAnimation).toBe('idle');
    expect(looping.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: true });
    expect(broken.bank).toBe('pillar_archive_broken');
    expect(capped.sprite.currentAnimation).toBe('idle_upper_capped_2');
    expect(capped.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_upper_capped_2', loop: false });
    // The chain is still running after a wake, on an unfinished clip.
    expect(monkey.sprite.currentAnimation).toBe('idle2');
    expect(monkey.sprite.sprite.peek().clip).toMatchObject({ name: 'idle2', loop: false, finished: false });
    expect(monkey._moveanim_task).toBeDefined();
    expect(monkey.sprite.sprite.peek().appearance.get('archive-hidden:snow')).toMatchObject({ hidden: true });
    await finishClip(monkey);
    expect(monkey.sprite.sprite.peek().clip).toMatchObject({ name: 'idle2', finished: false });
    expect(s.prefabs.exportRecords()).toEqual(before);
  } finally { s.dispose(); }
});

it('c_spawn, c_save and reload keep every pillar, and c_give is refused', async () => {
  const first = setup(); let zip!: Uint8Array, records!: ReturnType<EntityRegistry['exportRecords']>;
  // Rolls a broken archive pillar and the string pillar_id "1".
  const random = vi.spyOn(Math, 'random').mockReturnValue(.1);
  try {
    for (const id of IDS) {
      expect((await executeDebugCommand(`c_spawn("${id}")`, first.inventory, spawned => first.registry.spawn(spawned))).ok).toBe(true);
      expect((await executeDebugCommand(`c_give("${id}")`, first.inventory)).ok).toBe(false);
    }
    records = first.registry.exportRecords();
    const components = { archive_pillar: { broken: true }, monkeypillar: { pillar_id: '1' } } as Record<string, object>;
    for (const id of IDS) {
      expect(records[id]).toHaveLength(1);
      expect(records[id][0]).toMatchObject({ transform: { position: [12, 0, -6] }, components: components[id] ?? {} });
    }
    expect(records.vault_pillar_bottom).toBeUndefined();
    expect((await executeDebugCommand('c_save()', first.inventory, undefined, async () => {
      zip = await createClusterSaveZip(first.save(), 'forest');
    })).ok).toBe(true);
  } finally { first.dispose(); }
  random.mockReturnValue(.5);
  const files = unzipSync(zip), text = strFromU8(files['Cluster_1/Master.json']);
  const exported = JSON.parse(text) as { session: { playerFile: string } };
  const { player } = JSON.parse(strFromU8(files[`Cluster_1/${exported.session.playerFile}`])) as { player: unknown };
  const saved = deserializeSave(text, SAVE_CATALOG, player), second = setup();
  try {
    expect(saved.world.entities).toEqual(records);
    await second.registry.restoreAll(saved.world.entities);
    for (const id of IDS) {
      const pillar = second.find(id);
      expect(pillar.entityId).toBe(records[id][0].id);
      expect(pillar.position.toArray()).toEqual([12, 0, -6]);
    }
    expect(second.find(CAVE_PILLAR_IDS[0]).sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: true });
    expect(second.find<ArchivePillarInstance>(ARCHIVE_PILLAR_ID).bank).toBe('pillar_archive_broken');
    expect(second.find(VAULT_PILLAR_ID).sprite.sprite.peek().clip).toMatchObject({ name: 'idle_upper', loop: false });
    expect(second.find(MONKEYPILLAR_ID).sprite.sprite.peek().clip).toMatchObject({ name: 'idle1', loop: false });
    expect(second.registry.exportRecords()).toEqual(records);
  } finally { second.dispose(); }
});
