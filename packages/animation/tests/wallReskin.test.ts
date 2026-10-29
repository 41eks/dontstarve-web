import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WallsPlacement, type WallId } from '../../prefab/src/walls';
import { WALL_SKIN_ARCHIVES, wallWorldSkin } from '../../prefab/src/wallSkins';
import { GROUND_ITEM_DEFINITIONS, GROUND_ITEM_SKIN_SPECS } from '../../prefab/src/groundItems';
import type { WorldContext } from '../../prefab/src/worldContext';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { InventorySlot, InventoryStore, inventorySlotAddress } from '../../inventory/src';
import { loadBuild } from '../src/animationAssets';
import { setSpriteEntityRenderOrder } from '../src/renderOrder';
import * as wallSprites from '../src/wallSprite';
import { createSignal, type ReadonlySignal } from '@dontstarve-web/signals';

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
  return { world, canvas, placement: new WallsPlacement(world, consume) };
}

it.each(['wall_stone', 'wall_dreadstone'] as WallId[])(
  'switches %s between default and representative skins while preserving facings, identity, health and saves', async (prefabId) => {
    const { world, placement } = setup();
    const health = { current: 123, maximum: 400 };
    const model = await placement.spawnFromSave(prefabId, {
      id: `wall:${prefabId}`, transform: { position: [3, 0, -6], rotationY: 0 },
      components: { health, wall: { skinId: Object.keys(WALL_SKIN_ARCHIVES[prefabId]).at(-1) } },
    });
    placement.update();
    const skin = model.userData.skinIdSignal as ReadonlySignal<string | undefined>;
    const changed = vi.fn();
    const stopSkin = skin.subscribe(changed);
    const components = { ...model.userData.components };
    const artFactory = vi.spyOn(wallSprites, 'createStaticSpriteFactory');
    expect((skin as any).set).toBeUndefined();
    try {
      for (const skinId of [undefined, Object.keys(WALL_SKIN_ARCHIVES[prefabId])[0]]) {
        const target = placement.reskinTargets[0];
        const release = vi.spyOn(model.children[0].userData.animationController, 'dispose');
        const previousSkin = skin.peek();
        const created = artFactory.mock.calls.length;
        const prepared = await target.prepareNextSkin();
        expect(artFactory).toHaveBeenCalledTimes(created);
        expect(skin.peek()).toBe(previousSkin);
        placement.hammerTargets[0].playHit();
        placement.update(1 / 30);
        expect(prepared.apply()).toBe(true);
        expect(prepared.apply()).toBe(false);
        prepared.dispose();
        await model.userData.display.artLoaded();
        expect(skin.peek()).toBe(skinId);
        expect(model.userData.skinIdSignal).toBe(skin);
        expect(changed).toHaveBeenLastCalledWith(skinId, previousSkin);
        for (const [name, component] of Object.entries(components)) expect(model.userData.components[name]).toBe(component);
        // walls.lua resolveanimtoplay: 123 / 400 health is at most 40%, the onequarter pose.
        expect(model.userData.animationController.currentAnimation).toBe('onequarter_hit');
        expect(release).not.toHaveBeenCalled();
        for (let frame = 0; frame < 60; frame++) placement.update(1 / 30);
        expect(model.userData.animationController.currentAnimation).toBe('onequarter');
        expect(lookupPrefabInstance(model)?.skinId).toBe(skinId);
        const record = placement.exportRecords()[0].record;
        expect(record).toEqual({ id: `wall:${prefabId}`, transform: { position: [3, 0, -6], rotationY: 0 },
          components: { health, ...(skinId === undefined ? {} : { wall: { skinId } }) } });
        expect(placement.reskinTargets[0].model).toBe(model);
        expect(placement.renderEntities[0].footPosition.toArray()).toEqual([3, 0, -6]);

        for (const [x, z] of [[40, 40], [0, 40]]) {
          world.camera.position.set(x, 12, z); world.camera.lookAt(0, 0, 0); world.camera.updateMatrixWorld();
          placement.update();
          const mesh = model.children[0].children[0].children[0] as THREE.Mesh;
          expect(mesh.geometry.drawRange.count).toBe(prefabId === 'wall_dreadstone' ? 12 : 6);
          expect(mesh.geometry.boundingBox?.isEmpty()).not.toBe(true);
          if (skinId) {
            const skin = await loadBuild(WALL_SKIN_ARCHIVES[prefabId][skinId], '/dst/data/anim');
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            expect(materials.some((material) => ((material as THREE.MeshBasicMaterial).map as THREE.DataTexture | null)?.image.data
              === skin.atlases[0].pixels)).toBe(true);
          }
          setSpriteEntityRenderOrder(model, 17);
          expect(model.children[0].children[0].renderOrder).toBe(17);
        }
        const restoredWorld = setup();
        const restored = await restoredWorld.placement.spawnFromSave(prefabId, record);
        expect(lookupPrefabInstance(restored)?.skinId).toBe(skinId);
        expect(restored.userData.skinIdSignal.peek()).toBe(skinId);
        expect(restoredWorld.placement.exportRecords()[0].record).toEqual(record);
        restoredWorld.placement.dispose();
      }
      expect(changed).toHaveBeenCalledTimes(2);
    } finally { stopSkin(); placement.dispose(); }
    expect(world.scene.children).toHaveLength(0);
  });

it('maps every inventory wall skin to the correct world build and consumes the selected skin stack', async () => {
  for (const prefabId of Object.keys(WALL_SKIN_ARCHIVES)) {
    const itemId = `${prefabId}_item`;
    for (const [itemSkin, archive] of Object.entries(GROUND_ITEM_DEFINITIONS[itemId].skinArchives)) {
      expect(WALL_SKIN_ARCHIVES[prefabId][wallWorldSkin(itemId, itemSkin)!]).toBe(archive);
    }
  }
  const store = new InventoryStore([
    { address: inventorySlotAddress(0), slot: new InventorySlot({ itemId: 'wall_stone_item', count: 2 }) },
    { address: inventorySlotAddress(1), slot: new InventorySlot({ itemId: 'wall_stone_item', count: 2, skinId: 'wall_stone_anitem' }) },
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
    expect(placement.exportRecords()[0].record.components.wall).toEqual({ skinId: 'wall_stone_an' });
    expect(store.get(inventorySlotAddress(0))?.count).toBe(2);
    expect(store.get(inventorySlotAddress(1))?.count).toBe(1);
    expect(store.takeItem('wall_stone_item', 'missing')).toBe(false);
  } finally { placement.dispose(); }
});

it('keeps the wall sprite when a skin commit is cancelled or superseded and releases it on removal', async () => {
  const { world, placement } = setup();
  const model = await placement.spawnFromSave('wall_hay', { id: 'hay', transform: { position: [0, 0, 0], rotationY: 0 }, components: {} });
  const target = placement.reskinTargets[0];
  const skin = model.userData.skinIdSignal as ReadonlySignal<string | undefined>;
  const sources = vi.spyOn(wallSprites, 'createStaticSpriteFactory');
  const controller = model.children[0].userData.animationController;
  const release = vi.spyOn(controller, 'dispose');
  const canceled = await target.prepareNextSkin();
  canceled.dispose(); canceled.dispose();
  expect(skin.peek()).toBeUndefined();
  expect(release).not.toHaveBeenCalled();
  expect(canceled.apply()).toBe(false);
  const first = await target.prepareNextSkin();
  const obsolete = await target.prepareNextSkin();
  expect(first.apply()).toBe(true);
  first.dispose();
  expect(obsolete.apply()).toBe(false);
  obsolete.dispose();
  await model.userData.display.artLoaded();
  expect(model.children[0].userData.animationController).toBe(controller);
  expect(sources).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
  // Directly changing the instance declaration follows the same display path.
  lookupPrefabInstance(model)!.skinId = undefined;
  await model.userData.display.artLoaded();
  expect(skin.peek()).toBeUndefined();
  placement.dispose();
  expect(release).toHaveBeenCalledOnce();
  expect(world.scene.children).toHaveLength(0);
});
