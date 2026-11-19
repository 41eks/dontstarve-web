import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { EntitySaveRecord } from '../../prefab/src/saveRecord';
import { supportPillarPrefabs, SUPPORT_PILLAR_ID, SupportPillarInstance } from '../../prefab/src/support_pillar';
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
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim',
    { tickingarea: () => createMemo(() => awake.get()), scheduler });
  const definitions = supportPillarPrefabs();
  prefabs.register(definitions);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.supportPillars);
  const spawn = (record: EntitySaveRecord) =>
    prefabs.restoreAs(SupportPillarInstance, SUPPORT_PILLAR_ID, record);
  const records = () => registry.exportRecords().support_pillar ?? [];
  const requested = (archive: string) =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).endsWith(`/dst/data/anim/${archive}`));
  const dispose = () => { registry.dispose(); prefabs.dispose(); displays.dispose(); scheduler.dispose(); };
  return { scene, awake, prefabs, registry, definitions, spawn, records, requested, dispose };
}
/**
 * Cluster_65's 0000000145 Caves snapshot has four pillars, each `{ reinforced = 5..9, constructionsite = { materials =
 * { rocks = 40 } } }`; this is what scripts/dst-region-prefab.py converts the first to.
 */
const importedRecord = (id: string, position: [number, number, number], rocks = 40, reinforced?: number): EntitySaveRecord => ({
  id, transform: { position, rotationY: 0 },
  components: { ...(reinforced === undefined ? {} : { supportPillar: { reinforced } }), constructionsite: { materials: { rocks } } },
});
const clip = (inst: PrefabInstance) => inst.sprite.sprite.peek().clip;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads a saved pillar with the clip, tags, bank and component values MakePillar fn and OnLoad declare', async () => {
  const { spawn, records, definitions, requested, dispose } = setup();
  try {
    const saved = importedRecord('dst_04E26ADB66396E8D_support_pillar_id_102571', [4, 0, -8], 40, 9);
    const inst = spawn(saved);
    // fn's MakeObstaclePhysics and AddTag, the constructionsite and inspectable tags, then UpdateLevel's quake_blocker.
    expect(inst.listTags()).toEqual(['blocker', 'structure', 'antlion_sinkhole_blocker', 'constructionsite',
      'repairconstructionsite', 'inspectable', 'quake_blocker', 'HAMMER_workable']);
    // 40 rocks: level 0, suffix "", so OnLoad plays idle once; UpdateLevel disables the full construction site.
    expect([inst._level, inst.suffix, inst.reinforced]).toEqual([0, '', 9]);
    expect(clip(inst)).toMatchObject({ name: 'idle', loop: false });
    expect(inst.sprite.sprite.peek()).toMatchObject({ billboard: true, facingRotation: 0, facingMode: 8 });
    expect(definitions.support_pillar).toMatchObject({
      assets: { animationArchive: 'support_pillar.zip', buildArchives: ['support_pillar.zip'], bank: 'support_pillar' },
      physics: { radius: 1.45, height: 6 }, minimapIcon: 'support_pillar.png',
    });
    const { constructionsite, workable, lootdropper } = inst.components;
    expect([constructionsite.GetSlotCount(1), constructionsite.IsEnabled(), constructionsite.constructionprefab])
      .toEqual([40, false, 'construction_repair_container']);
    expect([workable.GetWorkAction(), workable.GetWorkLeft(), workable.tough, lootdropper.y_speed]).toEqual(['HAMMER', 5, false, 4]);
    expect(Object.keys(inst.components)).toEqual(['deployhelper', 'constructionsite', 'inspectable', 'lootdropper', 'workable']);
    expect(records()).toEqual([saved]);
    // A part-filled pillar: 15 rocks is level 2, played as idle_2, and its site stays open.
    const partial = spawn(importedRecord('partial', [0, 0, 0], 15));
    expect([partial.suffix, clip(partial)?.name, partial.components.constructionsite.IsEnabled(), partial.hasTag('quake_blocker')])
      .toEqual(['_2', 'idle_2', true, true]);
    await prefabDisplay(inst.transform.model)!.artLoaded();
    expect(requested('support_pillar.zip')).toBe(true);
  } finally { dispose(); }
});

it('rebuilds the declared clip and appearance after tile sleep', async () => {
  const { scene, awake, spawn, records, dispose } = setup();
  try {
    const saved = importedRecord('sleeping-pillar', [1, 0, 3], 40, 7);
    const inst = spawn(saved);
    const model = inst.transform.model;
    await prefabDisplay(model)!.artLoaded();
    const before = inst.sprite.sprite.peek();
    awake.set(false); await settle();
    expect(inst.status.peek()).toBe('asleep');
    expect(inst.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true); await settle();
    await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(scene);
    expect(inst.sprite.currentAnimation).toBe('idle');
    expect(clip(inst)).toMatchObject({ name: 'idle', loop: false });
    expect(inst.sprite.sprite.peek()).toMatchObject({ facingRotation: 0, facingMode: 8, billboard: true });
    expect(inst.sprite.sprite.peek().appearance).toEqual(before.appearance);
    expect(records()).toEqual([saved]);
  } finally { dispose(); }
});

it('keeps a c_spawn pillar and an imported one through c_save and a reload, and rejects c_give', async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)), second = setup(), inventory = createPickupInventory();
  try {
    expect((await executeDebugCommand('c_spawn("support_pillar")', inventory, prefab => first.registry.spawn(prefab))).ok).toBe(true);
    expect((await executeDebugCommand('c_give("support_pillar")', inventory)).ok).toBe(false);
    const spawned = [...first.prefabs.instances(SUPPORT_PILLAR_ID)][0] as SupportPillarInstance;
    // A new pillar holds no material: fn's idle_4, and OnSave / constructionsite:OnSave write nothing.
    expect(clip(spawned)).toMatchObject({ name: 'idle_4', loop: false });
    expect(first.records()[0]!.components).toEqual({});
    const imported = importedRecord('imported-pillar', [5, 0, 1], 40, 5);
    first.spawn(imported);
    const before = first.registry.exportRecords();
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
        { entities: before, inventory: inventory.exportState(), elapsedSeconds: 1, playerTransform: { position: [3, 0, -6], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.support_pillar!;
    expect(saved).toEqual(before.support_pillar);
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ id: spawned.entityId, transform: { position: [3, 0, -6] } });
    await second.registry.restoreAll({ support_pillar: saved });
    const loaded = second.prefabs.get(saved[0]!.id);
    if (!(loaded instanceof SupportPillarInstance)) throw new Error('The saved pillar did not load');
    expect(loaded.position.toArray()).toEqual([3, 0, -6]);
    // OnLoad with no material: UpdateLevel keeps level 4 and plays idle_4.
    expect([loaded.suffix, clip(loaded)?.name, loaded.hasTag('quake_blocker')]).toEqual(['_4', 'idle_4', false]);
    const reloaded = second.prefabs.get('imported-pillar') as SupportPillarInstance;
    expect([reloaded.reinforced, reloaded.components.constructionsite.GetSlotCount(1), clip(reloaded)?.name]).toEqual([5, 40, 'idle']);
    expect(second.records()).toEqual(saved);
  } finally { first.dispose(); second.dispose(); inventory.dispose(); }
});
