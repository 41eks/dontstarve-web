import { readFile } from 'node:fs/promises';
import { testPlayer } from './testPlayer';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prefabDisplay, PrefabDisplayGroup, SpriteState } from '../../display/src';
import { findActionEntity } from '../../prefab/src/actionEntity';
import { CAMPFIRE_ID } from '../../prefab/src/campfire';
import { NIGHT_LIGHT_ID } from '../../prefab/src/nightlight';
import { PIG_HOUSE_ID } from '../../prefab/src/pighouse';
import { PrefabEntityManager, PrefabInstance, prefabInstance } from '../../prefab/src/prefabInstance';
import { RESEARCH_LAB_PLACERS } from '../../prefab/src/scienceprototyper';
import { SpriteResources } from '../../display/src/spriteResources';
import { reskinEntity, reskinTargetOf } from '../../prefab/src/reskin_tool';
import type { WorldContext } from '../../prefab/src/worldContext';
import { createSignal } from '../../signals/src';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { PlaceableBuildingPlacement } from '../../../src/placeableBuilding';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { managedBuildings } from './managedBuildings';
import { disposePlacingPlayers, placingPlayer } from './placingPlayer';
import definitions from '../../prefab/src/definitions.json';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import type { SaveDocument } from '../../../src/save/types';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { bindTestWorld } from './worldContentFixture';

const cleanups: (() => void)[] = [];
let fetched: string[] = [];
beforeEach(() => {
  fetched = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(url);
    return new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)));
  });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', {
    createElement: () => ({ setAttribute: vi.fn(), style: {} }),
    body: { appendChild: vi.fn() },
  });
  vi.spyOn(PointerRaycaster.prototype, 'trackPointer').mockImplementation(() => {});
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(new THREE.Vector3(3, 0, 4));
  vi.spyOn(PointerRaycaster.prototype, 'isOverGround', 'get').mockReturnValue(true);
});
afterEach(() => {
  disposePlacingPlayers();
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const canvas = new EventTarget(),
    scene = new THREE.Scene(),
    physics = new CANNON.World(),
    displays = new PrefabDisplayGroup(scene);
  const collapse = vi.fn(),
    dropLoot = vi.fn();
  const world = {
    physics,
    scene,
    player: new THREE.Object3D(),
    ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(),
    cameraFacing: createSignal(8),
    cameraHeading: createSignal(45),
    renderer: { domElement: canvas },
    createCursorLabel: () => ({ show() {}, hide() {}, update() {} }),
    fx: { collapse },
    dropLoot,
  } as unknown as WorldContext;
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { physics });
  const placement = new PlaceableBuildingPlacement(world, () => true, undefined, prefabs);
  cleanups.push(() => {
    placement.dispose();
    prefabs.dispose();
    displays.dispose();
  });
  return { world, canvas, scene, physics, displays, prefabs, placement, collapse, dropLoot };
}

it('builds through its placer in the selected skin, and onbuilt plays the placing clip', async () => {
  const { world, placement, prefabs } = setup();
  // The click is the player's BUILD: it walks to the placer and builds on the hit frame.
  const player = placingPlayer(world, placement, (id, point, skin) => prefabs.spawn(id, point, undefined, skin));
  const spawn = vi.spyOn(prefabs, 'spawn'),
    playOnce = vi.spyOn(SpriteState.prototype, 'playOnce');
  player.pay(CAMPFIRE_ID, 'campfire_cabin');
  await placement.begin(CAMPFIRE_ID, 'campfire_cabin');
  player.click();
  expect(spawn).not.toHaveBeenCalled();
  player.place();
  const campfire = spawn.mock.results[0].value as PrefabInstance;
  expect(campfire.position.toArray()).toEqual([3, 0, 4]);
  expect(campfire.skinId).toBe('campfire_cabin');
  // The player's own dolongaction plays clips too; the campfire's onbuilt plays "place" once.
  expect(playOnce.mock.calls.filter((_, index) => playOnce.mock.contexts[index] === campfire.sprite)).toEqual([
    ['place'],
  ]);
  await expect(placement.begin(NIGHT_LIGHT_ID, 'not_a_skin')).rejects.toThrow('skin');
});

it("declares a building's base symbols and skin animation banks on the spawned entity and its placer", async () => {
  const world = {
    scene: new THREE.Scene(),
    player: new THREE.Object3D(),
    ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(),
    renderer: { domElement: new EventTarget() },
  } as unknown as WorldContext;
  const buildings = managedBuildings(world),
    resources = new SpriteResources('/dst/data/anim');
  cleanups.push(() => {
    buildings.dispose();
    resources.dispose();
  });
  // researchlab2 keeps its shadow FX symbols from the base build; researchlab2_pod adds its pod FX bank.
  const declaration = definitions.animatedBuildings.researchlab2,
    skinId = 'researchlab2_pod';
  const expected = {
    symbols: undefined,
    baseSymbols: declaration.baseSymbols,
    animationBanks: declaration.skinAnimationBanks,
  };
  const declared = (entity: PrefabInstance) => {
    const skin = entity.sprite.sprite.value.appearance.get('skin');
    return (
      skin?.kind === 'skin' && {
        symbols: skin.skin.symbols,
        baseSymbols: skin.skin.baseSymbols,
        animationBanks: skin.skin.animationBanks,
      }
    );
  };
  const lab = buildings.prefabs.spawn('researchlab2', new THREE.Vector3(), undefined, skinId);
  expect(declared(lab)).toEqual(expected);
  await prefabDisplay(lab.transform.model)!.artLoaded();
  const material = lab.transform.model.getObjectByProperty('isMesh', true) as THREE.Mesh;
  expect((material.material as THREE.Material[]).map(({ name }) => name)).toContain(`sprite:${skinId}`);

  const preview = new PrefabInstance('researchlab2_placer', new SpriteState({ name: 'idle', billboard: true }));
  const art = RESEARCH_LAB_PLACERS.researchlab2.art(resources, skinId);
  art.initialize!(preview);
  expect(declared(preview)).toEqual(expected);
});

it('takes its source hammer work, drops its loot and collapses', async () => {
  const { prefabs, physics, displays, collapse, dropLoot } = setup();
  const house = prefabs.spawn(PIG_HOUSE_ID, new THREE.Vector3(1, 0, 2));
  expect(house.hasTag('structure')).toBe(true);
  await prefabDisplay(house.transform.model)!.artLoaded();
  displays.update(1 / 30);
  const workable = findActionEntity(house.transform.model)!.components.workable!;
  expect(workable.GetWorkAction()).toBe('HAMMER');
  expect(physics.bodies[0].shapes[0]).toBeDefined();
  const worker = testPlayer();
  workable.WorkedBy(worker, 3);
  expect(house.sprite.sprite.value.clip.name).toBe('hit');
  workable.WorkedBy(worker, 1);
  expect(house.isRemoved).toBe(true);
  expect(collapse).toHaveBeenCalledWith('big', house.position, 'wood');
  expect(dropLoot).toHaveBeenCalled();
  expect(physics.bodies).toHaveLength(0);
});

it('reskins through its target, draws the skin build and keeps it through the building save shape', async () => {
  const { prefabs, placement, displays } = setup();
  const house = prefabs.spawn(PIG_HOUSE_ID, new THREE.Vector3(1, 0, 2));
  const target = reskinTargetOf(prefabInstance(house.transform.model))!;
  expect(prefabs.exportRecords()[0].record.components).toEqual({ building: {} });
  expect(reskinEntity(target)).toBe(true);
  const { skinId } = house;
  expect(Object.keys(definitions.animatedBuildings.pighouse.skinArchives)).toContain(skinId);
  const [{ record }] = prefabs.exportRecords();
  expect(record.components).toEqual({ building: {} });
  expect(record.skinname).toBe(skinId);
  expect(PREFAB_DEFINITIONS.buildings.prefabIds).toContain(PIG_HOUSE_ID);

  const restored = prefabInstance(placement.spawnFromSave(PIG_HOUSE_ID, { ...record, id: 'restored' }))!;
  expect(restored.skinId).toBe(skinId);
  await prefabDisplay(restored.transform.model)!.artLoaded();
  displays.update(1 / 30);
  expect(
    fetched.some(url =>
      url.endsWith(
        definitions.animatedBuildings.pighouse.skinArchives[
          skinId as keyof typeof definitions.animatedBuildings.pighouse.skinArchives
        ],
      ),
    ),
  ).toBe(true);
});

it('draws each container prefab from its source bank and skin build, and keeps its save shape', async () => {
  const world = {
    scene: new THREE.Scene(),
    player: new THREE.Object3D(),
    ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(),
    renderer: { domElement: new EventTarget() },
  } as unknown as WorldContext;
  const buildings = managedBuildings(world);
  cleanups.push(() => buildings.dispose());
  const ids = [
    'treasurechest',
    'pandoraschest',
    'icebox',
    'dragonflychest',
    'dragonflyfurnace',
    'saltbox',
    'mushroom_light',
    'mushroom_light2',
  ] as const;
  for (const id of ids) {
    const declaration = definitions.animatedBuildings[id] as {
      container: { slotCount: number };
      idleAnimation: string;
      skinArchives?: Record<string, string>;
    };
    const [skinId] = Object.keys(declaration.skinArchives ?? {});
    expect(PREFAB_DEFINITIONS.buildings.prefabIds).toContain(id);
    const record = {
      id: `saved-${id}`,
      transform: { position: [1, 0, 2] as [number, number, number], rotationY: 0 },
      ...(skinId === undefined ? {} : { skinname: skinId }),
      components: { building: {}, container: { items: {} } },
    };
    const model = buildings.spawnFromSave(id, record),
      inst = prefabInstance(model)!;
    await prefabDisplay(model)!.artLoaded();
    buildings.displays.update(1 / 30);
    expect(inst.sprite.loaded, id).toBe(true);
    expect(model.getObjectsByProperty('isMesh', true).length, id).toBeGreaterThan(0);
    expect(inst.sprite.currentAnimation).toBe(declaration.idleAnimation);
    // fn: MiniMapEntity:SetIcon, declared as the definition's minimapIcon.
    if (id === 'icebox' || id === 'saltbox') {
      expect(inst.minimap.icon).toBe(`${id}.png`);
    }
    if (skinId !== undefined) {
      expect(fetched.some(url => url.endsWith(declaration.skinArchives![skinId]))).toBe(true);
    }
    expect(buildings.exportRecords().find(({ record: saved }) => saved.id === record.id)?.record).toEqual(record);
  }
});

it('draws the moved animated buildings through their archive or controller art, and keeps their save shape through c_save', async () => {
  const scheduler = new GameTimeScheduler(),
    content = bindTestWorld(scheduler);
  const world = {
    scene: new THREE.Scene(),
    player: new THREE.Object3D(),
    ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(),
    renderer: { domElement: new EventTarget() },
    scheduler,
    getWatchWorldContent: content.getWatchWorldContent,
    getLocalTemperature: () => 35,
  } as unknown as WorldContext;
  const buildings = managedBuildings(world);
  cleanups.push(() => {
    buildings.dispose();
    content.unbind();
    scheduler.dispose();
  });
  const minimapAtlases = (
    await Promise.all(
      [1, 2].map(n =>
        readFile(new URL(`../../../public/dst/data/minimap/minimap_data${n}.xml`, import.meta.url), 'utf8'),
      ),
    )
  ).join('');
  // tent, lightning_rod and the heads draw from the shared archive; the rest through a controller for their AnimState.
  const ids = [
    'tent',
    'lightning_rod',
    'pighead',
    'mermhead',
    'winterometer',
    'moondial',
    'sculptingtable',
    'birdcage',
    'moonbase',
    'researchlab',
    'researchlab2',
    'researchlab3',
    'researchlab4',
  ] as const;
  for (const [index, id] of ids.entries()) {
    const declaration: { archive: string; buildArchive?: string; skinArchives?: Record<string, string> } =
      definitions.animatedBuildings[id];
    const [skinId] = Object.keys(declaration.skinArchives ?? {});
    const model = buildings.spawnFromSave(id, {
      id: `saved-${id}`,
      transform: { position: [index * 10, 0, 2], rotationY: 0 },
      ...(skinId === undefined ? {} : { skinname: skinId }),
      components: { building: {} },
    });
    await prefabDisplay(model)!.artLoaded();
    buildings.displays.update(1 / 30);
    expect(model.getObjectsByProperty('isMesh', true).length, id).toBeGreaterThan(0);
    expect(
      fetched.some(url => url.endsWith(`/${declaration.buildArchive ?? declaration.archive}`)),
      id,
    ).toBe(true);
    if (skinId !== undefined) {
      expect(
        fetched.some(url => url.endsWith(declaration.skinArchives![skinId])),
        id,
      ).toBe(true);
    }
    // fn: MiniMapEntity:SetIcon, an icon the source atlases hold; stickheads.lua has no map entity.
    const icon = prefabInstance(model)!.minimap.icon;
    if (id === 'pighead' || id === 'mermhead') {
      expect(icon, id).toBe('');
    } else {
      expect(minimapAtlases, id).toContain(`"${icon}"`);
    }
    if (id === 'moonbase') {
      expect(prefabInstance(model)!.minimap.priority).toBe(4);
    }
    if (id === 'researchlab3') {
      expect(prefabInstance(model)!.minimap.priority).toBe(5);
    }
    if (id === 'moondial') {
      expect(prefabInstance(model)!.minimap.drawOverFogOfWar).toBe(true);
    }
  }
  const records = buildings.exportRecords();
  expect(records.map(({ prefabId }) => prefabId).sort()).toEqual([...ids].sort());
  // The save parser accepts what GetPersistData writes, and reloading it exports the same records.
  const save = structuredClone(initialWorld) as unknown as SaveDocument;
  save.world.entities = Object.fromEntries(
    ids.map(id => [
      id,
      records
        .filter(({ prefabId }) => prefabId === id)
        .map(({ record }) => ({
          ...structuredClone(record),
          transform: { ...record.transform, position: [...record.transform.position] },
        })),
    ]),
  );
  save.players.local.inventory = { items: {}, equip: {} };
  save.players.local.builder = { bufferedBuilds: [] };
  const parsed = deserializeSave(JSON.stringify(save), SAVE_CATALOG).world.entities;
  for (const { record } of records) {
    buildings.prefabs.get(record.id)!.remove();
  }
  for (const id of ids) {
    for (const record of parsed[id]) {
      buildings.spawnFromSave(id, record);
    }
  }
  expect(buildings.exportRecords().sort((a, b) => a.record.id.localeCompare(b.record.id))).toEqual(
    records.sort((a, b) => a.record.id.localeCompare(b.record.id)),
  );
});
