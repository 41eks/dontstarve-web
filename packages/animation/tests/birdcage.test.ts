
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAnimatedSprite, loadBuildOverride, type SpriteController } from '../src/sprite';
import { birdcage_init_fn } from '../src/prefabskin';
import { BIRDCAGE_DEFINITION } from '../../prefab/src/birdcage';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import type { WorldContext } from '../../prefab/src/worldContext';
import { BIRD_PERISH_TIME, configureBirdEntity } from '../../prefab/src/birds';
import { ItemEntity, type InventoryStack } from '@dontstarve-web/inventory';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { prefabDisplay } from '@dontstarve-web/display';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const relative = url.slice(url.indexOf('/dst/data/') + '/dst/data/'.length);
    return new Response(await readFile(new URL(`../../../public/dst/data/${relative}`, import.meta.url)));
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function spawn(animation: string, skinId?: string) {
  const skin = skinId === undefined ? undefined : birdcage_init_fn(skinId);
  return createAnimatedSprite('/dst/data/anim', skin?.archive ?? BIRDCAGE_DEFINITION.archive, {
    initialAnimation: animation, scale: BIRDCAGE_DEFINITION.scale, skinArchive: skin?.skinArchive,
  });
}

function meshOf(model: THREE.Group) {
  const meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>[] = [];
  model.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object as typeof meshes[number]); });
  expect(meshes).toHaveLength(1);
  return meshes[0];
}

it('AddOverrideBuild draws the caged bird from its own build and ClearOverrideBuild restores the cage-only frame', async () => {
  const model = await spawn('idle_bird');
  const controller = model.userData.animationController as SpriteController;
  const bare = meshOf(model).geometry.drawRange.count;
  const canary = await loadBuildOverride('/dst/data/anim', 'canary_build.zip');
  controller.addOverrideBuild('canary_build', canary);
  expect(fetch).toHaveBeenCalledWith('/dst/data/anim/canary_build.zip');
  // The bird symbols come from the second build, so the frame uses both atlases and more geometry.
  expect(meshOf(model).material.length).toBeGreaterThan(1);
  expect(meshOf(model).geometry.drawRange.count).toBeGreaterThan(bare);
  controller.clearOverrideBuild('canary_build');
  expect(meshOf(model).geometry.drawRange.count).toBe(bare);
  canary.dispose();
});

it('keeps the bird override on a skinned cage, with gothicp using the gothic build', async () => {
  const model = await spawn('idle_bird', 'birdcage_gothicp');
  expect(fetch).toHaveBeenCalledWith('/dst/data/anim/dynamic/birdcage_gothic.zip');
  expect(fetch).not.toHaveBeenCalledWith('/dst/data/anim/dynamic/birdcage_gothicp.zip');
  const controller = model.userData.animationController as SpriteController;
  const bird = await loadBuildOverride('/dst/data/anim', 'crow_build.zip');
  const before = meshOf(model).geometry.drawRange.count;
  controller.addOverrideBuild('crow_build', bird);
  expect(meshOf(model).geometry.drawRange.count).toBeGreaterThan(before);
  expect(Object.keys(BIRDCAGE_DEFINITION.skinArchives!)).toHaveLength(8);
  bird.dispose();
});

it('draws the bird slot across reskin, sleep and restore, and clears it when the bird leaves', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { createElement: () => ({ setAttribute: vi.fn(), style: {} }), body: { appendChild: vi.fn() } });
  const awake = createSignal(true), items: ItemEntity[] = [];
  const spawnItem = (state: InventoryStack) => {
    const item = new ItemEntity(state);
    item.configure({ perishTime: BIRD_PERISH_TIME, configureEntity: configureBirdEntity });
    items.push(item);
    return item;
  };
  const world = { scene: new THREE.Scene(), player: new THREE.Object3D(), ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(), renderer: { domElement: new EventTarget() }, spawnItem,
    tickingarea: () => createMemo(() => awake.get()) } as unknown as WorldContext;
  const placement = new AnimatedBuildingPlacement(world, { birdcage: BIRDCAGE_DEFINITION }, () => true);
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    await placement.spawn('birdcage');
    const model = world.scene.children[0] as THREE.Group, instance = prefabInstance(model)!;
    const display = prefabDisplay(model)!, cage = instance.components.birdcage!;
    const birdSlot = instance.sprite.sprite.peek().appearance.get('anim-state:bird');
    expect(birdSlot?.kind).toBe('anim-state');
    if (birdSlot?.kind !== 'anim-state') throw new Error('The cage has no bird slot');
    expect(fetch).not.toHaveBeenCalledWith('/dst/data/anim/canary_build.zip');
    const bird = spawnItem({ itemId: 'canary', count: 1, freshnessPercent: .7 });
    expect(cage.occupiable!.Occupy(bird)).toBe(true);
    await tick(); await display.artLoaded();
    instance.sprite.start('idle_bird');
    expect(birdSlot.state.peek().overrideBuilds).toEqual(['canary_build.zip']);
    expect(fetch).toHaveBeenCalledWith('/dst/data/anim/canary_build.zip');
    expect(fetch).not.toHaveBeenCalledWith('/dst/data/anim/crow_build.zip');
    const birdTextures = birdSlot.art!.peekBuild('canary_build.zip')!.materials.map(material => material.map);
    const drawsBird = (model: THREE.Group) => meshOf(model).material.some(material => birdTextures.includes(material.map));
    const plainAtlases = meshOf(model).material.map(material => material.map?.uuid);
    expect(drawsBird(model)).toBe(true);

    instance.skinId = 'birdcage_gothicp';
    await display.artLoaded();
    expect(meshOf(model).material.map(material => material.map?.uuid)).not.toEqual(plainAtlases);
    expect(drawsBird(model)).toBe(true);
    expect(instance.sprite.sprite.peek().appearance.get('anim-state:bird')).toBe(birdSlot);
    expect(cage.getBird()).toBe(bird);
    const saved = placement.exportRecords()[0];

    awake.set(false); await tick();
    expect(instance.status.peek()).toBe('asleep');
    expect(model.parent).toBeNull();
    expect(instance.sprite.loaded).toBe(false);
    expect(model.getObjectsByProperty('isMesh', true)).toHaveLength(0);
    expect(cage.getBird()).toBe(bird);
    awake.set(true); await tick(); await display.artLoaded();
    expect(model.parent).toBe(world.scene);
    expect(drawsBird(model)).toBe(true);
    expect(placement.exportRecords()[0]).toEqual(saved);

    const withBird = meshOf(model).geometry.drawRange.count;
    expect(cage.occupiable!.Harvest()).toBe(bird);
    instance.sprite.start('idle_bird');
    expect(birdSlot.state.peek().overrideBuilds).toEqual([]);
    await tick();
    expect(meshOf(model).geometry.drawRange.count).toBeLessThan(withBird);
    expect(drawsBird(model)).toBe(false);
    instance.remove(); await tick();
    expect(instance.sprite.sprite.peek().appearance.has('anim-state:bird')).toBe(false);
    expect(model.parent).toBeNull();

    const restored = await placement.spawnFromSave('birdcage', saved.record);
    const restoredInstance = prefabInstance(restored)!;
    await prefabDisplay(restored)!.artLoaded();
    expect(restoredInstance.skinId).toBe('birdcage_gothicp');
    expect(restoredInstance.components.birdcage!.save()).toEqual(saved.record.components.birdcage);
    expect(drawsBird(restored)).toBe(true);
    for (const key of ['components', 'animationController', 'display', 'skinIdSignal', 'removed']) {
      expect(Object.hasOwn(restored.userData, key), key).toBe(false);
    }
  } finally {
    placement.dispose();
    for (const item of items) item.destroy();
  }
});
