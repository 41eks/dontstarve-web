import { prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import {
  RuinsStatueManager, RUINS_STATUE_HEAD_ID, RUINS_STATUE_HEAD_NOGEM_ID, RUINS_STATUE_MAGE_ID, RUINS_STATUE_MAGE_NOGEM_ID,
  type RuinsStatueId, type RuinsStatueRecord,
} from '../../prefab/src/ruins_statue_mage';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { EntityRegistry } from '../../../src/entityRegistry';
import { createInventoryStore } from '../../../src/inventory';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

const DEFINITIONS = {
  [RUINS_STATUE_MAGE_ID]: PREFAB_DEFINITIONS.ruinsStatueMages,
  [RUINS_STATUE_MAGE_NOGEM_ID]: PREFAB_DEFINITIONS.ruinsStatueMagesNoGem,
  [RUINS_STATUE_HEAD_ID]: PREFAB_DEFINITIONS.ruinsStatueHeads,
  [RUINS_STATUE_HEAD_NOGEM_ID]: PREFAB_DEFINITIONS.ruinsStatueHeadsNoGem,
} as const;

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup<Id extends RuinsStatueId>(prefabId: Id, player = new THREE.Vector3()) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const registry = new EntityRegistry(), inventory = createInventoryStore([]);
  const statues = new RuinsStatueManager(scene, { scheduler, tickingarea: () => createMemo(() => awake.get()),
    trackDisplay: display => registry.trackDisplay(display) }, prefabId);
  registry.registerDisplayManager(DEFINITIONS[prefabId], statues, {
    restore: (_, record) => statues.spawn(new THREE.Vector3(...record.transform.position),
      { id: record.id, transform: record.transform, components: record.components } as RuinsStatueRecord<Id>),
    debugSpawn: () => statues.spawn(player.clone()),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
    playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  return { scene, awake, statues, registry, inventory, save,
    dispose: () => { registry.dispose(); inventory.dispose(); scheduler.dispose(); } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// statueruins.lua's four prefabs: commonfn(small) art, and gem() (SetGemmed) or nogem() (statue_ruins_no_gem).
const VARIANTS = [
  { id: RUINS_STATUE_MAGE_ID, archive: 'statue_ruins.zip', gemArchive: 'statue_ruins_gem.zip', gem: 'orangegem' },
  { id: RUINS_STATUE_MAGE_NOGEM_ID, archive: 'statue_ruins.zip', gemArchive: 'statue_ruins_gem.zip', gem: undefined },
  { id: RUINS_STATUE_HEAD_ID, archive: 'statue_ruins_small.zip', gemArchive: 'statue_ruins_small_gem.zip', gem: 'bluegem' },
  { id: RUINS_STATUE_HEAD_NOGEM_ID, archive: 'statue_ruins_small.zip', gemArchive: 'statue_ruins_small_gem.zip', gem: undefined },
] as const;

it.each(VARIANTS)('$id loads with the commonfn tags, its art and gem state, and the calm idle_full loop', async ({ id, archive, gemArchive, gem }) => {
  const s = setup(id);
  try {
    const record = { id: `source-${id}`, transform: { position: [2, 0, 3], rotationY: 0 },
      components: gem ? { ruinsStatueMage: { gem } } : {} } as RuinsStatueRecord<typeof id>;
    const model = s.statues.spawn(new THREE.Vector3(2, 0, 3), record);
    const inst = prefabInstance(model)!;
    expect(inst.listTags()).toEqual(expect.arrayContaining(['cavedweller', 'structure', 'statue']));
    // OnNightmarePhaseChanged(..., true) -> ShowWorkState(MARBLEPILLAR_MINE): idle_full looping, no _night suffix.
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_full', loop: true });
    const swap = inst.sprite.sprite.peek().appearance.get('archive-symbol:swap_gem');
    const { lootdropper, workable } = inst.components;
    expect(workable!.GetWorkLeft()).toBe(10);
    if (gem) {
      // OnLoad SetGemmed: the saved gem from the variant's gem build, and loot { thulecite, gem }.
      expect(swap).toMatchObject({ archive: gemArchive, sourceSymbol: gem });
      expect(lootdropper!.GenerateLoot(() => 1)).toEqual(['thulecite', gem]);
    } else {
      expect(swap).toBeUndefined();
      expect(lootdropper!.GenerateLoot(() => 0)).toEqual(['thulecite', 'nightmarefuel', 'thulecite']);
    }
    await prefabDisplay(model)!.artLoaded();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`/dst/data/anim/${archive}`));
    if (!gem) expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining(gemArchive));
    expect(inst.sprite.currentAnimation).toBe('idle_full');
    const exported = s.statues.exportRecords();
    expect(exported).toEqual([{ prefabId: id, record }]);
    expect(DEFINITIONS[id].parseComponents(exported[0].record.components, 'statue', {} as never)).toEqual(record.components);
  } finally { s.dispose(); }
});

it('releases a statue while its tile sleeps and redraws the declared idle_full and gem when it wakes', async () => {
  const s = setup(RUINS_STATUE_HEAD_ID);
  try {
    const model = s.statues.spawn(new THREE.Vector3(1, 0, 4), {
      id: 'head-sleep', transform: { position: [1, 0, 4], rotationY: 0 }, components: { ruinsStatueMage: { gem: 'purplegem' } } });
    const inst = prefabInstance(model)!;
    await prefabDisplay(model)!.artLoaded();
    const declared = inst.sprite.sprite.peek().clip;
    s.awake.set(false); await settle();
    expect(inst.status.peek()).toBe('asleep'); expect(inst.sprite.loaded).toBe(false); expect(model.parent).toBeNull();
    s.awake.set(true); await settle(); await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(s.scene);
    expect(inst.sprite.sprite.peek().clip).toEqual(declared);
    expect(inst.sprite.currentAnimation).toBe('idle_full');
    expect(inst.sprite.sprite.peek().appearance.get('archive-symbol:swap_gem')).toMatchObject({ sourceSymbol: 'purplegem' });
  } finally { s.dispose(); }
});

it('c_spawn then c_save exports a gemmed head, and the exported save restores its ID, position, gem and clip', async () => {
  const first = setup(RUINS_STATUE_HEAD_ID, new THREE.Vector3(12, 0, -6));
  let json = '';
  try {
    expect((await executeDebugCommand(`c_spawn("${RUINS_STATUE_HEAD_ID}")`, first.inventory, id => first.registry.spawn(id))).ok).toBe(true);
    expect((await executeDebugCommand('c_save()', first.inventory, undefined, () => { json = first.save(); })).ok).toBe(true);
  } finally { first.dispose(); }
  const records = deserializeSave(json, SAVE_CATALOG).world.entities[RUINS_STATUE_HEAD_ID];
  expect(records).toHaveLength(1);
  const gem = records[0].components.ruinsStatueMage?.gem;
  expect(records[0]).toMatchObject({ transform: { position: [12, 0, -6], rotationY: 0 }, components: { ruinsStatueMage: { gem: expect.any(String) } } });

  const second = setup(RUINS_STATUE_HEAD_ID);
  try {
    await second.registry.restoreAll({ [RUINS_STATUE_HEAD_ID]: records });
    const [model] = second.scene.children as THREE.Group[];
    const inst = prefabInstance(model)!;
    expect(inst.entityId).toBe(records[0].id);
    expect(inst.position.toArray()).toEqual([12, 0, -6]);
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'idle_full', loop: true });
    expect(inst.sprite.sprite.peek().appearance.get('archive-symbol:swap_gem')).toMatchObject({ sourceSymbol: gem });
    expect(second.registry.exportRecords()[RUINS_STATUE_HEAD_ID]).toEqual(records);
  } finally { second.dispose(); }
});
