import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { executeDebugCommand } from '../../../src/debugCommands';
import type { InventoryStore } from '../../../src/inventory';
import { isPlaceableBuildingId, PlaceableBuildingPlacement } from '../../../src/placeableBuilding';
import { deserializeSave } from '../../../src/save/deserialize';
import type { SaveDocument } from '../../../src/save/types';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import definitions from '../../prefab/src/definitions.json' with { type: 'json' };
import type { WorldContext } from '../../prefab/src/worldContext';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('spawns moonbase through the debug command using its source art and restores its saved position', async () => {
  const bytes = await readFile(new URL('../../../public/dst/data/anim/moonbase.zip', import.meta.url));
  const fetchAsset = vi.fn(async (_url: string) => new Response(bytes));
  vi.stubGlobal('fetch', fetchAsset);
  vi.stubGlobal('window', new EventTarget());
  const world = {
    scene: new THREE.Scene(), player: new THREE.Object3D(), ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(), renderer: { domElement: new EventTarget() },
    createCursorLabel: () => ({ show() {}, hide() {}, update() {} }),
  } as unknown as WorldContext;
  world.player.position.set(30, 0, 40);
  const consume = vi.fn(() => false);
  const placement = new PlaceableBuildingPlacement(world, consume);
  const result = await executeDebugCommand('c_spawn("moonbase")', {} as InventoryStore, async (prefabId) => {
    if (!isPlaceableBuildingId(prefabId)) return false;
    await placement.spawn(prefabId);
    return true;
  });
  expect(result).toEqual({ ok: true, message: '已生成 moonbase' });
  expect(fetchAsset.mock.calls[0][0]).toMatch(/dst\/data\/anim\/moonbase\.zip$/);
  expect(consume).not.toHaveBeenCalled();
  const model = world.scene.children[0];
  expect(model.name).toBe('MoonBase');
  expect(model.userData.animationController.currentAnimation).toBe('med');
  const mesh = model.children[0].children[0] as THREE.Mesh;
  expect(mesh.isMesh).toBe(true);
  expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(4);
  expect(mesh.geometry.groups.length).toBeGreaterThan(0);
  expect(placement.hammerTargets).toEqual([]);
  placement.update(1 / 30);

  const [{ prefabId, record }] = placement.exportRecords();
  expect(prefabId).toBe('moonbase');
  expect(record.transform.position).toEqual([30, 0, 30]);
  expect(record.components).toEqual({ building: { state: 'idle' } });
  // The save parser uses the same building catalog as the application.
  const save = structuredClone(initialWorld) as unknown as SaveDocument;
  save.world.entities = { moonbase: [{
    ...record, transform: { ...record.transform, position: [...record.transform.position] },
  }] };
  save.players.local.inventory.containers = {
    'player:inventory': { slotCount: 15, slots: [] },
    'player:equipment': { slotCount: 3, slots: [] },
  };
  save.players.local.inventory.bufferedBuilds = [];
  const parsed = deserializeSave(JSON.stringify(save), {
    items: {}, skins: {}, recipes: {}, recipeSkins: {},
    buildings: definitions.animatedBuildings, walls: Object.keys(definitions.walls),
  });
  const restored = await placement.spawnFromSave('moonbase', parsed.world.entities.moonbase[0]);
  expect(restored.position.toArray()).toEqual(model.position.toArray());
  expect(restored.userData.entityId).toBe(record.id);
  expect(restored.userData.animationController.currentAnimation).toBe('med');
  expect(placement.exportRecords()[1]).toEqual({ prefabId, record });
});
