import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { nightmareGrowthPrefabs, type NightmareGrowthCrackInstance, type NightmareGrowthInstance } from '../../prefab/src/nightmaregrowth';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { createInventoryStore } from '../../../src/inventory';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(random = () => .25) {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), physics = new CANNON.World(), inventory = createInventoryStore([]);
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { physics });
  prefabs.register(nightmareGrowthPrefabs({ scheduler, random,
    spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position) as NightmareGrowthCrackInstance }) as never);
  const registry = new EntityRegistry([], prefabs, () => new THREE.Vector3(9, 0, -6));
  registry.registerPrefabs(PREFAB_DEFINITIONS.nightmareGrowths);
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = async () => {
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
        playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    return deserializeSave(json, SAVE_CATALOG).world.entities;
  };
  const crackOf = (growth: NightmareGrowthInstance) => scene.children.map(model => prefabInstance(model))
    .find(inst => inst?.prefab === 'nightmaregrowth_crack' && inst.entityParent === growth) as NightmareGrowthCrackInstance | undefined;
  return { scene, scheduler, inventory, prefabs, registry, save, crackOf,
    dispose: () => { registry.dispose(); prefabs.dispose(); displays.dispose(); inventory.dispose(); scheduler.dispose(); } };
}

it('c_spawn draws the growth and spawns its nonpersistent ground crack next frame; c_save reloads the crack rotation', async () => {
  const s = setup();
  let entities;
  try {
    expect((await executeDebugCommand('c_spawn("nightmaregrowth")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    const [{ record: { id } }] = s.prefabs.exportRecords();
    const growth = s.prefabs.get(id) as NightmareGrowthInstance;
    expect(growth.hasTag('ancient_text')).toBe(true);
    expect(growth.minimap.icon).toBe('nightmaregrowth.png');
    expect(growth.physicsBody).toBeDefined();
    // DoTaskInTime(0, SpawnCrack).
    expect(s.crackOf(growth)).toBeUndefined();
    s.scheduler.advance(0);
    const crack = s.crackOf(growth)!;
    expect(crack.prefab).toBe('nightmaregrowth_crack');
    expect(crack.entityParent).toBe(growth);
    expect(crack.persists).toBe(false);
    expect(crack.listTags()).toEqual(expect.arrayContaining(['FX', 'NOCLICK', 'DECOR']));
    expect(crack.sprite.sprite.peek()).toMatchObject({ ground: { flat: true }, meshOrder: -.5 });
    expect(crack.GetRotation()).toBe(90);
    await prefabDisplay(crack.transform.model)!.artLoaded();
    expect(crack.sprite.currentAnimation).toBe('crack_idle');
    entities = await s.save();
    expect(entities.nightmaregrowth).toEqual([expect.objectContaining({ id, transform: { position: [9, 0, -6], rotationY: 0 },
      components: { nightmareGrowth: { crackRotation: 90 } } })]);
    expect(entities.nightmaregrowth_crack).toBeUndefined();
    growth.remove();
    expect(crack.isRemoved).toBe(true);
  } finally { s.dispose(); }

  const restored = setup(() => .75);
  try {
    await restored.registry.restoreAll({ nightmaregrowth: entities.nightmaregrowth });
    const growth = restored.prefabs.get(entities.nightmaregrowth[0].id) as NightmareGrowthInstance;
    // A save taken before the pending SpawnCrack keeps the loaded rotation.
    expect(restored.prefabs.exportRecords()[0].record.components.nightmareGrowth).toEqual({ crackRotation: 90 });
    restored.scheduler.advance(0);
    expect(restored.crackOf(growth)!.GetRotation()).toBe(90);
    expect(restored.prefabs.exportRecords()).toHaveLength(1);
  } finally { restored.dispose(); }
});
