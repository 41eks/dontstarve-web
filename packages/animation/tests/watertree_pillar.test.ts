import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import type { AnimStateJson } from '@dontstarve-web/animation/animState';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import {
  watertreePillarPrefabs,
  WATERTREE_PILLAR_ID,
  WatertreePillarInstance,
} from '../../prefab/src/watertree_pillar';
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
  const definitions = watertreePillarPrefabs({ scheduler });
  prefabs.register(definitions);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.watertreePillars);
  const spawn = (record: EntitySaveRecord) => prefabs.restore(WATERTREE_PILLAR_ID, record) as WatertreePillarInstance;
  const records = () => registry.exportRecords().watertree_pillar ?? [];
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
/** The pillar's own AnimState declaration: AddOverrideBuild's builds. */
const overrideBuilds = (inst: PrefabInstance) => {
  const op = inst.sprite.sprite.value.appearance.get('anim-state');
  return op?.kind === 'anim-state' ? (op.state.value as AnimStateJson).overrideBuilds : undefined;
};
/** The imported default save's pillars, as the game's save reader parses them. */
async function importedPillars(): Promise<EntitySaveRecord[]> {
  const cluster = new URL('../../../public/saves/Cluster_1/', import.meta.url);
  const json = await readFile(new URL('Master.json', cluster), 'utf8');
  const { session } = JSON.parse(json) as { session: { playerFile: string } };
  const { player } = JSON.parse(await readFile(new URL(session.playerFile, cluster), 'utf8')) as { player: unknown };
  return deserializeSave(json, SAVE_CATALOG, player).world.entities.watertree_pillar! as EntitySaveRecord[];
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('loads an imported save record with the clip, tags, bank and component values watertree_pillar.lua fn declares', async () => {
  const pillars = await importedPillars();
  expect(pillars).toHaveLength(9);
  // A pillar that was rammed and whose grassgator was outside in the source save.
  const regrowing = pillars.find(
    ({ components: { watertreePillar: saved } }) =>
      saved?.childspawner.childreninside === 0 && saved.last_ram_time !== undefined,
  )!;
  const { spawn, records, definitions, requested, dispose } = setup();
  try {
    const inst = spawn(regrowing);
    // MakeWaterObstaclePhysics's blocker, fn's AddTag in order, then the inspectable constructor's tag.
    expect(inst.listTags()).toEqual([
      'blocker',
      'cocoon_home',
      'shadecanopy',
      'ignorewalkableplatforms',
      'inspectable',
    ]);
    expect(inst.sprite.sprite.value).toMatchObject({ clip: { name: 'idle', loop: true }, queue: [], billboard: true });
    expect(definitions.watertree_pillar).toMatchObject({
      assets: {
        animationArchive: 'oceantree_pillar.zip',
        buildArchives: ['oceantree_pillar_build1.zip'],
        bank: 'oceantree_pillar',
      },
      physics: { radius: 4, height: 2 },
      minimapIcon: 'oceantree_pillar.png',
    });
    expect(overrideBuilds(inst)).toEqual(['oceantree_pillar_build2.zip']);
    const { childspawner } = inst.components;
    expect([childspawner.childname, childspawner.maxchildren, childspawner.childreninside]).toEqual([
      'grassgator',
      1,
      0,
    ]);
    // SetRegenPeriod(GRASSGATOR_REGEN_TIME): 120 s with the default 10% variance, counting down for the missing child.
    expect(childspawner.timer.value.status).toBe('scheduled');
    expect(childspawner.GetTimeToNextRegen()).toBeGreaterThanOrEqual(108);
    expect(childspawner.GetTimeToNextRegen()).toBeLessThanOrEqual(132);
    expect([inst.num_oceantreenuts, inst._cocoons_to_regrow, inst.last_ram_time]).toEqual([
      regrowing.components.watertreePillar!.num_oceantreenuts,
      0,
      regrowing.components.watertreePillar!.last_ram_time,
    ]);
    expect(Object.keys(inst.components)).toEqual(
      expect.arrayContaining([
        'waterphysics',
        'distancefade',
        'canopyshadows',
        'canopylightrays',
        'playerprox',
        'inspectable',
        'childspawner',
        'worldsettingstimer',
        'timer',
        'lightningblocker',
      ]),
    );
    expect(inst.last_ram_time).toEqual(expect.any(Number));
    expect(records()).toEqual([regrowing]);
    await prefabDisplay(inst.transform.model)!.artLoaded();
    for (const archive of ['oceantree_pillar.zip', 'oceantree_pillar_build1.zip', 'oceantree_pillar_build2.zip']) {
      expect(requested(archive)).toBe(true);
    }
    expect(inst.sprite.currentAnimation).toBe('idle');
  } finally {
    dispose();
  }
});

it('rebuilds the declared clip and override build after tile sleep', async () => {
  const { scene, awake, spawn, records, dispose } = setup();
  try {
    const saved: EntitySaveRecord = {
      id: 'sleeping-pillar',
      transform: { position: [1, 0, 3], rotationY: 0 },
      components: {
        watertreePillar: {
          num_oceantreenuts: 2,
          cocoons_to_regrow: 0,
          childspawner: { childreninside: 1, childrenoutside: [] },
        },
      },
    };
    const inst = spawn(saved);
    const model = inst.transform.model,
      before = inst.sprite.sprite.value;
    await prefabDisplay(model)!.artLoaded();
    awake.set(false);
    await settle();
    expect(inst.status.value).toBe('asleep');
    expect(inst.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true);
    await settle();
    await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(scene);
    expect(inst.sprite.currentAnimation).toBe('idle');
    expect(inst.sprite.sprite.value.clip).toMatchObject({ name: 'idle', loop: true });
    expect(inst.sprite.sprite.value.appearance).toEqual(before.appearance);
    expect(overrideBuilds(inst)).toEqual(['oceantree_pillar_build2.zip']);
    expect(records()).toEqual([saved]);
  } finally {
    dispose();
  }
});

it('keeps a c_spawn pillar through c_save and a reload, and rejects c_give', async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)),
    second = setup(),
    inventory = createPickupInventory();
  try {
    expect(
      (await executeDebugCommand('c_spawn("watertree_pillar")', inventory, prefab => first.registry.spawn(prefab))).ok,
    ).toBe(true);
    expect((await executeDebugCommand('c_give("watertree_pillar")', inventory)).ok).toBe(false);
    const spawned = [...first.prefabs.instances(WATERTREE_PILLAR_ID)][0] as WatertreePillarInstance;
    // A fresh pillar: START_NUM_OCEANTREENUTS, no cocoons to regrow and its one grassgator inside.
    expect([
      spawned.num_oceantreenuts,
      spawned._cocoons_to_regrow,
      spawned.components.childspawner.childreninside,
    ]).toEqual([1, 0, 1]);
    spawned.num_oceantreenuts = 2;
    spawned.last_ram_time = 42.5;
    spawned.components.timer.StartTimer('regrow_oceantreenut', 300);
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
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.watertree_pillar!;
    expect(saved).toEqual(before.watertree_pillar);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      id: spawned.entityId,
      transform: { position: [3, 0, -6] },
      components: {
        watertreePillar: {
          num_oceantreenuts: 2,
          last_ram_time: 42.5,
          cocoons_to_regrow: 0,
          childspawner: { childreninside: 1, childrenoutside: [] },
          timer: { timers: { regrow_oceantreenut: { timeleft: 300, paused: false, initial_time: 300 } } },
        },
      },
    });
    await second.registry.restoreAll({ watertree_pillar: saved });
    const loaded = second.prefabs.get(saved[0]!.id);
    if (!(loaded instanceof WatertreePillarInstance)) {
      throw new Error('The saved pillar did not load');
    }
    expect(loaded.position.toArray()).toEqual([3, 0, -6]);
    expect(loaded.sprite.sprite.value.clip).toMatchObject({ name: 'idle', loop: true });
    expect([loaded.num_oceantreenuts, loaded.last_ram_time, loaded._cocoons_to_regrow]).toEqual([2, 42.5, 0]);
    expect(loaded.components.timer.GetTimeLeft('regrow_oceantreenut')).toBe(300);
    expect(second.records()).toEqual(saved);
  } finally {
    first.dispose();
    second.dispose();
    inventory.dispose();
  }
});
