import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { SPIDERDEN_ID, SpiderdenInstance, spiderdenPrefabs } from '../../prefab/src/spiderden';
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
/**
 * Cluster_65's forest snapshot 0000000315: every spiderden saves growable.stage 3 with 1000 health, 9 children inside,
 * 8 emergency children, no upgrade and shaveable.prize_count 1; scripts/saveconvert/dst-region-prefab.py keeps the ported fields.
 */
const importedRecord = (id: string, position: [number, number, number]): EntitySaveRecord => ({
  id,
  transform: { position, rotationY: 0 },
  components: {
    growable: { stage: 3, time: 92, sleeptime: 504 },
    health: { current: 1000, maximum: 1000 },
    childspawner: { childreninside: 9, childrenoutside: [], emergencychildreninside: 8 },
    upgradeable: { numupgrades: 0, stage: 3 },
  },
});
const clip = (inst: PrefabInstance) => inst.sprite.sprite.value.clip;
const queue = (inst: PrefabInstance) => inst.sprite.sprite.value.queue;
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
  const definitions = spiderdenPrefabs({ scheduler });
  prefabs.register(definitions);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.spiderDens);
  const spiderden = (record: EntitySaveRecord) => prefabs.restore(SPIDERDEN_ID, record) as SpiderdenInstance;
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
  return { scene, awake, prefabs, registry, definitions, spiderden, requested, dispose };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('loads a saved stage 3 den with the clip, tags, bank and components spiderden.lua declares', async () => {
  const { spiderden, definitions, requested, registry, dispose } = setup();
  try {
    const den = spiderden(importedRecord('dst_03741E1B78B29575_spiderden_id_113175', [4, 0, -8]));
    // MakeObstaclePhysics's blocker, fn's AddTags, burnable / freezable / inspectable, then AddSleepingBag's tent.
    expect(den.listTags()).toEqual([
      'blocker',
      'cavedweller',
      'structure',
      'lifedrainable',
      'beaverchewable',
      'hostile',
      'spiderden',
      'bedazzleable',
      'hive',
      'NPC_workable',
      'canlight',
      'freezable',
      'inspectable',
      'tent',
    ]);
    // growable:SetStage(3) → SetLarge → SetStage plays grow_medium_to_large once and pushes cocoon_large's loop;
    // the one-shot settles before the display exists, so the declared clip is the idle loop.
    expect(clip(den)).toMatchObject({ name: 'cocoon_large', loop: true });
    expect(queue(den)).toEqual([]);
    // fn's HideSymbol("bedazzled_flare").
    expect(den.sprite.sprite.value.appearance.get('archive-hidden:bedazzled_flare')).toEqual({
      kind: 'archive-hidden',
      symbol: 'bedazzled_flare',
      hidden: true,
    });
    expect(definitions.spiderden).toMatchObject({
      assets: { animationArchive: 'spider_cocoon.zip', buildArchives: ['spider_cocoon.zip'], bank: 'spider_cocoon' },
      physics: { radius: 0.5 },
      minimapIcon: 'spiderden_1.png',
    });
    expect(Object.keys(den.components)).toEqual([
      'health',
      'childspawner',
      'worldsettingstimer',
      'lootdropper',
      'burnable',
      'freezable',
      'combat',
      'upgradeable',
      'propagator',
      'growable',
      'inspectable',
      'workable',
      'hauntable',
      'shaveable',
      'bedazzlement',
      'sleepingbag',
    ]);
    const { health, childspawner, burnable, freezable, growable, upgradeable, workable, lootdropper } = den.components;
    expect([health.currenthealth, health.maxhealth]).toEqual([1000, 1000]);
    expect([
      childspawner.childname,
      childspawner.maxchildren,
      childspawner.childreninside,
      childspawner.maxemergencychildren,
      childspawner.emergencychildreninside,
      childspawner.emergencydetectionradius,
      childspawner.allowboats,
      childspawner.emergencychildname,
    ]).toEqual(['spider', 9, 9, 8, 8, 20, true, 'spider_warrior']);
    expect([burnable.burntime, freezable.resistance, freezable.fxlevel]).toEqual([30, 4, 5]);
    expect([growable.GetStage(), growable.springgrowth, growable.stages.length]).toEqual([3, true, 3]);
    expect([upgradeable.stage, upgradeable.upgradetype, den.hasTag('spider_upgradeable')]).toEqual([
      3,
      'spider',
      false,
    ]);
    // workable:SetWorkAction(nil) derives no <ACTION>_workable tag.
    expect(workable.GetWorkAction()).toBeUndefined();
    expect(lootdropper.GenerateLoot()).toEqual(['silk', 'silk', 'silk', 'silk', 'silk', 'silk', 'spidereggsack']);
    expect(den.components.sleepingbag?.health_tick).toBe(1.5);
    expect(den.minimap.icon).toBe('spiderden_3.png');

    // Waking settles the saved sleep: the large den's growth is due, and without the unported queen stage it stays
    // large and stops growing.
    const records = registry.exportRecords();
    expect(records.spiderden![0]!.components).toEqual({
      ...importedRecord('', [0, 0, 0]).components,
      growable: { stage: 3 },
    });
    await prefabDisplay(den.transform.model)!.artLoaded();
    expect(requested('spider_cocoon.zip')).toBe(true);
  } finally {
    dispose();
  }
});

it('rebuilds the declared clip and appearance after tile sleep', async () => {
  const { scene, awake, spiderden, dispose } = setup();
  try {
    const den = spiderden(importedRecord('sleeping-den', [1, 0, 3]));
    const model = den.transform.model;
    await prefabDisplay(model)!.artLoaded();
    const before = den.sprite.sprite.value;
    awake.set(false);
    await settle();
    expect(den.status.value).toBe('asleep');
    expect(den.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true);
    await settle();
    await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(scene);
    expect(den.sprite.currentAnimation).toBe('cocoon_large');
    expect(clip(den)).toMatchObject({ name: 'cocoon_large', loop: true });
    expect(den.sprite.sprite.value.appearance).toEqual(before.appearance);
  } finally {
    dispose();
  }
});

it('keeps c_spawn dens through c_save and a reload, and rejects c_give', async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)),
    second = setup(),
    inventory = createPickupInventory();
  try {
    expect(
      (await executeDebugCommand('c_spawn("spiderden")', inventory, prefab => first.registry.spawn(prefab))).ok,
    ).toBe(true);
    expect((await executeDebugCommand('c_give("spiderden")', inventory)).ok).toBe(false);
    const spawned = [...first.prefabs.instances(SPIDERDEN_ID)][0] as SpiderdenInstance;
    // growable:SetStage(1) → SetSmall → SetStage plays grow_sac_to_small once and pushes cocoon_small's loop; the
    // spawned entity's display has not drawn the one-shot yet, so both remain declared.
    expect(clip(spawned)).toMatchObject({ name: 'grow_sac_to_small', loop: false });
    expect(queue(spawned)).toEqual([{ name: 'cocoon_small', loop: true }]);
    expect([spawned.components.health.maxhealth, spawned.components.childspawner.maxchildren]).toEqual([250, 3]);
    expect(spawned.hasTag('spider_upgradeable')).toBe(true);
    expect(spawned.components.sleepingbag).toBeUndefined();
    first.spiderden(importedRecord('imported-den', [20, 0, 1]));
    const before = first.registry.exportRecords();
    expect(before.spiderden![0]!.components).toMatchObject({
      health: { current: 250, maximum: 250 },
      childspawner: { childreninside: 3, childrenoutside: [] },
      upgradeable: { numupgrades: 0, stage: 1 },
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
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.spiderden;
    expect(saved).toEqual(before.spiderden);
    expect(saved![0]).toMatchObject({ id: spawned.entityId, transform: { position: [3, 0, -6] } });
    await second.registry.restoreAll({ spiderden: saved! });
    const loaded = second.prefabs.get('imported-den');
    if (!(loaded instanceof SpiderdenInstance)) {
      throw new Error('The saved spider den did not load');
    }
    expect(loaded.position.toArray()).toEqual([20, 0, 1]);
    expect([
      loaded.components.health.currenthealth,
      loaded.components.childspawner.childreninside,
      loaded.components.growable.GetStage(),
      loaded.components.upgradeable.stage,
      clip(loaded)?.name,
    ]).toEqual([1000, 9, 3, 3, 'cocoon_large']);
    expect(second.registry.exportRecords().spiderden).toEqual(saved);
  } finally {
    first.dispose();
    second.dispose();
    inventory.dispose();
  }
});
