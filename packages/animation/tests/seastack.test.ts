import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { SEASTACK_ID, SeastackInstance, seastackPrefabs } from '../../prefab/src/seastack';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { EntitySaveRecord } from '../../prefab/src/saveRecord';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { createPickupInventory } from './pickupFixture';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
/** Cluster_65's forest snapshot 0000000315: 825 seastacks, 19 of them tinted. */
const importedRecord = (
  id: string,
  position: [number, number, number],
  stackid: number,
  tinted: boolean,
): EntitySaveRecord => ({
  id,
  transform: { position, rotationY: 0 },
  components: {
    stackid,
    tinted,
    workable: { workleft: 9 },
    upgradeable: { numupgrades: 0, stage: 1 },
  },
});
const clip = (inst: PrefabInstance) => inst.sprite.sprite.value.clip;
const layers = (inst: PrefabInstance) => [
  inst.sprite.sprite.value.appearance.get('layer:paint_A'),
  inst.sprite.sprite.value.appearance.get('layer:paint_B'),
];
function setup(playerPosition = new THREE.Vector3()) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))),
  );
  const scene = new THREE.Scene(),
    scheduler = new GameTimeScheduler(),
    awake = createSignal(true);
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {
    tickingarea: () => createMemo(() => awake.get()),
    scheduler,
  });
  const definitions = seastackPrefabs({ scheduler });
  prefabs.register(definitions);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.seastacks);
  const seastack = (record: EntitySaveRecord) => prefabs.restore(SEASTACK_ID, record) as SeastackInstance;
  const requested = (archive: string) =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url]) =>
      String(url).endsWith(`/dst/data/anim/${archive}`),
    );
  const dispose = () => {
    registry.dispose();
    prefabs.dispose();
    displays.dispose();
    scheduler.dispose();
  };
  return { scene, awake, prefabs, registry, definitions, seastack, requested, dispose };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('loads a saved tinted sea stack with the clip, tags, bank and components seastack.lua declares', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.7);
  const { seastack, definitions, requested, registry, dispose } = setup();
  try {
    const stack = seastack(importedRecord('dst_03741E1B78B29575_seastack_id_102414', [4, 0, -8], 4, true));
    // MakeWaterObstaclePhysics's blocker, fn's tags, then inspectable's and upgradeable's tags.
    expect(stack.listTags()).toEqual([
      'blocker',
      'ignorewalkableplatforms',
      'seastack',
      'inspectable',
      'waterplant_upgradeable',
      'MINE_workable',
    ]);
    // UpdateArt's stackid 4 and workleft 9: PlayAnimation("4_full"), never looping.
    expect(clip(stack)).toMatchObject({ name: '4_full', loop: false });
    // fn hides both paint layers; OnLoad's tinted branch shows one and sets the painted icon.
    expect(layers(stack)).toEqual([
      { kind: 'layer', layer: 'paint_A', hidden: false },
      { kind: 'layer', layer: 'paint_B', hidden: true },
    ]);
    expect(stack.minimap.icon).toBe('seastack_painted.png');
    expect(definitions.seastack).toMatchObject({
      assets: { animationArchive: 'water_rock_01.zip', buildArchives: ['water_rock_01.zip'], bank: 'water_rock01' },
      physics: { radius: 0.8, height: 2 },
      minimapIcon: 'seastack.png',
    });
    expect(Object.keys(stack.components)).toEqual([
      'waterphysics',
      'floater',
      'inspectable',
      'lootdropper',
      'workable',
      'upgradeable',
      'hauntable',
    ]);
    const { workable, upgradeable, lootdropper } = stack.components;
    expect([workable.GetWorkAction(), workable.GetWorkLeft(), workable.savestate]).toEqual(['MINE', 9, true]);
    expect([upgradeable.upgradetype, upgradeable.stage]).toEqual(['waterplant', 1]);
    expect(workable.maxwork.value).toBe(-1);
    expect(lootdropper.GenerateLoot()).toEqual(['rocks', 'rocks', 'rocks', 'rocks']);

    expect(registry.exportRecords().seastack![0]!.components).toEqual(
      importedRecord('', [0, 0, 0], 4, true).components,
    );
    await prefabDisplay(stack.transform.model)!.artLoaded();
    expect(requested('water_rock_01.zip')).toBe(true);
  } finally {
    dispose();
  }
});

it('rebuilds the declared clip and appearance after tile sleep', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.7);
  const { scene, awake, seastack, dispose } = setup();
  try {
    const stack = seastack(importedRecord('sleeping-stack', [1, 0, 3], 2, true));
    const model = stack.transform.model;
    await prefabDisplay(model)!.artLoaded();
    const before = stack.sprite.sprite.value;
    awake.set(false);
    await settle();
    expect(stack.status.value).toBe('asleep');
    expect(stack.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true);
    await settle();
    await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(scene);
    expect(stack.sprite.currentAnimation).toBe('2_full');
    expect(clip(stack)).toMatchObject({ name: '2_full', loop: false });
    expect(stack.sprite.sprite.value.appearance).toEqual(before.appearance);
  } finally {
    dispose();
  }
});

it('keeps c_spawn sea stacks through c_save and a reload, and rejects c_give', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const first = setup(new THREE.Vector3(3, 0, -6)),
    second = setup(),
    inventory = createPickupInventory();
  try {
    expect(
      (await executeDebugCommand('c_spawn("seastack")', inventory, prefab => first.registry.spawn(prefab))).ok,
    ).toBe(true);
    expect((await executeDebugCommand('c_give("seastack")', inventory)).ok).toBe(false);
    const spawned = [...first.prefabs.instances(SEASTACK_ID)][0] as SeastackInstance;
    // fn's not-POPULATING branch picks stackid 1 and UpdateArt plays 1_full.
    expect([spawned.stackid, spawned.tinted, clip(spawned)?.name]).toEqual([1, false, '1_full']);
    expect(layers(spawned)).toEqual([
      { kind: 'layer', layer: 'paint_A', hidden: true },
      { kind: 'layer', layer: 'paint_B', hidden: true },
    ]);
    expect(spawned.minimap.icon).toBe('seastack.png');
    first.seastack(importedRecord('imported-stack', [20, 0, 1], 5, false));
    const before = first.registry.exportRecords();
    expect(before.seastack![0]!.components).toEqual({
      workable: { workleft: 9 },
      upgradeable: { numupgrades: 0, stage: 1 },
      stackid: 1,
      tinted: false,
    });
    let json = '';
    expect(
      (
        await executeDebugCommand('c_save()', inventory, undefined, () => {
          json = serializeSave(
            deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
            {
              entities: before,
              inventory: inventory.exportSaved(),
              elapsedSeconds: 1,
              playerTransform: { position: [3, 0, -6], rotationY: 0 },
            },
            SAVE_CATALOG,
          );
        })
      ).ok,
    ).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.seastack;
    expect(saved).toEqual(before.seastack);
    expect(saved![0]).toMatchObject({ id: spawned.entityId, transform: { position: [3, 0, -6] } });
    await second.registry.restoreAll({ seastack: saved! });
    const loaded = second.prefabs.get('imported-stack');
    if (!(loaded instanceof SeastackInstance)) {
      throw new Error('The saved sea stack did not load');
    }
    expect(loaded.position.toArray()).toEqual([20, 0, 1]);
    expect([
      loaded.stackid,
      loaded.tinted,
      loaded.components.workable.GetWorkLeft(),
      loaded.components.upgradeable.stage,
      clip(loaded)?.name,
    ]).toEqual([5, false, 9, 1, '5_full']);
    expect(second.registry.exportRecords().seastack).toEqual(saved);
  } finally {
    first.dispose();
    second.dispose();
    inventory.dispose();
  }
});
