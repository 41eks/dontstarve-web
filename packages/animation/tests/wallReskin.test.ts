
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import { prefabDisplay } from '../../display/src/prefabDisplay';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WallId } from '../../prefab/src/walls';
import { wallsFixture } from './wallsFixture';
import { WALL_SKIN_ARCHIVES, wallWorldSkin } from '../../prefab/src/wallSkins';
import { GROUND_ITEM_DEFINITIONS, GROUND_ITEM_SKIN_SPECS } from '../../prefab/src/groundItems';
import type { WorldContext } from '../../prefab/src/worldContext';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { InventorySlot, inventorySlotAddress } from '../../inventory/src';
import { loadBuild } from '../src/animationAssets';
import { setSpriteEntityRenderOrder } from '../src/renderOrder';
import { InstancedArchiveSprites } from '../src/instancedArchiveSprites';
import { createSignal } from '@dontstarve-web/signals';
import { bindTestWorld } from './worldContentFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { reskinEntity } from '../../prefab/src/reskin_tool';
import { workTargets } from './workTargets';
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { snapToWallSlotCenter } from '../../prefab/src/tile';
import { slotWith, testInventoryStore } from './testInventory';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => {
    const file = String(url).split('dst/data/')[1];
    return new Response(await readFile(new URL(`../../../public/dst/data/${file}`, import.meta.url)));
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(consume: (id: WallId, skinId?: string) => boolean = () => false) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 12, 40); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const canvas = new EventTarget();
  const world = { scene: new THREE.Scene(), camera, cameraFacing: createSignal(8), cameraHeading: createSignal(45), ground: new THREE.Group(), player: new THREE.Group(),
    renderer: { domElement: canvas }, createCursorLabel: () => ({ show() {}, hide() {}, update() {} }),
  } as unknown as WorldContext;
  return { world, canvas, placement: wallsFixture(world, consume) };
}

it.each(['wall_stone', 'wall_dreadstone'] as WallId[])(
  'switches %s between default and representative skins while preserving facings, identity, health and saves', async (prefabId) => {
    const { world, placement } = setup();
    const scheduler = new GameTimeScheduler(), content = bindTestWorld(scheduler);
    content.camerarotation.set(world.camera.quaternion.clone());
    const health = { current: 123, maximum: 400 };
    const model = await placement.spawnFromSave(prefabId, {
      id: `wall:${prefabId}`, transform: { position: [3, 0, -6], rotationY: 0 },
      skinname: Object.keys(WALL_SKIN_ARCHIVES[prefabId]).at(-1), components: { health },
    });
    placement.update();
    const instance = lookupPrefabInstance(model)!;
    const sprite = instance.sprite;
    const display = prefabDisplay(placement.reskinTargets[0].transform.model)!;
    await display.artLoaded();
    const changed = vi.fn();
    const stopSkin = sprite.sprite.subscribe((value, previous) => {
      if (value.skinId !== previous.skinId) { changed(value.skinId, previous.skinId); }
    });
    const components = { ...instance.components };
    // Each archive sprite the display draws joins the shared batches once: a reskin dresses the drawn one instead.
    const artFactory = vi.spyOn(InstancedArchiveSprites.prototype, 'retain');
    try {
      for (const skinId of [undefined, Object.keys(WALL_SKIN_ARCHIVES[prefabId])[0]]) {
        const target = placement.reskinTargets[0];
        const release = vi.fn(); display.onDispose(release);
        const previousSkin = instance.skinId;
        const created = artFactory.mock.calls.length;
        workTargets('HAMMER')[0].work();
        placement.update(1 / 30);
        expect(reskinEntity(target)).toBe(true);
        expect(artFactory).toHaveBeenCalledTimes(created);
        await display.artLoaded();
        expect(instance.skinId).toBe(skinId);
        expect(instance.sprite).toBe(sprite);
        expect(changed).toHaveBeenLastCalledWith(skinId, previousSkin);
        for (const [name, component] of Object.entries(components)) { expect(instance.components[name as keyof typeof components]).toBe(component); }
        // walls.lua resolveanimtoplay: 123 / 400 health is at most 40%, the onequarter pose.
        expect(sprite.currentAnimation).toBe('onequarter_hit');
        expect(release).not.toHaveBeenCalled();
        for (let frame = 0; frame < 60; frame++) { placement.update(1 / 30); }
        expect(sprite.currentAnimation).toBe('onequarter');
        expect(lookupPrefabInstance(model)?.skinId).toBe(skinId);
        const record = placement.exportRecords()[0].record;
        expect(record).toEqual({ id: `wall:${prefabId}`, transform: { position: [3, 0, -6], rotationY: 0 },
          components: { health }, ...(skinId === undefined ? {} : { skinname: skinId }) });
        expect(prefabDisplay(placement.reskinTargets[0].transform.model)!.model).toBe(model);
        expect(placement.renderEntities[0].footPosition.toArray()).toEqual([3, 0, -6]);

        for (const [x, z] of [[40, 40], [0, 40]]) {
          world.camera.position.set(x, 12, z); world.camera.lookAt(0, 0, 0); world.camera.updateMatrixWorld();
          content.camerarotation.set(world.camera.quaternion.clone());
          placement.update();
          // One wall_segment part, and wall_dreadstone's wall_segment_red over its base, from the skin's build when skinned.
          const parts = prefabDisplay(model)!.resolveFrame();
          expect(parts).toHaveLength(prefabId === 'wall_dreadstone' ? 2 : 1);
          if (skinId) {
            const skin = await loadBuild(WALL_SKIN_ARCHIVES[prefabId][skinId], '/dst/data/anim');
            expect(parts.some(({ materials }) => materials.some(({ name }) => name.includes(skin.build.name)))).toBe(true);
          }
          setSpriteEntityRenderOrder(model, 17);
          expect(model.children[0].children[0].renderOrder).toBe(17);
        }
        const restoredWorld = setup();
        const restored = await restoredWorld.placement.spawnFromSave(prefabId, record);
        expect(lookupPrefabInstance(restored)?.skinId).toBe(skinId);
        expect(restoredWorld.placement.exportRecords()[0].record).toEqual(record);
        restoredWorld.placement.dispose();
      }
      expect(changed).toHaveBeenCalledTimes(2);
    } finally { stopSkin(); placement.dispose(); content.unbind(); scheduler.dispose(); }
    expect(world.scene.children).toHaveLength(0);
  });

it('maps every inventory wall skin to the correct world build and consumes the selected skin stack', async () => {
  for (const prefabId of Object.keys(WALL_SKIN_ARCHIVES)) {
    const itemId = `${prefabId}_item`;
    for (const [itemSkin, archive] of Object.entries(GROUND_ITEM_DEFINITIONS[itemId].skinArchives)) {
      expect(WALL_SKIN_ARCHIVES[prefabId][wallWorldSkin(itemId, itemSkin)!]).toBe(archive);
    }
  }
  const store = testInventoryStore([
    { address: inventorySlotAddress(0), slot: slotWith(new InventorySlot(), { itemId: 'wall_stone_item', count: 2 }) },
    { address: inventorySlotAddress(1), slot: slotWith(new InventorySlot(), { itemId: 'wall_stone_item', count: 2, skinId: 'wall_stone_anitem' }) },
  ], { wall_stone_item: { name: 'stone wall', icon: 'wall_stone_item.tex', maxStack: 40 } }, {
    wall_stone_anitem: GROUND_ITEM_SKIN_SPECS.wall_stone_anitem,
  });
  const { canvas, placement } = setup((id, skinId) => store.takeItem(id, skinId));
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(new THREE.Vector3(3, 0, 3));
  vi.spyOn(PointerRaycaster.prototype, 'isOverGround', 'get').mockReturnValue(true);
  try {
    await placement.begin('wall_stone_item', 'wall_stone_anitem');
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0 }));
    expect(placement.exportRecords()[0].prefabId).toBe('wall_stone');
    expect(placement.exportRecords()[0].record.skinname).toBe('wall_stone_an');
    expect(store.get(inventorySlotAddress(0))?.count).toBe(2);
    expect(store.get(inventorySlotAddress(1))?.count).toBe(1);
    expect(store.takeItem('wall_stone_item', 'missing')).toBe(false);
  } finally { placement.dispose(); }
});

it('keeps the wall sprite when a skin commit is cancelled or superseded and releases it on removal', async () => {
  const { world, placement } = setup();
  const model = await placement.spawnFromSave('wall_hay', { id: 'hay', transform: { position: [0, 0, 0], rotationY: 0 }, components: {} });
  const target = placement.reskinTargets[0];
  const instance = lookupPrefabInstance(model)!;
  const display = prefabDisplay(target.transform.model)!;
  await display.artLoaded();
  const sources = vi.spyOn(InstancedArchiveSprites.prototype, 'retain');
  const controller = instance.sprite;
  const release = vi.fn(); display.onDispose(release);
  expect(instance.skinId).toBeUndefined();
  expect(reskinEntity(target)).toBe(true);
  await display.artLoaded();
  expect(instance.sprite).toBe(controller);
  expect(sources).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
  // Directly changing the instance declaration follows the same display path.
  lookupPrefabInstance(model)!.skinId = undefined;
  await display.artLoaded();
  expect(instance.skinId).toBeUndefined();
  placement.dispose();
  expect(release).toHaveBeenCalledOnce();
  expect(world.scene.children).toHaveLength(0);
});

it('c_spawn places walls by their world and item IDs, and c_save reloads one reskinned', async () => {
  const registryFor = () => {
    const { world, placement } = setup();
    world.player.position.set(3, 0, -6);
    const registry = new EntityRegistry([], placement.prefabs);
    registry.register(PREFAB_DEFINITIONS.buildings, {
      restore: (id, record) => placement.spawnFromSave(id as WallId, record), debugSpawn: id => placement.spawn(id as WallId),
      exportRecords: () => [], dispose: () => placement.dispose(),
    });
    return { registry, placement, dispose: () => { registry.dispose(); placement.dispose(); } };
  };
  const first = registryFor(), second = registryFor(), inventory = testInventoryStore([], SAVE_CATALOG.items);
  try {
    for (const id of ['wall_stone', 'wall_stone_item']) {
      expect(await executeDebugCommand(`c_spawn("${id}")`, inventory, prefab => first.registry.spawn(prefab))).toMatchObject({ ok: true });
    }
    const [spawned, alias] = first.placement.exportRecords();
    expect([spawned.prefabId, alias.prefabId]).toEqual(['wall_stone', 'wall_stone']);
    const [x, , z] = spawned.record.transform.position, slot = snapToWallSlotCenter({ x, z });
    expect([x, z]).toEqual([slot.x, slot.z]);
    // walls.lua: a new stone wall starts at half of STONEWALL_HEALTH.
    expect(spawned.record.components).toEqual({ health: { current: 200, maximum: 400 } });
    expect(reskinEntity(first.placement.reskinTargets[0])).toBe(true);
    const template = deserializeSave(await readFile(new URL('../../../public/saves/initial-world.json', import.meta.url), 'utf8'), SAVE_CATALOG);
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(template, { entities: { ...template.world.entities, ...first.registry.exportRecords() },
        inventory: inventory.exportSaved(), playerTransform: { position: [3, 0, -6], rotationY: 0 }, elapsedSeconds: 0 }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.wall_stone!;
    expect(saved[0]).toEqual({ ...spawned.record, components: { health: { current: 200, maximum: 400 } }, skinname: 'wall_stone_an' });
    await second.registry.restoreAll({ wall_stone: saved });
    expect(second.registry.exportRecords().wall_stone).toEqual(saved);
    expect(second.placement.prefabs.get(saved[0].id)!.skinId).toBe('wall_stone_an');
  } finally { first.dispose(); second.dispose(); inventory.dispose(); }
});
