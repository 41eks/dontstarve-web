import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { BEEFALO_FEED_COOK_TIME, COOK_POT_DEFINITION, cookPotState, startCookPotCooking } from '../../prefab/src/cook_pot';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import type { WorldContext } from '../../prefab/src/worldContext';
import { findImage, loadBuild, smallHash } from '../src/animationAssets';
import type { TransientSpriteAnimationController } from '../src/sprite';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('cooks with source food layers, resumes saved progress and preserves the product through reskinning', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = url.slice(url.indexOf('/dst/data/') + '/dst/data/'.length);
    return new Response(await readFile(new URL(`../../../public/dst/data/${path}`, import.meta.url)));
  }));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { createElement: () => ({ setAttribute: vi.fn(), style: {} }), body: { appendChild: vi.fn() } });
  const canvas = new EventTarget();
  const world = { scene: new THREE.Scene(), player: new THREE.Object3D(), ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(), renderer: { domElement: canvas } } as unknown as WorldContext;
  const changed = vi.fn();
  const placement = new AnimatedBuildingPlacement(world, { cookpot: COOK_POT_DEFINITION }, () => true, changed);
  vi.spyOn(PointerRaycaster.prototype, 'trackPointer').mockImplementation(() => {});
  vi.spyOn(PointerRaycaster.prototype, 'raycastPointer').mockImplementation(objects =>
    ({ object: objects[0], point: new THREE.Vector3() }) as THREE.Intersection);
  const click = () => canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0 }));
  const model = await placement.spawnFromSave('cookpot', { id: 'pot:feed',
    transform: { position: [1, 0, 2], rotationY: 0 }, components: { building: { state: 'closed', skinId: 'cookpot_candy' } } });
  const animation = model.userData.animationController as TransientSpriteAnimationController;
  click();
  expect(changed).toHaveBeenLastCalledWith({ buildId: 'cookpot', model, isOpen: true });
  const failedConsume = vi.fn(() => false);
  expect(placement.performOpenAction(model, context => startCookPotCooking(context, failedConsume))).toBe(false);
  expect(cookPotState(model)).toBeUndefined();
  expect(animation.currentAnimation).toBe('cooking_pre_loop');
  const consume = vi.fn(() => true);
  expect(placement.performOpenAction(model, context => startCookPotCooking(context, consume))).toBe(true);
  expect(consume).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenLastCalledWith({ buildId: 'cookpot', model, isOpen: false });
  expect(animation.currentAnimation).toBe('cooking_loop');
  expect(placement.performOpenAction(model, context => startCookPotCooking(context, consume))).toBe(false);
  placement.update(3);
  const saved = placement.exportRecords()[0].record;
  expect(saved.components.stewer).toEqual({ product: 'beefalofeed', phase: 'cooking', remainingSeconds: BEEFALO_FEED_COOK_TIME - 3 });
  placement.dispose();

  const restoredPlacement = new AnimatedBuildingPlacement(world, { cookpot: COOK_POT_DEFINITION }, () => true, changed);
  const restored = await restoredPlacement.spawnFromSave('cookpot', saved);
  const restoredAnimation = restored.userData.animationController as TransientSpriteAnimationController;
  expect(restoredAnimation.currentAnimation).toBe('cooking_loop');
  const replacement = await restoredPlacement.reskinTargets[0].prepareNextSkin();
  restoredPlacement.update(1);
  expect(replacement!.apply()).toBe(true);
  replacement!.dispose();
  expect(cookPotState(restored)?.remainingSeconds).toBeCloseTo(BEEFALO_FEED_COOK_TIME - 4);
  expect(restored.userData.animationController.currentAnimation).toBe('cooking_loop');
  restoredPlacement.update(BEEFALO_FEED_COOK_TIME);
  expect(restored.userData.animationController.currentAnimation).toBe('cooking_pst');
  for (let i = 0; i < 30; i++) restoredPlacement.update(.1);
  expect(restored.userData.animationController.currentAnimation).toBe('idle_full');
  expect(cookPotState(restored)).toEqual({ product: 'beefalofeed', phase: 'done', remainingSeconds: 0 });
  changed.mockClear(); click();
  expect(changed).not.toHaveBeenCalled();
  const food = await loadBuild('cook_pot_food11.zip', '/dst/data/anim');
  const foodImage = findImage(food.build, smallHash('beefalofeed'), 0)!;
  expect(foodImage).toBeDefined();
  const mesh = restored.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  expect(mesh.geometry.groups.some(({ materialIndex }) =>
    (mesh.material[materialIndex!].map!.image as { data: Uint8Array }).data === food.atlases[0].pixels)).toBe(true);
  expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
  const fullRecord = restoredPlacement.exportRecords()[0].record;
  expect(fullRecord.id).toBe(saved.id);
  expect(fullRecord.transform).toEqual(saved.transform);
  expect(fullRecord.components.building?.skinId).toBe('cookpot_cauldron');
  const full = await restoredPlacement.spawnFromSave('cookpot', fullRecord);
  expect(full.userData.animationController.currentAnimation).toBe('idle_full');
  const unusedMaterial = full.userData.ownedSpriteMaterials.at(-1) as THREE.Material;
  const disposed = vi.spyOn(unusedMaterial, 'dispose');
  restoredPlacement.dispose();
  expect(disposed).toHaveBeenCalledTimes(1);
});
