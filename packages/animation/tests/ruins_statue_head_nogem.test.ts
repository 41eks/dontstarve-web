import { prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { RuinsStatueManager, RUINS_STATUE_HEAD_NOGEM_ID, type RuinsStatueHeadNoGemRecord } from '../../prefab/src/ruins_statue_mage';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { EntityRegistry } from '../../../src/entityRegistry';
import { createInventoryStore } from '../../../src/inventory';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

// An imported Caves record: nogem() saves no gem, so only identity and transform remain.
const RECORD: RuinsStatueHeadNoGemRecord = {
  id: 'dst_04E26ADB66396E8D_ruins_statue_head_nogem_id_106546', transform: { position: [1692.36, 0, 731.64], rotationY: 0 }, components: {},
};

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(player = new THREE.Vector3()) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const registry = new EntityRegistry(), inventory = createInventoryStore([]);
  const statues = new RuinsStatueManager(scene, { scheduler, tickingarea: () => createMemo(() => awake.get()),
    trackDisplay: display => registry.trackDisplay(display) }, RUINS_STATUE_HEAD_NOGEM_ID);
  registry.registerDisplayManager(PREFAB_DEFINITIONS.ruinsStatueHeadsNoGem, statues, {
    restore: (_, record) => statues.spawn(new THREE.Vector3(...record.transform.position),
      { id: record.id, transform: record.transform, components: {} }),
    debugSpawn: () => statues.spawn(player.clone()),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
    playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  return { scene, scheduler, awake, statues, registry, inventory, save,
    dispose: () => { registry.dispose(); inventory.dispose(); scheduler.dispose(); } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads a saved head with commonfn(small) tags, no gem, the no-gem loot table and the calm idle_full loop', async () => {
  const s = setup();
  try {
    const model = s.statues.spawn(new THREE.Vector3(...RECORD.transform.position), RECORD);
    const inst = prefabInstance(model)!;
    expect(inst.listTags()).toEqual(expect.arrayContaining(['cavedweller', 'structure', 'statue']));
    // OnNightmarePhaseChanged(..., true) -> ShowWorkState(MARBLEPILLAR_MINE): idle_full looping, no _night suffix.
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_full', loop: true });
    // nogem() never calls SetGemmed: no swap_gem override.
    expect(inst.sprite.sprite.peek().appearance.has('archive-symbol:swap_gem')).toBe(false);
    await prefabDisplay(model)!.artLoaded();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/dst/data/anim/statue_ruins_small.zip'));
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('statue_ruins_small_gem.zip'));
    expect(inst.sprite.currentAnimation).toBe('idle_full');
    const { lootdropper, workable } = inst.components;
    expect(lootdropper!.GenerateLoot(() => 0)).toEqual(['thulecite', 'nightmarefuel', 'thulecite']);
    expect(lootdropper!.GenerateLoot(() => .5)).toEqual(['thulecite', 'nightmarefuel']);
    expect(workable!.GetWorkLeft()).toBe(10);
    const exported = s.statues.exportRecords();
    expect(exported).toEqual([{ prefabId: RUINS_STATUE_HEAD_NOGEM_ID, record: RECORD }]);
    expect(PREFAB_DEFINITIONS.ruinsStatueHeadsNoGem.parseComponents(exported[0].record.components, 'head', {} as never)).toEqual({});
  } finally { s.dispose(); }
});

it('releases the head art while its tile sleeps and redraws the declared idle_full when it wakes', async () => {
  const s = setup();
  try {
    const model = s.statues.spawn(new THREE.Vector3(...RECORD.transform.position), RECORD);
    const inst = prefabInstance(model)!;
    await prefabDisplay(model)!.artLoaded();
    const declared = inst.sprite.sprite.peek().clip;
    s.awake.set(false); await settle();
    expect(inst.status.peek()).toBe('asleep'); expect(inst.sprite.loaded).toBe(false); expect(model.parent).toBeNull();
    s.awake.set(true); await settle(); await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(s.scene);
    expect(inst.sprite.sprite.peek().clip).toEqual(declared);
    expect(inst.sprite.currentAnimation).toBe('idle_full');
  } finally { s.dispose(); }
});

it('c_spawn then c_save exports the head, and the exported save restores its ID, position and clip', async () => {
  const first = setup(new THREE.Vector3(12, 0, -6));
  let json = '';
  try {
    expect((await executeDebugCommand(`c_spawn("${RUINS_STATUE_HEAD_NOGEM_ID}")`, first.inventory, id => first.registry.spawn(id))).ok).toBe(true);
    expect((await executeDebugCommand('c_save()', first.inventory, undefined, () => { json = first.save(); })).ok).toBe(true);
  } finally { first.dispose(); }
  const records = deserializeSave(json, SAVE_CATALOG).world.entities[RUINS_STATUE_HEAD_NOGEM_ID];
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ transform: { position: [12, 0, -6], rotationY: 0 }, components: {} });

  const second = setup();
  try {
    await second.registry.restoreAll({ [RUINS_STATUE_HEAD_NOGEM_ID]: records });
    const [model] = second.scene.children as THREE.Group[];
    const inst = prefabInstance(model)!;
    expect(inst.entityId).toBe(records[0].id);
    expect(inst.position.toArray()).toEqual([12, 0, -6]);
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_full', loop: true });
    expect(second.registry.exportRecords()[RUINS_STATUE_HEAD_NOGEM_ID]).toEqual(records);
  } finally { second.dispose(); }
});
