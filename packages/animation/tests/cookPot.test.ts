import { findActionEntity } from '../../prefab/src/actionEntity';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { BEEFALO_FEED_COOK_TIME, COOK_POT_DEFINITION, cookPotState } from '../../prefab/src/cook_pot';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import type { WorldContext } from '../../prefab/src/worldContext';
import { findImage, loadBuild, smallHash } from '../src/animationAssets';
import type { TransientSpriteAnimationController } from '../src/sprite';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { reskinEntity } from '../../prefab/src/reskin_tool';

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
  const animation = prefabInstance(model)!.sprite as TransientSpriteAnimationController;
  click();
  expect(changed).toHaveBeenLastCalledWith({ buildId: 'cookpot', model, isOpen: true });
  const container = (findActionEntity(model)?.components ?? prefabInstance(model)!.components).container;
  expect(placement.performContainerAction(model, 'COOK', world.player)).toBe(false);
  expect(cookPotState(model)).toBeUndefined();
  expect(animation.currentAnimation).toBe('cooking_pre_loop');
  container.OnLoad({ items: Object.fromEntries(['twigs', 'red_cap', 'red_cap', 'red_cap']
    .map((itemId, index) => [String(index + 1), { itemId, count: 1 }])) });
  expect(placement.performContainerAction(model, 'COOK', world.player)).toBe(true);
  expect(container.IsEmpty()).toBe(true);
  expect(changed).toHaveBeenLastCalledWith({ buildId: 'cookpot', model, isOpen: false });
  expect(animation.currentAnimation).toBe('cooking_loop');
  expect(placement.performContainerAction(model, 'COOK', world.player)).toBe(true);
  placement.update(3);
  const saved = placement.exportRecords()[0].record;
  expect(saved.components.stewer).toEqual({ product: 'beefalofeed', phase: 'cooking', remainingSeconds: BEEFALO_FEED_COOK_TIME - 3,
    ingredient_prefabs: ['twigs', 'red_cap', 'red_cap', 'red_cap'] });
  placement.dispose();

  const restoredPlacement = new AnimatedBuildingPlacement(world, { cookpot: COOK_POT_DEFINITION }, () => true, changed);
  const restored = await restoredPlacement.spawnFromSave('cookpot', saved);
  const restoredAnimation = prefabInstance(restored)!.sprite as TransientSpriteAnimationController;
  const restoredStewer = (findActionEntity(restored)?.components ?? prefabInstance(restored)!.components).stewer;
  const skinSignal = prefabInstance(restored)!.sprite.skinId;
  expect(restoredAnimation.currentAnimation).toBe('cooking_loop');
  // The display loads the pot's art; one-shot clips play out once it is drawn.
  await vi.waitFor(() => expect(prefabInstance(restored)!.sprite.loaded).toBe(true));
  restoredPlacement.update(1);
  expect(reskinEntity(restoredPlacement.reskinTargets[0])).toBe(true);
  expect(skinSignal.peek()).toBe('cookpot_cauldron');
  expect((findActionEntity(restored)?.components ?? prefabInstance(restored)!.components).stewer).toBe(restoredStewer);
  expect(cookPotState(restored)?.remainingSeconds).toBeCloseTo(BEEFALO_FEED_COOK_TIME - 4);
  expect(prefabInstance(restored)!.sprite.currentAnimation).toBe('cooking_loop');
  restoredPlacement.update(BEEFALO_FEED_COOK_TIME);
  expect(prefabInstance(restored)!.sprite.currentAnimation).toBe('cooking_pst');
  for (let i = 0; i < 30; i++) restoredPlacement.update(.1);
  expect(prefabInstance(restored)!.sprite.currentAnimation).toBe('idle_full');
  expect(cookPotState(restored)).toMatchObject({ product: 'beefalofeed', phase: 'done', remainingSeconds: 0 });
  changed.mockClear(); click();
  expect(changed).not.toHaveBeenCalled();
  const food = await loadBuild('cook_pot_food11.zip', '/dst/data/anim');
  const foodImage = findImage(food.build, smallHash('beefalofeed'), 0)!;
  expect(foodImage).toBeDefined();
  const drawsAtlas = (model: THREE.Object3D, pixels: Uint8Array) => {
    const mesh = model.children[0].children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
    return mesh.geometry.drawRange.count > 0 && mesh.geometry.groups.some(({ materialIndex }) =>
      (mesh.material[materialIndex!].map!.image as { data: Uint8Array }).data === pixels);
  };
  // The display loads the food build the AnimState names and redraws the pot with it.
  await vi.waitFor(() => expect(drawsAtlas(restored, food.atlases[0].pixels)).toBe(true));
  const fullRecord = restoredPlacement.exportRecords()[0].record;
  expect(fullRecord.id).toBe(saved.id);
  expect(fullRecord.transform).toEqual(saved.transform);
  expect(fullRecord.components.building?.skinId).toBe('cookpot_cauldron');
  const full = await restoredPlacement.spawnFromSave('cookpot', fullRecord);
  expect(prefabInstance(full)!.sprite.currentAnimation).toBe('idle_full');
  const high = await restoredPlacement.spawnFromSave('cookpot', { id: 'pot:kabobs',
    transform: { position: [4, 0, 2], rotationY: 0 }, components: { building: { state: 'closed' },
      stewer: { product: 'kabobs', phase: 'done', remainingSeconds: 0 } } });
  const ordinaryFood = await loadBuild('cook_pot_food.zip', '/dst/data/anim');
  expect(findImage(ordinaryFood.build, smallHash('kabobs'), 0)).toBeDefined();
  await vi.waitFor(() => expect(drawsAtlas(high, ordinaryFood.atlases[0].pixels)).toBe(true));
  // SetProductSymbol: kabobs fills the pot high; the food comes from the recipe's build and symbol.
  const declared = prefabInstance(high)!.sprite.sprite.peek().appearance.get('anim-state')!;
  if (declared.kind !== 'anim-state') throw new Error('Missing the pot AnimState');
  const product = declared.state.peek();
  expect(product.overrides.get(smallHash('swap_cooked'))?.sources).toEqual([{ archive: 'cook_pot_food.zip', symbol: smallHash('kabobs') }]);
  expect([...product.shownLayers]).toEqual([smallHash('swap_high')]);
  expect([...product.hiddenLayers].sort()).toEqual([smallHash('swap_mid'), smallHash('swap_low')].sort());
  const receiver = { giveItem: vi.fn(() => true) };
  expect((findActionEntity(full)?.components ?? prefabInstance(full)!.components).stewer.Harvest(receiver)).toBe(true);
  expect(receiver.giveItem).toHaveBeenCalledWith('beefalofeed', 1, new THREE.Vector3(...saved.transform.position));
  expect(prefabInstance(full)!.sprite.currentAnimation).toBe('idle_empty');
  const emptyRecord = restoredPlacement.exportRecords().find(({ record }) => record.id === fullRecord.id && !record.components.stewer)!.record;
  expect(emptyRecord.components.building?.skinId).toBe('cookpot_cauldron');
  expect(emptyRecord.transform).toEqual(saved.transform);
  const empty = await restoredPlacement.spawnFromSave('cookpot', emptyRecord);
  expect((findActionEntity(empty)?.components ?? prefabInstance(empty)!.components).container.canbeopened).toBe(true);
  expect(prefabInstance(empty)!.listTags()).not.toContain('donecooking');
  expect(prefabInstance(empty)!.sprite.currentAnimation).toBe('idle_empty');
  restoredPlacement.dispose();
});
