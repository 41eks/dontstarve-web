import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { mastMalbatrossPrefabs, MAST_MALBATROSS_ID, MastMalbatrossInstance } from '../src/mast_malbatross';
import { PrefabEntityManager, type PrefabInstance } from '../src/prefabInstance';
import type { EntitySaveRecord } from '../src/saveRecord';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';

import { createPickupInventory } from '../../../tests/fixtures/pickupFixture';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
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
  const definitions = mastMalbatrossPrefabs({ scheduler });
  prefabs.register(definitions);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.mastMalbatross);
  const spawn = (record: EntitySaveRecord) => prefabs.restore(MAST_MALBATROSS_ID, record) as MastMalbatrossInstance;
  const records = () => registry.exportRecords().mast_malbatross ?? [];
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
  return { scene, awake, prefabs, registry, definitions, spawn, records, requested, dispose };
}
/**
 * Cluster_62's 0000000302 Master snapshot has two masts, both `{ rotation = 0, upgradeable = { stage = 1,
 * numupgrades = 0 }, is_sail_raised = false }`; this is what scripts/saveconvert/dst-region-prefab.py converts them to.
 */
const importedRecord = (id: string, position: [number, number, number]): EntitySaveRecord => ({
  id,
  transform: { position, rotationY: 0 },
  components: { mastMalbatross: { rotation: 0, is_sail_raised: false }, upgradeable: { numupgrades: 0, stage: 1 } },
});
const clip = (inst: PrefabInstance) => inst.sprite.sprite.value.clip;
const queue = (inst: PrefabInstance) => inst.sprite.sprite.value.queue;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('loads a saved mast with the clips, tags, bank and component values mast.lua malbatrossfn and onload declare', async () => {
  const { spawn, records, definitions, requested, dispose } = setup();
  try {
    const saved = importedRecord('dst_mast_malbatross_116506', [4, 0, -8]);
    const inst = spawn(saved);
    // fn_pre's MakeObstaclePhysics and AddTag, then the burnable (canlight, ignorefuel), inspectable, workable, upgradeable
    // and mast tags; onload's SailFurled turned sailraised (SetReveseDeploy) into saillowered.
    expect(inst.listTags()).toEqual([
      'blocker',
      'structure',
      'mast',
      'rotatableobject',
      'canlight',
      'burnableignorefuel',
      'inspectable',
      'mast_upgradeable',
      'saillowered',
      'HAMMER_workable',
    ]);
    // onload: is_sail_raised == not inverted, so the inverted mast's SailFurled plays knot_tie, then loops open_loop.
    // knot_tie is requested before the art loads, so it settles (display AGENTS.md residency) into the queued loop.
    expect(clip(inst)).toMatchObject({ name: 'open_loop', loop: true });
    expect(queue(inst)).toEqual([]);
    expect(inst.sprite.sprite.value).toMatchObject({ billboard: true, facingRotation: 0, facingMode: 8 });
    expect(definitions.mast_malbatross).toMatchObject({
      assets: {
        animationArchive: 'boat_mast_malbatross_wip.zip',
        extraAnimationArchives: ['boat_mast_malbatross_knots_wip.zip', 'boat_mast_malbatross_opens_wip.zip'],
        buildArchives: ['boat_mast_malbatross_build.zip'],
        bank: 'mast_malbatross',
      },
      skins: {
        mast_malbatross_tesla: 'dynamic/mast_malbatross_tesla.zip',
        mast_malbatross_wagstaff: 'dynamic/mast_malbatross_wagstaff.zip',
      },
      physics: { radius: 0.2 },
      minimapIcon: 'mast_malbatross.png',
    });
    const { mast, workable, upgradeable, burnable } = inst.components;
    expect([
      mast.inverted,
      mast.is_sail_raised,
      mast.sail_force,
      mast.max_velocity,
      mast.rudder_turn_drag,
      mast.furlunits,
    ]).toEqual([true, false, 1.3, 4, 0.23, 4.5]);
    expect([workable.GetWorkAction(), workable.GetWorkLeft()]).toEqual(['HAMMER', 3]);
    expect([upgradeable.upgradetype, upgradeable.stage, upgradeable.numupgrades]).toEqual(['mast', 1, 0]);
    expect([burnable.burntime, burnable.ignorefuel]).toEqual([30, true]);
    expect(Object.keys(inst.components)).toEqual([
      'burnable',
      'propagator',
      'hauntable',
      'inspectable',
      'mast',
      'lootdropper',
      'workable',
      'upgradeable',
    ]);
    expect(records()).toEqual([saved]);
    await prefabDisplay(inst.transform.model)!.artLoaded();
    for (const archive of [
      'boat_mast_malbatross_wip.zip',
      'boat_mast_malbatross_knots_wip.zip',
      'boat_mast_malbatross_opens_wip.zip',
      'boat_mast_malbatross_build.zip',
    ]) {
      expect(requested(archive)).toBe(true);
    }
    expect(requested('dynamic/mast_malbatross_tesla.zip')).toBe(false);
  } finally {
    dispose();
  }
});

it('rebuilds the declared clip and appearance after tile sleep', async () => {
  const { scene, awake, spawn, records, dispose } = setup();
  try {
    const saved = importedRecord('sleeping-mast', [1, 0, 3]);
    const inst = spawn(saved);
    const model = inst.transform.model;
    await prefabDisplay(model)!.artLoaded();
    const before = inst.sprite.sprite.value;
    awake.set(false);
    await settle();
    expect(inst.status.value).toBe('asleep');
    expect(inst.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true);
    await settle();
    await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(scene);
    // The knot_tie transition settles while asleep; the queued open_loop is what comes back.
    expect(inst.sprite.currentAnimation).toBe('open_loop');
    expect(clip(inst)).toMatchObject({ name: 'open_loop', loop: true });
    expect(inst.sprite.sprite.value).toMatchObject({ facingRotation: 0, facingMode: 8, billboard: true });
    expect(inst.sprite.sprite.value.appearance).toEqual(before.appearance);
    expect(records()).toEqual([saved]);
  } finally {
    dispose();
  }
});

it('keeps a c_spawn mast through c_save and a reload, and rejects c_give', async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)),
    second = setup(),
    inventory = createPickupInventory();
  try {
    expect(
      (await executeDebugCommand('c_spawn("mast_malbatross")', inventory, prefab => first.registry.spawn(prefab))).ok,
    ).toBe(true);
    expect((await executeDebugCommand('c_give("mast_malbatross")', inventory)).ok).toBe(false);
    const spawned = [...first.prefabs.instances(MAST_MALBATROSS_ID)][0] as MastMalbatrossInstance;
    // A new inverted mast: closed, sail raised; onsave writes rotation and is_sail_raised, upgradeable its stage.
    expect(clip(spawned)).toMatchObject({ name: 'closed', loop: false });
    expect(spawned.hasTag('sailraised')).toBe(true);
    expect(first.records()[0]!.components).toEqual({
      mastMalbatross: { rotation: 0, is_sail_raised: true },
      upgradeable: { numupgrades: 0, stage: 1 },
    });
    const before = first.registry.exportRecords();
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
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.mast_malbatross!;
    expect(saved).toEqual(before.mast_malbatross);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: spawned.entityId, transform: { position: [3, 0, -6] } });
    await second.registry.restoreAll({ mast_malbatross: saved });
    const loaded = second.prefabs.get(saved[0]!.id);
    if (!(loaded instanceof MastMalbatrossInstance)) {
      throw new Error('The saved mast did not load');
    }
    expect(loaded.position.toArray()).toEqual([3, 0, -6]);
    // is_sail_raised == inverted: onload leaves the sail alone, so the mast stays closed.
    expect(clip(loaded)).toMatchObject({ name: 'closed', loop: false });
    expect([loaded.components.mast.is_sail_raised, loaded.components.upgradeable.stage]).toEqual([true, 1]);
    expect(second.records()).toEqual(saved);
    // A rotated, skinned mast keeps its facing rotation and skin through the same round trip.
    const skinned: EntitySaveRecord = {
      id: 'skinned-mast',
      transform: { position: [5, 0, 1], rotationY: 0 },
      skinname: 'mast_malbatross_wagstaff',
      components: {
        mastMalbatross: { rotation: 135, is_sail_raised: true },
        upgradeable: { numupgrades: 0, stage: 1 },
      },
    };
    await second.registry.restoreAll({ mast_malbatross: [skinned] });
    const restored = second.prefabs.get('skinned-mast')!;
    expect([restored.skinId, restored.sprite.sprite.value.facingRotation]).toEqual(['mast_malbatross_wagstaff', 135]);
    expect(second.records().find(record => record.id === 'skinned-mast')).toEqual(skinned);
  } finally {
    first.dispose();
    second.dispose();
    inventory.dispose();
  }
});
