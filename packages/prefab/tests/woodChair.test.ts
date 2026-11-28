import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { BindTileMapSize, TileTracker } from '../../componets/src/tileManager';
import { fixedCamera } from '../src/followcamera';
import { WOOD_CHAIR_BACK_ID, WoodChairBackInstance, WoodChairInstance } from '../src/furniture_chairs';
import { WOOD_CHAIR_CONFIG } from '../src/generated/wood_chair.schema';
import { PrefabEntityManager, type PrefabInstance } from '../src/prefabInstance';
import type { EntitySaveRecord } from '../src/saveRecord';
import { FireFxHost } from '../src/treeFire';
import type { WorldContext } from '../src/worldContext';
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PlaceableBuildingPlacement } from '../../../src/placeableBuilding';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { testInventoryStore } from '../../../tests/fixtures/testInventory';

const ID = 'wood_chair';
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/** The imported Master record (source id 101717, savedrotation -75 degrees), read by the strict save parser. */
async function importedRecord(): Promise<EntitySaveRecord> {
  const read = async (path: string) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
  const master = await read('../../../public/saves/Cluster_1/Master.json');
  // The forest world with only its chairs, and the template's player (the cluster keeps players in their own files).
  const { world: _world, ...player } = await read('../../../public/saves/initial-world.json');
  const save = { ...master, ...player, world: { ...master.world, entities: { [ID]: master.world.entities[ID] } } };
  const records = deserializeSave(JSON.stringify(save), SAVE_CATALOG).world.entities[ID]!;
  expect(records).toHaveLength(1);
  return records[0];
}

/**
 * The scene's buildings registration: the shared manager, PlaceableBuildingPlacement and the building definitions.
 * `originAsleep` makes the map origin's tile asleep, where an entity created before it is placed first stands.
 */
function setup(playerPosition = new THREE.Vector3(), { originAsleep = false } = {}) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))),
  );
  const scene = new THREE.Scene(),
    displays = new PrefabDisplayGroup(scene),
    awake = createSignal(true),
    scheduler = new GameTimeScheduler(),
    fire = FireFxHost.create();
  const world = {
    scene,
    player: new THREE.Object3D(),
    ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(),
    cameraFacing: createSignal(8),
    cameraHeading: createSignal(45),
    TheCamera: fixedCamera(45),
    renderer: { domElement: new EventTarget() },
    scheduler,
    fire,
    createCursorLabel: () => ({ show() {}, hide() {}, update() {} }),
  } as unknown as WorldContext;
  // Tile keys need the world's map size; without it every position shares one key. Bound before any tracker exists.
  const unbindGrid = originAsleep ? BindTileMapSize(2 ** 13) : undefined;
  const originTile = new TileTracker(() => new THREE.Vector3()).tile.value;
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {
    tickingarea: tile => createMemo(() => awake.get() && !(originAsleep && tile.get() === originTile)),
  });
  const placement = new PlaceableBuildingPlacement(world, () => true, undefined, prefabs);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.register(PREFAB_DEFINITIONS.buildings, {
    restore: (id, record) => placement.spawnFromSave(id, record),
    debugSpawn: id => placement.spawn(id),
    exportRecords: () => placement.exportRecords(),
    dispose: () => placement.dispose(),
  });
  const chair = () => {
    const [inst] = prefabs.instances(ID);
    expect(inst).toBeInstanceOf(WoodChairInstance);
    return inst as WoodChairInstance;
  };
  return {
    scene,
    awake,
    scheduler,
    prefabs,
    registry,
    chair,
    dispose: () => {
      registry.dispose();
      prefabs.dispose();
      displays.dispose();
      fire.dispose();
      unbindGrid?.();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('loads the imported chair with its Lua clip, tags, layers, rotation, back child and art', async () => {
  const record = await importedRecord();
  expect(record.components).toEqual({ building: {}, savedrotation: { rotation: -74.999984741211 } });
  const { registry, prefabs, chair, dispose } = setup(undefined, { originAsleep: true });
  try {
    await registry.restoreAll({ [ID]: [record] });
    const inst = chair();
    const json = inst.sprite.sprite.value;
    // fn: PlayAnimation("idle") without looping, SetFinalOffset(-1), Hide("back_over"), SetFourFaced.
    expect(json.clip).toMatchObject({ name: 'idle', loop: false });
    expect(json.queue).toEqual([]);
    expect(json.behindFoot).toBe(true);
    expect(json.appearance.get('layer:back_over')).toEqual({ kind: 'layer', layer: 'back_over', hidden: true });
    // savedrotation:LoadPostPass restores the saved heading to the four-faced transform.
    expect(json).toMatchObject({ facingMode: 4 });
    expect(json.facingRotation).toBeCloseTo(-75, 4);
    expect(inst.transform.rotation).toBeCloseTo(-75, 4);
    // Constructor tags in Lua order, inspectable's, sittable's cansit, the burnable's canlight and HAMMER_workable.
    expect([...inst.listTags()].sort()).toEqual(
      [...WOOD_CHAIR_CONFIG.tags, 'inspectable', 'cansit', 'canlight', 'HAMMER_workable'].sort(),
    );
    expect(Object.keys(inst.components).sort()).toEqual(
      [
        'burnable',
        'hauntable',
        'inspectable',
        'lootdropper',
        'propagator',
        'savedrotation',
        'sittable',
        'workable',
      ].sort(),
    );
    expect(inst.components.inspectable.nameoverride).toBe('WOOD_CHAIR');
    expect(inst.components.inspectable.GetStatus()).toBeUndefined();

    // backfn and entity:SetParent: an FX child that never saves, under the chair's transform at its foot, in front of
    // it, with the parts layer hidden. It is the chair's child rather than a manager entity of its own.
    const back = inst.back!;
    expect(back).toBeInstanceOf(WoodChairBackInstance);
    expect([...prefabs.instances(WOOD_CHAIR_BACK_ID)]).toEqual([]);
    expect(back.entityParent).toBe(inst);
    expect(back.persists).toBe(false);
    expect([...back.listTags()]).toEqual(['FX']);
    expect(back.transform.model.parent).toBe(inst.transform.model);
    const backWorld = back.transform.model.getWorldPosition(new THREE.Vector3());
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(backWorld[axis]).toBeCloseTo(inst.position[axis], 9);
    }
    // It sleeps and wakes with the chair, not by a tile of its own: the origin's tile, where it is created before the
    // chair is placed, is asleep here, and the back is active because the chair is.
    expect(inst.status.value).toBe('active');
    expect(back.status.value).toBe('active');
    const backJson = back.sprite.sprite.value;
    expect(backJson.clip).toMatchObject({ name: 'idle', loop: false });
    expect(backJson.depthOffset).toBe(true);
    expect(backJson.appearance.get('layer:parts')).toEqual({ kind: 'layer', layer: 'parts', hidden: true });
    expect(backJson.facingRotation).toBe(json.facingRotation);

    // SetBank("wood_chair") from anim/wood_chair.zip, SetBuild("wood_chair_chair").
    await prefabDisplay(inst.transform.model)!.artLoaded();
    await prefabDisplay(back.transform.model)!.artLoaded();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/dst/data/anim/wood_chair.zip'));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/dst/data/anim/wood_chair_chair.zip'));
    expect(inst.sprite.currentAnimation).toBe('idle');
    expect(back.sprite.currentAnimation).toBe('idle');

    // OnSave writes the building record; savedrotation saves the heading and the back is not saved.
    const [saved] = registry.exportRecords()[ID];
    expect(saved).toMatchObject({ id: record.id, transform: { position: record.transform.position } });
    expect(saved.components.building).toEqual({});
    expect(saved.components.savedrotation!.rotation).toBeCloseTo(-74.999984741211, 9);
    expect(registry.exportRecords()).not.toHaveProperty(WOOD_CHAIR_BACK_ID);
  } finally {
    dispose();
  }
});

it('keeps the declared idle, layers and facing through a tile sleep, and loads a burnt skinned chair', async () => {
  const record = await importedRecord();
  const { scene, awake, registry, chair, prefabs, dispose } = setup();
  try {
    await registry.restoreAll({ [ID]: [record] });
    const inst = chair(),
      back = inst.back!,
      model = inst.transform.model;
    await prefabDisplay(model)!.artLoaded();
    const declared = inst.sprite.sprite.value,
      backDeclared = back.sprite.sprite.value;
    awake.set(false);
    await settle();
    expect(inst.status.value).toBe('asleep');
    expect(back.status.value).toBe('asleep');
    expect(inst.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true);
    await settle();
    await prefabDisplay(model)!.artLoaded();
    await prefabDisplay(back.transform.model)!.artLoaded();
    expect(model.parent).toBe(scene);
    expect(inst.sprite.sprite.value).toEqual({ ...declared, status: inst.sprite.sprite.value.status });
    expect(back.sprite.sprite.value).toEqual({ ...backDeclared, status: back.sprite.sprite.value.status });
    expect(inst.sprite.currentAnimation).toBe('idle');

    // A burnt chair with a skin: OnLoad runs OnChairBurnt, and wood_chair_init_fn gives the back the skin's parts.
    const burnt: EntitySaveRecord = {
      ...record,
      id: 'burnt_chair',
      skinname: 'wood_chair_rose',
      components: { building: { burnt: true } },
    };
    await registry.restoreAll({ [ID]: [burnt] });
    const charred = prefabs.get('burnt_chair') as WoodChairInstance;
    expect(charred.skinId).toBe('wood_chair_rose');
    expect(charred.back!.skinId).toBe('wood_chair_rose');
    // DefaultBurntStructureFn plays burnt looping; the back plays it once.
    expect(charred.sprite.sprite.value.clip).toMatchObject({ name: 'burnt', loop: true });
    expect(charred.back!.sprite.sprite.value.clip).toMatchObject({ name: 'burnt', loop: false });
    expect(charred.hasTag('burnt')).toBe(true);
    expect(charred.hasTag('cansit')).toBe(false);
    expect(charred.components.sittable).toBeUndefined();
    expect(charred.components.burnable).toBeUndefined();
    expect(charred.components.inspectable.GetStatus()).toBe('BURNT');
    // No saved rotation: the chair stays at 0, which savedrotation does not save.
    expect(charred.sprite.sprite.value.facingRotation).toBe(0);
    await prefabDisplay(charred.back!.transform.model)!.artLoaded();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/dst/data/anim/dynamic/wood_chair_rose.zip'));
    const exported = registry.exportRecords()[ID].find(entry => entry.id === 'burnt_chair')!;
    expect(exported).toMatchObject({ skinname: 'wood_chair_rose', components: { building: { burnt: true } } });
    expect(exported.components).not.toHaveProperty('savedrotation');
  } finally {
    dispose();
  }
});

it(`keeps a c_spawn ${ID} through c_save and a reload, and refuses c_give`, async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)),
    second = setup(),
    inventory = testInventoryStore([], SAVE_CATALOG.items);
  try {
    expect((await executeDebugCommand(`c_spawn("${ID}")`, inventory, prefab => first.registry.spawn(prefab))).ok).toBe(
      true,
    );
    expect((await executeDebugCommand(`c_give("${ID}")`, inventory)).ok).toBe(false);
    const spawned = first.chair();
    expect(spawned.sprite.sprite.value.clip).toMatchObject({ name: 'idle', loop: false });
    // A rotated chair, as savedrotation saves it.
    spawned.setRotation(90);
    const template = deserializeSave(
      await readFile(new URL('../../../public/saves/initial-world.json', import.meta.url), 'utf8'),
      SAVE_CATALOG,
    );
    let exported = '';
    expect(
      (
        await executeDebugCommand('c_save()', inventory, undefined, () => {
          exported = serializeSave(
            template,
            {
              entities: { ...template.world.entities, ...first.registry.exportRecords() },
              inventory: inventory.exportSaved(),
              playerTransform: { position: [3, 0, -6], rotationY: 0 },
              elapsedSeconds: 0,
            },
            SAVE_CATALOG,
          );
        })
      ).ok,
    ).toBe(true);
    const records = deserializeSave(exported, SAVE_CATALOG).world.entities[ID]!;
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(String(spawned.entityId));
    expect(records[0].transform.position).toEqual([spawned.position.x, 0, spawned.position.z]);
    expect(records[0].components.building).toEqual({});
    expect(records[0].components.savedrotation!.rotation).toBeCloseTo(90, 9);
    expect(deserializeSave(exported, SAVE_CATALOG).world.entities).not.toHaveProperty(WOOD_CHAIR_BACK_ID);

    await second.registry.restoreAll({ [ID]: records });
    const restored = second.chair();
    expect(restored.sprite.sprite.value).toMatchObject({ clip: { name: 'idle', loop: false }, facingMode: 4 });
    expect(restored.sprite.sprite.value.facingRotation).toBeCloseTo(90, 9);
    expect(restored.back!.sprite.sprite.value.facingRotation).toBeCloseTo(90, 9);
    // The back stands where the chair stands: under its transform, with no position of its own.
    expect(restored.back!.transform.model.parent).toBe(restored.transform.model);
    // ApplyPostPassRotation's DoTaskInTime(0) sets the same heading again.
    second.scheduler.advance(0);
    expect(restored.transform.rotation).toBeCloseTo(90, 9);
    expect(second.registry.exportRecords()[ID]).toEqual(records);
  } finally {
    first.dispose();
    second.dispose();
    inventory.dispose();
  }
});
