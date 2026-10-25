import { actionTool, reskinEntityFields } from './actionFixtures';
import { createPickupInventory } from './pickupFixture';
import { createPickupDoer, performPickupAction } from '../../stategraphs/src/pickup';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { ReskinEffects, nextReskin } from '../../prefab/src/reskin_tool';
import { type ReskinTarget } from '../../stategraphs/src/reskin_tool';
import { ReskinActionController } from '../../stategraphs/src/reskin_tool';
import { createEquipmentExistenceState } from '../../signals/src';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { TREASURE_CHEST_DEFINITION } from '../../prefab/src/treasurechest';
import { GroundItemManager } from '../../../src/groundItems';
import { equipmentSlotAddress } from '../../inventory/src';
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

it.each([undefined, 'reskin_tool_brush'])(
  'draws %s puff with its source build and removes it at animation end', async (skinId) => {
    const scene = new THREE.Scene();
    const effects = new ReskinEffects(scene);
    const fx = await effects.prepare(skinId);
    expect(effects.renderEntities).toEqual([]);
    fx.play(new THREE.Vector3(4, 0, 7), 'cookpot');
    await new Promise(resolve => setTimeout(resolve, 0));
    const [{ object, footPosition }] = effects.renderEntities;
    expect(footPosition.toArray()).toEqual([4, 0, 7]);
    expect(object.position.toArray()).toEqual([4, 1.5, 7]);
    expect(object.scale.toArray()).toEqual([1.4, 1.4, 1.4]);
    expect(object.userData.instance.hasTag('FX')).toBe(true);
    expect(object.userData.instance.persists).toBe(false);
    expect(getPrefabLightOverride(object)).toBe(skinId ? 0 : 1);
    const mesh = object.children[0].children[0].children[0] as THREE.Mesh;
    expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
    expect((mesh.material as THREE.MeshBasicMaterial[]).every((material) => material.forceSinglePass)).toBe(true);
    expect((mesh.material as THREE.Material[]).some((material) => material.name === `ground:${skinId ?? 'reskin_tool_fx'}`)).toBe(true);
    const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1);
    for (let frame = 0; frame < 15; frame++) effects.update(1 / 30, quaternion);
    expect(object.children[0].quaternion.equals(quaternion)).toBe(true);
    expect(effects.renderEntities).toHaveLength(1);
    effects.update(1 / 30, quaternion);
    expect(effects.renderEntities).toEqual([]);
    expect(scene.children).toEqual([]);
    effects.dispose();
  },
);

it('shares FX geometry while keeping playback independent and discarding unused messages', async () => {
  const scene = new THREE.Scene();
  const effects = new ReskinEffects(scene);
  const rotation = new THREE.Quaternion();
  const first = await effects.prepare();
  const second = await effects.prepare();
  const unused = await effects.prepare();
  unused.dispose();
  effects.update(0, rotation);
  expect(scene.children).toHaveLength(2);
  const position = new THREE.Vector3(3, 0, 4);
  first.play(position, 'treasurechest');
  second.play(position, 'treasurechest');
  await new Promise(resolve => setTimeout(resolve, 0));
  const [a, b] = effects.renderEntities;
  const meshA = a.object.children[0].children[0].children[0] as THREE.Mesh;
  const meshB = b.object.children[0].children[0].children[0] as THREE.Mesh;
  expect(meshA.geometry).toBe(meshB.geometry);
  expect(meshA.material).toEqual(meshB.material);
  const release = vi.fn();
  meshA.geometry.addEventListener('dispose', release);
  // Moving the target later does not move its independently positioned puff.
  position.set(30, 0, 40);
  expect(a.footPosition.toArray()).toEqual([3, 0, 4]);
  a.object.userData.instance.remove();
  effects.update(0, rotation);
  expect(effects.renderEntities).toEqual([b]);
  expect(release).not.toHaveBeenCalled();
  for (let frame = 0; frame < 16; frame++) effects.update(1 / 30, rotation);
  expect(scene.children).toEqual([]);
  expect(release).not.toHaveBeenCalled();
  effects.dispose();
  expect(release).toHaveBeenCalledOnce();
});

it('cycles building skins while preserving the open container root, identity, state and saved foot', async () => {
  const world = setupWorld();
  const placement = new AnimatedBuildingPlacement(world, { treasurechest: TREASURE_CHEST_DEFINITION }, () => false);
  const record = { id: 'e_open_chest', transform: { position: [3, 0, 4] as const, rotationY: 0 },
    components: { building: { state: 'open' as const }, container: { slotCount: 9, slots: [] } } };
  const root = await placement.spawnFromSave('treasurechest', record);
  const skins = Object.keys(TREASURE_CHEST_DEFINITION.skinArchives!);
  const change = await placement.reskinTargets[0].prepareNextSkin();
  expect(placement.exportRecords()[0].record.components.building?.skinId).toBeUndefined();
  const fx = { play: vi.fn(), dispose: vi.fn() };
  const tool = actionTool('reskin_tool');
  // The tool forwards its message to the target's skin commit; it does not draw the FX.
  const doer = { position: world.player.position, hasTag: () => false, components: {} };
  expect(tool.entity.components.spellcaster!.castSpell({ ...placement.reskinTargets[0], preparedReskin: change, reskinFx: fx }, root.position, doer)).toBe(true);
  expect(fx.play).toHaveBeenCalledExactlyOnceWith(new THREE.Vector3(3, 0, 4), 'treasurechest');
  change.dispose();
  expect(world.scene.children).toEqual([root]);
  expect(root.userData.instance?.entityId).toBe(record.id);
  expect(placement.exportRecords()[0].record).toMatchObject({
    id: record.id, transform: record.transform, components: { building: { state: 'open', skinId: skins[0] } },
  });
  expect(root.userData.instance?.saveRecord.components.container).toEqual(record.components.container);
  // The final skin returns to the base rather than dropping an unsupported skin ID into the save.
  expect(nextReskin(skins, skins.at(-1))).toBeUndefined();
  expect(nextReskin(skins)).toBe(skins[0]);
  const stale = await placement.reskinTargets[0].prepareNextSkin();
  const fresh = await placement.reskinTargets[0].prepareNextSkin();
  expect(fresh.apply()).toBe(true);
  fx.play.mockClear();
  expect(stale.apply(fx)).toBe(false);
  expect(fx.play).not.toHaveBeenCalled();
  stale.dispose(); fresh.dispose();
});

it('reskins dropped items without changing their count or entity ID and preserves the skin on pickup', async () => {
  const world = setupWorld();
  const inventory = createPickupInventory();
  const picked = vi.spyOn(inventory, 'Equip');
  const manager = new GroundItemManager(world.scene, world.camera, world.renderer,
    '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', world.player);
  await manager.spawnFromSave('e_staff', {
    itemId: 'greenstaff', count: 1, remainingUses: 4, name: '拆解魔杖', icon: 'greenstaff.tex', atlas: 'images/inventoryimages.xml',
  }, new THREE.Vector3(3, 0, 4));
  const first = manager.reskinTargets[0];
  const change = await first.prepareNextSkin();
  const fx = { play: vi.fn(), dispose: vi.fn() };
  expect(change.apply(fx)).toBe(true);
  expect(fx.play).toHaveBeenCalledExactlyOnceWith(new THREE.Vector3(3, 0, 4), 'greenstaff');
  change.dispose();
  expect(first.isValid()).toBe(false);
  expect(manager.exportRecords()[0]).toMatchObject({ id: 'e_staff', transform: { position: [3, 0, 4] },
    components: { stack: { itemId: 'greenstaff', count: 1, remainingUses: 4, skinId: 'greenstaff_an' } } });
  expect(manager.reskinTargets[0].isValid()).toBe(true);
  const canvas = world.renderer.domElement;
  Object.assign(canvas, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
  vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([
    { object: manager.reskinTargets[0].model.children[0].children[0], point: new THREE.Vector3(), distance: 1 } as THREE.Intersection,
  ]);
  performPickupAction(manager.reskinTargets[0].model.userData.pickupTarget, createPickupDoer(world.player, inventory));
  expect(picked).toHaveBeenCalledWith(expect.objectContaining({ id: 'e_staff', prefab: 'greenstaff', skinId: 'greenstaff_an' }));
  expect(inventory.getEntity(equipmentSlotAddress('hand'))?.components.finiteuses.remaining).toBe(4);
  expect(manager.exportRecords()).toEqual([]);
});

it('selects an unskinnable target by tags and fails at the cast frame without changing it', async () => {
  const world = setupWorld();
  const equipped = createEquipmentExistenceState('HANDS');
  const tool = actionTool('reskin_tool');
  equipped.set(tool);
  const prepareNextSkin = vi.fn();
  const target: ReskinTarget = {
    ...reskinEntityFields, skins: [], id: 'e_target', prefabId: 'twigs',
    model: new THREE.Group(), position: new THREE.Vector3(1, 0, 0), isValid: () => true, prepareNextSkin,
  };
  let commit: (() => void) | undefined;
  const animation = {
    isReskinning: false, cancelEmote: vi.fn(), setFacing: vi.fn(),
    playReskin: vi.fn((callback: () => void) => { commit = callback; animation.isReskinning = true; return true; }),
    cancelReskin: vi.fn(() => { animation.isReskinning = false; }),
  };
  const fx = { play: vi.fn(), dispose: vi.fn() };
  const effects = { prepare: vi.fn(async () => fx) };
  const controller = new ReskinActionController(world, animation as unknown as WilsonAnimationController,
    { stop: vi.fn(), goToPoint: vi.fn(() => true), destination: undefined }, equipped, () => [target], effects);
  try {
    expect(await controller.request(target)).toBe(true);
    expect(prepareNextSkin).not.toHaveBeenCalled();
    controller.update(1 / 30);
    expect(animation.playReskin).toHaveBeenCalledOnce();
    commit!();
    expect(fx.play).not.toHaveBeenCalled();
    expect(fx.dispose).toHaveBeenCalledOnce();
    expect(tool.entity._cached_reskinname!.size).toBe(0);
  } finally { controller.dispose(); }
});

it.each(['unequip', 'while loading'])(
  'discards pending work and emits no effect after %s cancellation', async (reason) => {
    const world = setupWorld();
    const equipped = createEquipmentExistenceState('HANDS');
    equipped.set(actionTool('reskin_tool'));
    let manual = false, valid = true;
    const apply = vi.fn(() => true), dispose = vi.fn();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const target: ReskinTarget = { ...reskinEntityFields, id: 'e_target', prefabId: 'icebox', model: new THREE.Group(), position: new THREE.Vector3(1, 0, 0),
      isValid: () => valid, prepareNextSkin: async () => { if (reason === 'while loading') await blocked; return { apply, dispose }; } };
    let callback: (() => void) | undefined;
    const animation = { isReskinning: false, cancelEmote: vi.fn(), setFacing: vi.fn(),
      playReskin: vi.fn((cast: () => void) => { callback = cast; animation.isReskinning = true; return true; }),
      cancelReskin: vi.fn(() => { animation.isReskinning = false; }) };
    const fx = { play: vi.fn(), dispose: vi.fn() };
    const effects = { prepare: vi.fn(async () => fx) };
    const controller = new ReskinActionController(world, animation as unknown as WilsonAnimationController,
      { stop: vi.fn(), goToPoint: vi.fn(() => true), destination: undefined }, equipped,
      () => [target], effects, () => manual);
    const request = controller.request(target);
    if (reason === 'while loading') { controller.cancel(); release(); expect(await request).toBe(false); }
    else {
      expect(await request).toBe(true);
      controller.update(1 / 30);
      expect(animation.playReskin).toHaveBeenCalledOnce();
      if (reason === 'manual') manual = true;
      if (reason === 'unequip') equipped.set(null);
      if (reason === 'target removed') valid = false;
      if (reason === 'escape') window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Escape' }));
      controller.update(1 / 30);
      callback?.();
    }
    expect(apply).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
    expect(fx.play).not.toHaveBeenCalled();
    expect(fx.dispose).toHaveBeenCalledOnce();
    controller.dispose();
  },
);
