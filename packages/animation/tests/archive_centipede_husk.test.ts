import { prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { Health } from '../../componets/src/health';
import { archiveCentipedeHuskPrefabs, ARCHIVE_CENTIPEDE_HUSK_ID } from '../../prefab/src/archive_centipede';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { PlacementSaveRecord } from '../../prefab/src/saveRecord';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { EntityRegistry } from '../../../src/entityRegistry';
import { executeDebugCommand } from '../../../src/debugCommands';
import { createInventoryStore } from '../../../src/inventory';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(player = new THREE.Vector3()) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const displays = new PrefabDisplayGroup(scene), inventory = createInventoryStore([]);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { tickingarea: () => createMemo(() => awake.get()) });
  prefabs.register(archiveCentipedeHuskPrefabs({ scheduler }));
  const registry = new EntityRegistry([], prefabs, () => player);
  registry.registerPrefabs(PREFAB_DEFINITIONS.archiveCentipedeHusks);
  /** SpawnPrefab with SpawnSaveRecord's position and SetPersistData; the husk's model, as its display draws it. */
  const spawn = (position: THREE.Vector3, saved?: PlacementSaveRecord) => prefabs.spawn(ARCHIVE_CENTIPEDE_HUSK_ID, position, saved).transform.model;
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
    playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  return { scene, scheduler, awake, prefabs, spawn, registry, inventory, save,
    dispose: () => { registry.dispose(); prefabs.dispose(); displays.dispose(); inventory.dispose(); scheduler.dispose(); } };
}
const health = (model: THREE.Object3D) => prefabInstance(model)!.components.health as unknown as Health;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// The imported Caves record: health={health=300}.
const IMPORTED: PlacementSaveRecord = { id: 'dst_04E26ADB66396E8D_archive_centipede_husk_id_105789',
  transform: { position: [-2113.2, 0, 292.47], rotationY: 0 }, components: { health: { current: 300, maximum: 300 } } };

it('loads a saved husk with huskfn\'s clip, tags and components, then plays idle2 and reacts to health', async () => {
  const s = setup();
  try {
    const model = s.spawn(new THREE.Vector3(...IMPORTED.transform.position), IMPORTED);
    const inst = prefabInstance(model)!;
    // huskfn: PlayAnimation("idle_full") without looping; no minimap icon is set.
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_full', loop: false });
    expect(inst.listTags()).toEqual(expect.arrayContaining(['security_powerpoint', 'mech', 'electricdamageimmune']));
    expect(inst.minimap.icon).toBe('');
    expect(Object.keys(inst.components)).toEqual(expect.arrayContaining(['lootdropper', 'health', 'inspectable', 'combat', 'hauntable']));
    expect(health(model).currenthealth).toBe(300);
    await prefabDisplay(model)!.artLoaded();
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls).toEqual(expect.arrayContaining([expect.stringContaining('/dst/data/anim/archive_centipede.zip'),
      expect.stringContaining('/dst/data/anim/archive_centipede_build.zip')]));

    // idle2task fires 3–6 s after construction: idle2_full, then PushAnimation("idle_full").
    s.scheduler.advance(6);
    expect(inst.sprite.sprite.peek()).toMatchObject({ clip: { name: 'idle2_full', loop: false }, queue: [{ name: 'idle_full', loop: false }] });

    // OnHealthDelta: full → med plays idle_med; StartRegen(1, 1) heals one point a second.
    health(model).DoDelta(-120);
    expect(inst.sprite.sprite.peek().clip.name).toBe('idle_med');
    s.scheduler.advance(1);
    expect(health(model).currenthealth).toBe(181);
    // Below the bottom threshold the combat component is removed and health is floored at 15%.
    health(model).DoDelta(-170);
    expect(health(model).currenthealth).toBeCloseTo(45);
    expect(inst.components.combat).toBeUndefined();

    // A record loaded below the threshold: SetVal and ForceUpdateHUD keep idle_full but remove combat.
    const low = prefabInstance(s.spawn(new THREE.Vector3(), { ...IMPORTED, id: 'low', components: { health: { current: 50, maximum: 300 } } }))!;
    expect(low.sprite.sprite.peek().clip.name).toBe('idle_full');
    expect(low.components.combat).toBeUndefined();
    for (const { record } of s.prefabs.exportRecords()) {
      expect(PREFAB_DEFINITIONS.archiveCentipedeHusks.parseComponents(record.components, 'husk', {} as never)).toEqual(record.components);
    }
  } finally { s.dispose(); }
});

it('releases a husk while its tile sleeps and redraws the declared clip when it wakes', async () => {
  const s = setup();
  try {
    const model = s.spawn(new THREE.Vector3(2, 0, 4), IMPORTED);
    const inst = prefabInstance(model)!;
    await prefabDisplay(model)!.artLoaded();
    s.awake.set(false); await settle();
    expect(inst.status.peek()).toBe('asleep'); expect(inst.sprite.loaded).toBe(false); expect(model.parent).toBeNull();
    // idle2 while asleep: nothing is drawn, so idle2_full completes at once and the queued idle_full is the clip.
    s.scheduler.advance(6);
    expect(inst.sprite.sprite.peek()).toMatchObject({ clip: { name: 'idle_full', finished: true }, queue: [] });
    s.awake.set(true); await settle(); await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(s.scene);
    expect(inst.sprite.loaded).toBe(true);
    expect(inst.sprite.currentAnimation).toBe('idle_full');
  } finally { s.dispose(); }
});

it('c_spawn then c_save exports a damaged husk, and the exported save restores its ID, position, health and clip', async () => {
  const first = setup(new THREE.Vector3(12, 0, -6));
  let json = '', id = '';
  try {
    expect((await executeDebugCommand(`c_spawn("${ARCHIVE_CENTIPEDE_HUSK_ID}")`, first.inventory, prefab => first.registry.spawn(prefab))).ok).toBe(true);
    const [model] = first.scene.children;
    id = String(prefabInstance(model)!.entityId);
    health(model).DoDelta(-150);
    expect(prefabInstance(model)!.sprite.sprite.peek().clip.name).toBe('idle_med');
    expect((await executeDebugCommand('c_save()', first.inventory, undefined, () => { json = first.save(); })).ok).toBe(true);
  } finally { first.dispose(); }
  const records = deserializeSave(json, SAVE_CATALOG).world.entities[ARCHIVE_CENTIPEDE_HUSK_ID];
  expect(records).toEqual([{ id, transform: { position: [12, 0, -6], rotationY: 0 }, components: { health: { current: 150, maximum: 300 } } }]);

  const second = setup();
  try {
    await second.registry.restoreAll({ [ARCHIVE_CENTIPEDE_HUSK_ID]: records });
    const [model] = second.scene.children;
    const inst = prefabInstance(model)!;
    expect(inst.entityId).toBe(id);
    expect(inst.position.toArray()).toEqual([12, 0, -6]);
    expect(health(model).currenthealth).toBe(150);
    // health:OnLoad plays no clip: the reloaded husk shows huskfn's idle_full until idle2 picks the med band.
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_full', loop: false });
    await prefabDisplay(model)!.artLoaded();
    second.scheduler.advance(6);
    expect(inst.sprite.sprite.peek().clip.name).toBe('idle2_med');
    // Six regen ticks later the record carries the healed value.
    expect(second.registry.exportRecords()[ARCHIVE_CENTIPEDE_HUSK_ID]).toEqual([{ ...records[0], components: { health: { current: 156, maximum: 300 } } }]);
  } finally { second.dispose(); }
});
