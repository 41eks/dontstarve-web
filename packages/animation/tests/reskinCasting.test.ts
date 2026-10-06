import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { ReskinActionController, ReskinEffects, nextReskin, type ReskinTarget } from '../../prefab/src/reskin_tool';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { TREASURE_CHEST_DEFINITION } from '../../prefab/src/treasurechest';
import { GroundItemManager } from '../../../src/groundItems';
import type { WorldContext } from '../../prefab/src/worldContext';
import { DisposeSounds } from '../../prefab/src/sound';
import { getPrefabLightOverride } from '../../prefab/src/localLight';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => {
    const path = String(url).slice(String(url).indexOf('dst/data/') + 9);
    return new Response(await readFile(new URL(`../../../public/dst/data/${path}`, import.meta.url)));
  });
});
afterEach(() => { DisposeSounds(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setupWorld() {
  return {
    scene: new THREE.Scene(), player: new THREE.Group(), camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() }, createCursorLabel: () => ({ show() {}, hide() {}, update() {} }),
  } as unknown as WorldContext;
}

function advance(animation: WilsonAnimationController, frames: number) {
  for (let frame = 0; frame < frames; frame++) animation.update(1 / 30);
}

it('casts at source frame nine once and cancels before commitment on unequip or another action', async () => {
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = player.userData.animationController as WilsonAnimationController;
  await animation.setCarryItem('reskin_tool');
  const cast = vi.fn();
  expect(animation.playReskin(cast)).toBe(true);
  expect(animation.playReskin(cast)).toBe(false);
  advance(animation, 8);
  expect(cast).not.toHaveBeenCalled();
  advance(animation, 1);
  expect(cast).toHaveBeenCalledOnce();
  advance(animation, 30);
  expect(cast).toHaveBeenCalledOnce();
  expect(animation.isReskinning).toBe(false);
  animation.playReskin(cast);
  advance(animation, 8);
  await animation.setCarryItem(null);
  advance(animation, 30);
  expect(cast).toHaveBeenCalledOnce();
  await animation.setCarryItem('reskin_tool');
  animation.playReskin(cast);
  advance(animation, 8);
  animation.playPickup();
  advance(animation, 60);
  expect(cast).toHaveBeenCalledOnce();
});

it.each([undefined, 'reskin_tool_bouquet', 'reskin_tool_brush', 'reskin_tool_toilet', 'reskin_tool_wand'])(
  'draws %s puff with its source build and removes it at animation end', async (skinId) => {
    const scene = new THREE.Scene();
    const effects = new ReskinEffects(scene, '/dst/data/anim');
    await effects.prepare(skinId);
    effects.spawn({ prefabId: 'cookpot', position: new THREE.Vector3(4, 0, 7) }, skinId);
    const [{ object, footPosition }] = effects.renderEntities;
    expect(footPosition.toArray()).toEqual([4, 0, 7]);
    expect(object.position.toArray()).toEqual([4, 1.5, 7]);
    expect(getPrefabLightOverride(object)).toBe(skinId ? 0 : 1);
    const mesh = object.children[0].children[0] as THREE.Mesh;
    expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
    expect((mesh.material as THREE.MeshBasicMaterial[]).every((material) => material.forceSinglePass)).toBe(true);
    expect((mesh.material as THREE.Material[]).some((material) => material.name === `ground:${skinId ?? 'reskin_tool_fx'}`)).toBe(true);
    const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1);
    for (let frame = 0; frame < 15; frame++) effects.update(1 / 30, quaternion);
    expect(object.quaternion.equals(quaternion)).toBe(true);
    expect(effects.renderEntities).toHaveLength(1);
    effects.update(1 / 30, quaternion);
    expect(effects.renderEntities).toEqual([]);
    expect(scene.children).toEqual([]);
    effects.dispose();
  },
);

it('cycles building skins while preserving the open container root, identity, state and saved foot', async () => {
  const world = setupWorld();
  const placement = new AnimatedBuildingPlacement(world, { treasurechest: TREASURE_CHEST_DEFINITION }, () => false);
  const record = { id: 'e_open_chest', transform: { position: [3, 0, 4] as const, rotationY: 0 },
    components: { building: { state: 'open' as const }, container: { slotCount: 9, slots: [] } } };
  const root = await placement.spawnFromSave('treasurechest', record);
  const skins = Object.keys(TREASURE_CHEST_DEFINITION.skinArchives!);
  const change = await placement.reskinTargets[0].prepareNextSkin();
  expect(placement.exportRecords()[0].record.components.building?.skinId).toBeUndefined();
  expect(change.apply()).toBe(true);
  change.dispose();
  expect(world.scene.children).toEqual([root]);
  expect(root.userData.entityId).toBe(record.id);
  expect(placement.exportRecords()[0].record).toMatchObject({
    id: record.id, transform: record.transform, components: { building: { state: 'open', skinId: skins[0] } },
  });
  expect(root.userData.saveRecord.components.container).toEqual(record.components.container);
  // The final skin returns to the base rather than dropping an unsupported skin ID into the save.
  expect(nextReskin(skins, skins.at(-1))).toBeUndefined();
  expect(nextReskin(skins)).toBe(skins[0]);
  const stale = await placement.reskinTargets[0].prepareNextSkin();
  const fresh = await placement.reskinTargets[0].prepareNextSkin();
  expect(fresh.apply()).toBe(true);
  expect(stale.apply()).toBe(false);
  stale.dispose(); fresh.dispose();
});

it('reskins dropped items without changing their count or entity ID and preserves the skin on pickup', async () => {
  const world = setupWorld();
  const picked = vi.fn(() => true);
  const manager = new GroundItemManager(world.scene, world.camera, world.renderer,
    '/dst/data/databundles/images.zip', picked, '/dst/data/anim', world.player);
  await manager.spawnFromSave('e_sweeper', {
    itemId: 'reskin_tool', count: 1, name: '清洁扫把', icon: 'reskin_tool.tex', atlas: 'images/inventoryimages3.xml',
  }, new THREE.Vector3(3, 0, 4));
  const first = manager.reskinTargets[0];
  const change = await first.prepareNextSkin();
  expect(change.apply()).toBe(true);
  change.dispose();
  expect(first.isValid()).toBe(false);
  expect(manager.exportRecords()[0]).toMatchObject({ id: 'e_sweeper', transform: { position: [3, 0, 4] },
    components: { stack: { itemId: 'reskin_tool', count: 1, skinId: 'reskin_tool_bouquet' } } });
  expect(manager.reskinTargets[0].isValid()).toBe(true);
  const canvas = world.renderer.domElement;
  Object.assign(canvas, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
  vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([
    { object: manager.reskinTargets[0].model.children[0].children[0], point: new THREE.Vector3(), distance: 1 } as THREE.Intersection,
  ]);
  canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, clientX: 50, clientY: 50 }));
  expect(picked).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'reskin_tool', count: 1, skinId: 'reskin_tool_bouquet' }), 'pickup', new THREE.Vector3(3, 0, 4));
  expect(manager.exportRecords()).toEqual([]);
});

it.each(['manual', 'escape', 'unequip', 'target removed', 'while loading'])(
  'discards pending work and emits no effect after %s cancellation', async (reason) => {
    const world = setupWorld();
    let equipped = true, manual = false, valid = true;
    const apply = vi.fn(() => true), dispose = vi.fn();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const target: ReskinTarget = { id: 'e_target', prefabId: 'icebox', model: new THREE.Group(), position: new THREE.Vector3(1, 0, 0),
      isValid: () => valid, prepareNextSkin: async () => { if (reason === 'while loading') await blocked; return { apply, dispose }; } };
    let callback: (() => void) | undefined;
    const animation = { isReskinning: false, cancelEmote: vi.fn(), setFacing: vi.fn(),
      playReskin: vi.fn((cast: () => void) => { callback = cast; animation.isReskinning = true; return true; }),
      cancelReskin: vi.fn(() => { animation.isReskinning = false; }) };
    const effects = { prepare: vi.fn(async () => {}), spawn: vi.fn() };
    const controller = new ReskinActionController(world, animation as unknown as WilsonAnimationController,
      { stop: vi.fn(), goToPoint: vi.fn(() => true), destination: undefined }, () => equipped ? {} : undefined,
      () => [target], effects as unknown as ReskinEffects, () => manual);
    const request = controller.request(target);
    if (reason === 'while loading') { controller.cancel(); release(); expect(await request).toBe(false); }
    else {
      expect(await request).toBe(true);
      controller.update(1 / 30);
      expect(animation.playReskin).toHaveBeenCalledOnce();
      if (reason === 'manual') manual = true;
      if (reason === 'unequip') equipped = false;
      if (reason === 'target removed') valid = false;
      if (reason === 'escape') window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Escape' }));
      controller.update(1 / 30);
      callback?.();
    }
    expect(apply).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
    expect(effects.spawn).not.toHaveBeenCalled();
    controller.dispose();
  },
);
