import { prefabDisplay } from '@dontstarve-web/display';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeDyn } from '../src/decodeDyn';
import { loadAnimationArchive, loadSpriteSkinArchive, smallHash } from '../src/animationAssets';
import { createAnimatedSprite, type SpriteAnimationController } from '../src/sprite';
import { setSpriteEntityRenderOrder } from '../src/renderOrder';
import definitions from '../../prefab/src/definitions.json' with { type: 'json' };
import { AnimatedBuildingPlacement, type AnimatedBuildingDefinition } from '../../prefab/src/animatedBuildingPlacement';
import { COOK_POT_DEFINITION } from '../../prefab/src/cook_pot';
import { RESEARCH_LAB_DEFINITIONS } from '../../prefab/src/scienceprototyper';
import { FIRE_PIT_DEFINITION } from '../../prefab/src/firepit';
import { ICE_BOX_DEFINITION } from '../../prefab/src/icebox';
import { DRAGONFLY_CHEST_DEFINITION } from '../../prefab/src/dragonfly_chest';
import { CAMPFIRE_DEFINITION } from '../../prefab/src/campfire';
import { SALT_BOX_DEFINITION } from '../../prefab/src/saltbox';
import { NIGHT_LIGHT_DEFINITION } from '../../prefab/src/nightlight';
import { PIG_HOUSE_DEFINITION } from '../../prefab/src/pighouse';
import { MUSHROOM_LIGHT_DEFINITIONS } from '../../prefab/src/mushroom_light';
import { createMemo, createSignal } from '../../signals/src';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import type { PlacementSaveRecord } from '../../prefab/src/saveRecord';
import type { WorldContext } from '../../prefab/src/worldContext';
import { recipeSkins } from '../../ui/src/categories/generated';
import { reskinEntity } from '../../prefab/src/reskin_tool';

const prefabIds = [
  'cookpot', 'researchlab2', 'researchlab4',
] as const;
const buildingDefinitions = {
  cookpot: COOK_POT_DEFINITION, firepit: FIRE_PIT_DEFINITION, icebox: ICE_BOX_DEFINITION,
  ...RESEARCH_LAB_DEFINITIONS,
  dragonflychest: DRAGONFLY_CHEST_DEFINITION, campfire: CAMPFIRE_DEFINITION,
  saltbox: SALT_BOX_DEFINITION, nightlight: NIGHT_LIGHT_DEFINITION, pighouse: PIG_HOUSE_DEFINITION,
  ...MUSHROOM_LIGHT_DEFINITIONS,
};
// One plain build; the tests below exercise symbol-only and layered skins.
const cases = [{ prefabId: 'cookpot', skinId: 'cookpot_candy', archive: 'dynamic/cookpot_candy.zip' }] as const;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const relative = url.slice(url.indexOf('/dst/data/') + '/dst/data/'.length);
    try {
      const bytes = await readFile(new URL(`../../../public/dst/data/${relative}`, import.meta.url));
      return new Response(bytes);
    } catch {
      return new Response(null, { status: 404 });
    }
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function options(prefabId: typeof prefabIds[number], skinId: string) {
  const definition: AnimatedBuildingDefinition = buildingDefinitions[prefabId];
  const skin = definition.skinInit?.(skinId);
  return {
    initialAnimation: definition.idleAnimation ?? 'idle',
    scale: definition.scale,
    skinArchive: skin?.skinArchive ?? definition.skinArchives![skinId],
    skinSymbols: definition.skinSymbols,
    baseSymbols: definition.baseSymbols,
    skinAnimationBanks: definition.skinAnimationBanks?.[skinId],
  };
}

function meshOf(model: THREE.Group) {
  const meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>[] = [];
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object as typeof meshes[number]);
  });
  expect(meshes).toHaveLength(1);
  return meshes[0];
}

function dispose(model: THREE.Group) {
  const mesh = meshOf(model);
  mesh.geometry.dispose();
  for (const material of mesh.material) {
    material.map?.dispose();
    material.dispose();
  }
}

describe('DST building skins', () => {
  it('covers crafting skin metadata for plain, symbol-only and layered buildings', () => {
    for (const prefabId of prefabIds) {
      expect(Object.keys(definitions.animatedBuildings[prefabId].skinArchives).sort())
        .toEqual(recipeSkins[prefabId].map(({ id }) => id).sort());
    }
  });

  it('decodes the original atlas package without modifying its bytes', async () => {
    const bytes = await readFile(new URL('../../../public/dst/data/anim/dynamic/cookpot_candy.dyn', import.meta.url));
    const original = Uint8Array.from(bytes);
    const decoded = decodeDyn(bytes);
    expect(Uint8Array.from(bytes)).toEqual(original);
    expect(Object.keys(unzipSync(decoded))).toContain('atlas-0.tex');
    expect(() => decodeDyn(new Uint8Array(16))).toThrow('Invalid DST dynamic atlas package');
  });

  it.each(cases)('$skinId loads, animates, and stays one render-order entity', async ({ prefabId, skinId, archive }) => {
    const definition = definitions.animatedBuildings[prefabId];
    const model = await createAnimatedSprite('/dst/data/anim', definition.archive, options(prefabId, skinId));
    const mesh = meshOf(model);
    expect(mesh.visible).toBe(true);
    expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
    expect(mesh.material.some((material) => ((material.map?.image as { width?: number })?.width ?? 0) > 0)).toBe(true);
    expect(fetch).toHaveBeenCalledWith(`/dst/data/anim/${archive}`);
    expect(fetch).toHaveBeenCalledWith(`/dst/data/anim/${archive.replace(/\.zip$/, '.dyn')}`);
    setSpriteEntityRenderOrder(model, 7);
    expect(mesh.parent!.renderOrder).toBe(7);
    const animation = model.userData.animationController as SpriteAnimationController;
    const complete = vi.fn(() => animation.start(options(prefabId, skinId).initialAnimation));
    animation.playOnce('place', complete);
    for (let frame = 0; frame < 100; frame++) animation.update(0.1);
    expect(complete).toHaveBeenCalledTimes(1);
    if (prefabId.startsWith('researchlab')) {
      animation.start('proximity_loop');
      for (let frame = 0; frame < 70; frame++) animation.update(1 / 30);
    }
    expect(meshOf(model)).toBe(mesh);
    expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
    expect(Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
    dispose(model);
  });

  it('draws the researchlab4 hat through an AnimState override and swaps it on reskin', async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { createElement: () => ({ setAttribute: vi.fn(), style: {} }), body: { appendChild: vi.fn() } });
    const world = { scene: new THREE.Scene(), player: new THREE.Object3D(), ground: new THREE.Group(),
      camera: new THREE.PerspectiveCamera(), renderer: { domElement: new EventTarget() } } as unknown as WorldContext;
    const placement = new AnimatedBuildingPlacement(world, { researchlab4: RESEARCH_LAB_DEFINITIONS.researchlab4 }, () => true);
    try {
      const model = await placement.spawnFromSave('researchlab4', { id: 'lab:hat', transform: { position: [3, 0, 4], rotationY: 0 },
        components: { building: { state: 'idle', skinId: 'researchlab4_chef' } } });
      const sprite = prefabInstance(model)!.sprite;
      const hat = () => {
        const declared = sprite.sprite.peek().appearance.get('anim-state');
        if (declared?.kind !== 'anim-state') throw new Error('researchlab4 declares no AnimState');
        return declared.state.peek().overrides.get(smallHash('machine_hat'))?.sources.map(({ archive }) => archive);
      };
      // researchlab4_init_fn: OverrideItemSkinSymbol("machine_hat", build_name, "machine_hat", GUID, "researchlab4"), no SetSkin.
      expect(sprite.sprite.peek().appearance.has('skin')).toBe(false);
      expect(hat()).toEqual(['dynamic/researchlab4_chef.zip', 'researchlab4.zip']);
      await prefabDisplay(model).artLoaded();
      const base = await createAnimatedSprite('/dst/data/anim', 'researchlab4.zip', { initialAnimation: 'idle', scale: 0.02 });
      const mesh = meshOf(model), baseMesh = meshOf(base);
      // Only the hat changes: the machine keeps every part of the base build.
      expect(mesh.geometry.drawRange.count).toBe(baseMesh.geometry.drawRange.count);
      expect(Array.from(mesh.geometry.getAttribute('position').array))
        .not.toEqual(Array.from(baseMesh.geometry.getAttribute('position').array));
      dispose(base);

      // Reskinning runs researchlab4_clear_fn, then the next skin's init_fn, on the same AnimState.
      expect(reskinEntity(placement.reskinTargets[0])).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 0));
      const next = sprite.skinId.peek();
      expect(hat()).toEqual(next === undefined ? undefined
        : [RESEARCH_LAB_DEFINITIONS.researchlab4.skinArchives![next], 'researchlab4.zip']);
    } finally { placement.dispose(); }
  });

  it('uses the merchant animation bank and merges the pod FX bank into its main mesh', async () => {
    const merchant = await loadSpriteSkinArchive('dynamic/researchlab4_merchant.zip', '/dst/data/anim');
    const original = await loadAnimationArchive('researchlab4.zip', '/dst/data/anim');
    expect(merchant.animations!.animations[0].bankHash).toBe(smallHash('researchlab4'));
    expect(merchant.animations!.animations[0].bankHash).toBe(original.animations.animations[0].bankHash);
    const withFx = await createAnimatedSprite('/dst/data/anim', 'researchlab2.zip', options('researchlab2', 'researchlab2_pod'));
    const withoutFx = await createAnimatedSprite('/dst/data/anim', 'researchlab2.zip', {
      ...options('researchlab2', 'researchlab2_pod'), skinAnimationBanks: [],
    });
    for (const model of [withFx, withoutFx]) {
      (model.userData.animationController as SpriteAnimationController).start('proximity_loop');
    }
    let hasFx = false;
    for (let frame = 0; frame < 60; frame++) {
      for (const model of [withFx, withoutFx]) model.userData.animationController.update(1 / 30);
      hasFx ||= meshOf(withFx).geometry.drawRange.count > meshOf(withoutFx).geometry.drawRange.count;
    }
    expect(hasFx).toBe(true);
    dispose(withFx);
    dispose(withoutFx);
  });

  it.each(['cookpot'] as const)('%s keeps its selected skin through preview, placement, and restoration', async (prefabId) => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', {
      createElement: () => ({ setAttribute: vi.fn(), style: {} }),
      body: { appendChild: vi.fn() },
    });
    const canvas = new EventTarget();
    const world = {
      scene: new THREE.Scene(), player: new THREE.Object3D(), ground: new THREE.Group(),
      camera: new THREE.PerspectiveCamera(), renderer: { domElement: canvas },
    } as unknown as WorldContext;
    const skinId = recipeSkins[prefabId][0].id;
    const consume = vi.fn(() => true);
    const definition = buildingDefinitions[prefabId];
    const skinInit = definition.skinInit ? vi.fn(definition.skinInit) : undefined;
    const placement = new AnimatedBuildingPlacement(world, { [prefabId]: { ...definition, skinInit } }, consume);
    vi.spyOn(PointerRaycaster.prototype, 'trackPointer').mockImplementation(() => {});
    vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(new THREE.Vector3(3, 0, 4));
    vi.spyOn(PointerRaycaster.prototype, 'isOverGround', 'get').mockReturnValue(true);
    await placement.begin(prefabId, skinId);
    if (skinInit) expect(skinInit).toHaveBeenCalledExactlyOnceWith(skinId);
    expect(placement.exportRecords()).toHaveLength(0);
    expect(lookupPrefabInstance(world.scene.children[0])?.skinId).toBe(skinId);
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0 }));
    expect(consume).toHaveBeenCalledWith(prefabId);
    for (let frame = 0; frame < 100; frame++) placement.update(0.1);
    const record = placement.exportRecords()[0].record;
    expect(record.components.building).toEqual({ state: definition.interaction ? 'closed' : 'idle', skinId });
    expect(record.transform.position).toEqual([3, 0, 4]);
    const restored = await placement.spawnFromSave(prefabId, record as PlacementSaveRecord);
    if (skinInit) expect(skinInit).toHaveBeenCalledTimes(2);
    expect(lookupPrefabInstance(restored)?.skinId).toBe(skinId);
    expect(placement.exportRecords()[1].record).toEqual(record);
    expect(() => placement.spawn(prefabId, 'missing_skin')).toThrow('Unsupported');
  });

  it('commits skins through the json without replacing the sprite and rejects a removed target', async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { createElement: () => ({ setAttribute: vi.fn(), style: {} }), body: { appendChild: vi.fn() } });
    const world = { scene: new THREE.Scene(), player: new THREE.Object3D(), ground: new THREE.Group(),
      camera: new THREE.PerspectiveCamera(), renderer: { domElement: new EventTarget() } } as unknown as WorldContext;
    const placement = new AnimatedBuildingPlacement(world, { researchlab4: RESEARCH_LAB_DEFINITIONS.researchlab4 }, () => true);
    const model = placement.spawnFromSave('researchlab4', { id: 'lab:signal', transform: { position: [3, 0, 4], rotationY: 0 },
      components: { building: { state: 'idle' } } });
    await prefabDisplay(model)!.artLoaded();
    const signal = prefabInstance(model)!.sprite.skinId;
    const changes: unknown[] = [];
    const stop = signal.subscribe((skinId: unknown) => changes.push(skinId));
    const originalMesh = meshOf(model);
    const disposeOldGeometry = vi.spyOn(originalMesh.geometry, 'dispose');
    expect(signal.peek()).toBeUndefined();
    expect(meshOf(model)).toBe(originalMesh);
    expect(changes).toEqual([]);

    expect(reskinEntity(placement.reskinTargets[0])).toBe(true);
    expect(changes).toEqual([signal.peek()]);
    expect(signal.peek()).toBeDefined();
    await prefabDisplay(model).artLoaded();
    expect(meshOf(model)).toBe(originalMesh);
    expect(disposeOldGeometry).not.toHaveBeenCalled();
    expect(placement.exportRecords()[0].record).toMatchObject({ id: 'lab:signal',
      transform: { position: [3, 0, 4], rotationY: 0 }, components: { building: { skinId: signal.peek() } } });
    const removed = placement.reskinTargets[0];
    const disposeCurrent = vi.spyOn(meshOf(model).geometry, 'dispose');
    placement.dispose();
    expect(reskinEntity(removed)).toBe(false);
    expect(disposeCurrent).toHaveBeenCalledOnce();
    expect(changes).toHaveLength(1);
    stop();
  });

  it('releases a building sprite outside the tickingarea and reloads its logical animation and skin', async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { createElement: () => ({ setAttribute: vi.fn(), style: {} }), body: { appendChild: vi.fn() } });
    const awake = createSignal(true);
    const world = { scene: new THREE.Scene(), player: new THREE.Object3D(), ground: new THREE.Group(),
      camera: new THREE.PerspectiveCamera(), renderer: { domElement: new EventTarget() },
      tickingarea: () => createMemo(() => awake.get()) } as unknown as WorldContext;
    const placement = new AnimatedBuildingPlacement(world, { researchlab4: RESEARCH_LAB_DEFINITIONS.researchlab4 }, () => true);
    const model = placement.spawnFromSave('researchlab4', { id: 'lab:resident', transform: { position: [3, 0, 4], rotationY: 0 },
      components: { building: { state: 'idle' } } });
    const meshes = () => { let count = 0; model.traverse(object => { if (object instanceof THREE.Mesh) count++; }); return count; };
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    await prefabDisplay(model)!.artLoaded();
    expect(meshes()).toBe(1);

    awake.set(false);
    await tick();
    expect(meshes()).toBe(0);
    // The anchor leaves the scene with its visual; identity stays on the instance.
    expect(model.parent).toBeNull();
    const instance = prefabInstance(model)!;
    expect(instance.entityId).toBe('lab:resident');
    const animation = instance.sprite;
    animation.start('proximity_loop');
    expect(animation.currentAnimation).toBe('proximity_loop');
    expect(reskinEntity(placement.reskinTargets[0])).toBe(true);
    const skinId = prefabInstance(model)!.sprite.skinId.peek();
    expect(meshes()).toBe(0);

    awake.set(true);
    await tick();
    expect(meshes()).toBe(1);
    expect(model.parent).toBe(world.scene);
    expect(prefabInstance(model)!.sprite).toBe(animation);
    expect(animation.currentAnimation).toBe('proximity_loop');
    expect(placement.exportRecords()[0].record).toMatchObject({ components: { building: { skinId } } });
    placement.dispose();
    expect(meshes()).toBe(0);
  });
});
