import { onSignalChange } from '../../signals/tests/signalChanges';
import { GameTimeScheduler } from '../../signals/src';
import { prefabDisplay } from '@dontstarve-web/display';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import { prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeDyn } from '../src/decodeDyn';
import { disposePlacingPlayers, placingPlayer } from './placingPlayer';
import { loadAnimationArchive, loadSpriteSkinArchive, smallHash } from '../src/animationAssets';
import { ArchiveSpriteAssets, createArchiveSprite, type ArchiveSprite } from '../src/archiveSprite';
import { setSpriteEntityRenderOrder } from '../src/renderOrder';
import definitions from '../../prefab/src/definitions.json' with { type: 'json' };
import type { BuildingDeclaration } from '../../prefab/src/building';
import { managedBuildings } from './managedBuildings';
import { createMemo, createSignal } from '../../signals/src';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import type { EntitySaveRecord } from '../../prefab/src/saveRecord';
import type { WorldContext } from '../../prefab/src/worldContext';
import { recipeSkins } from '../../ui/src/categories/generated';
import { reskinEntity, reskinTargetOf } from '../../prefab/src/reskin_tool';

const prefabIds = ['cookpot', 'researchlab2', 'researchlab4'] as const;
const buildingDefinitions: Record<(typeof prefabIds)[number], BuildingDeclaration> = {
  cookpot: definitions.animatedBuildings.cookpot,
  researchlab2: definitions.animatedBuildings.researchlab2,
  researchlab4: definitions.animatedBuildings.researchlab4,
};

/** The research labs as the application wires them: PlaceableBuildingPlacement over the shared PrefabEntityManager. */
function labWorld(extra: Partial<Record<keyof WorldContext, unknown>> = {}) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', {
    createElement: () => ({ setAttribute: vi.fn(), style: {} }),
    body: { appendChild: vi.fn() },
  });
  const world = {
    scene: new THREE.Scene(),
    player: new THREE.Object3D(),
    ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(),
    renderer: { domElement: new EventTarget() },
    ...extra,
  } as unknown as WorldContext;
  return { world, buildings: managedBuildings(world) };
}
const reskinTarget = (model: THREE.Object3D) => reskinTargetOf(prefabInstance(model))!;
// One plain build; the tests below exercise symbol-only and layered skins.
const cases = [{ prefabId: 'cookpot', skinId: 'cookpot_candy', archive: 'dynamic/cookpot_candy.zip' }] as const;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const relative = url.slice(url.indexOf('/dst/data/') + '/dst/data/'.length);
      try {
        const bytes = await readFile(new URL(`../../../public/dst/data/${relative}`, import.meta.url));
        return new Response(bytes);
      } catch {
        return new Response(null, { status: 404 });
      }
    }),
  );
});

afterEach(() => {
  disposePlacingPlayers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The buildings' SetBank names, as their buildingPrefab declares them. */
const BANKS: Readonly<Record<(typeof prefabIds)[number], string>> = {
  cookpot: 'cook_pot',
  researchlab2: 'researchlab2',
  researchlab4: 'researchlab4',
};

/**
 * A building's shared archive sprite, dressed with a skin as its display resolves the entity's skin: the skin build,
 * the symbols it replaces or keeps, and its animation banks drawn over the clip's frame.
 */
async function buildingSprite(
  prefabId: (typeof prefabIds)[number],
  skinId?: string,
  { scale, banks }: { scale?: number; banks?: readonly string[] } = {},
) {
  const declaration = buildingDefinitions[prefabId];
  const assets = new ArchiveSpriteAssets('sprite', '/dst/data/anim');
  const definition = {
    animationArchive: declaration.archive,
    buildArchives: [declaration.buildArchive ?? declaration.archive],
    bank: BANKS[prefabId],
    animation: declaration.idleAnimation ?? 'idle',
    loop: true,
  };
  const sprite = await createArchiveSprite(assets, definition, scale === undefined ? {} : { scale });
  if (skinId !== undefined) {
    const archive = declaration.skinArchives![skinId],
      skinBanks = banks ?? declaration.skinAnimationBanks?.[skinId] ?? [];
    const [build, animations] = await Promise.all([
      assets.loadBuild(archive),
      skinBanks.length ? assets.loadAnimation(archive) : undefined,
    ]);
    sprite.setSkin({
      ...build,
      animations,
      symbols: declaration.skinSymbols && new Set(declaration.skinSymbols.map(smallHash)),
      baseSymbols: new Set(declaration.baseSymbols?.map(smallHash)),
      animationBanks: new Set(skinBanks.map(smallHash)),
    });
  }
  return Object.assign(sprite, {
    release: () => {
      sprite.dispose();
      assets.dispose();
    },
  }) as ArchiveSprite & { release(): void };
}

function meshOf(model: THREE.Group) {
  const meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>[] = [];
  model.traverse(object => {
    if (object instanceof THREE.Mesh) {
      meshes.push(object as (typeof meshes)[number]);
    }
  });
  expect(meshes).toHaveLength(1);
  return meshes[0];
}

describe('DST building skins', () => {
  it('covers crafting skin metadata for plain, symbol-only and layered buildings', () => {
    for (const prefabId of prefabIds) {
      expect(Object.keys(definitions.animatedBuildings[prefabId].skinArchives).sort()).toEqual(
        recipeSkins[prefabId].map(({ id }) => id).sort(),
      );
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

  it.each(cases)(
    '$skinId loads, animates, and stays one render-order entity',
    async ({ prefabId, skinId, archive }) => {
      const sprite = await buildingSprite(prefabId, skinId),
        model = sprite.model;
      const mesh = meshOf(model);
      expect(mesh.visible).toBe(true);
      expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
      expect(mesh.material.some(material => ((material.map?.image as { width?: number })?.width ?? 0) > 0)).toBe(true);
      expect(fetch).toHaveBeenCalledWith(`/dst/data/anim/${archive}`);
      expect(fetch).toHaveBeenCalledWith(`/dst/data/anim/${archive.replace(/\.zip$/, '.dyn')}`);
      setSpriteEntityRenderOrder(model, 7);
      expect(mesh.parent!.renderOrder).toBe(7);
      const animation = sprite;
      const complete = vi.fn(() => animation.start(buildingDefinitions[prefabId].idleAnimation ?? 'idle'));
      animation.playOnce('place', complete);
      for (let frame = 0; frame < 100; frame++) {
        animation.update(0.1);
      }
      expect(complete).toHaveBeenCalledTimes(1);
      if (prefabId.startsWith('researchlab')) {
        animation.start('proximity_loop');
        for (let frame = 0; frame < 70; frame++) {
          animation.update(1 / 30);
        }
      }
      expect(meshOf(model)).toBe(mesh);
      expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
      expect(Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      sprite.release();
    },
  );

  it('draws only the researchlab4 hat from its skin build and swaps it on reskin', async () => {
    const { buildings } = labWorld();
    try {
      const model = buildings.spawnFromSave('researchlab4', {
        id: 'lab:hat',
        transform: { position: [3, 0, 4], rotationY: 0 },
        skinname: 'researchlab4_chef',
        components: { building: {} },
      }) as THREE.Group;
      const lab = prefabInstance(model)!,
        sprite = lab.sprite;
      // researchlab4_init_fn: OverrideItemSkinSymbol("machine_hat", build_name, "machine_hat", GUID, "researchlab4"), no SetSkin,
      // declared as the skin's only symbol like moondial's basin.
      const declared = sprite.sprite.peek().appearance.get('skin');
      expect(declared?.kind === 'skin' && declared.skin.symbols).toEqual(['machine_hat']);
      expect(lab.skinId).toBe('researchlab4_chef');
      await prefabDisplay(model)!.artLoaded();
      const base = await buildingSprite('researchlab4', undefined, { scale: 0.02 });
      const mesh = meshOf(model),
        baseMesh = meshOf(base.model),
        baseCount = baseMesh.geometry.drawRange.count;
      // Only the hat changes: the machine keeps every part of the base build.
      expect(mesh.geometry.drawRange.count).toBe(baseMesh.geometry.drawRange.count);
      expect(Array.from(mesh.geometry.getAttribute('position').array)).not.toEqual(
        Array.from(baseMesh.geometry.getAttribute('position').array),
      );
      base.release();

      // Reskinning swaps the hat's build: researchlab4_clear_fn, then the next skin's init_fn.
      expect(reskinEntity(reskinTarget(model))).toBe(true);
      expect(lab.skinId).not.toBe('researchlab4_chef');
      await prefabDisplay(model)!.artLoaded();
      expect(meshOf(model).geometry.drawRange.count).toBe(baseCount);
    } finally {
      buildings.dispose();
    }
  });

  it('uses the merchant animation bank and merges the pod FX bank into its main mesh', async () => {
    const merchant = await loadSpriteSkinArchive('dynamic/researchlab4_merchant.zip', '/dst/data/anim');
    const original = await loadAnimationArchive('researchlab4.zip', '/dst/data/anim');
    expect(merchant.animations!.animations[0].bankHash).toBe(smallHash('researchlab4'));
    expect(merchant.animations!.animations[0].bankHash).toBe(original.animations.animations[0].bankHash);
    const withFx = await buildingSprite('researchlab2', 'researchlab2_pod');
    const withoutFx = await buildingSprite('researchlab2', 'researchlab2_pod', { banks: [] });
    for (const sprite of [withFx, withoutFx]) {
      sprite.start('proximity_loop');
    }
    let hasFx = false;
    for (let frame = 0; frame < 60; frame++) {
      for (const sprite of [withFx, withoutFx]) {
        sprite.update(1 / 30);
      }
      hasFx ||= meshOf(withFx.model).geometry.drawRange.count > meshOf(withoutFx.model).geometry.drawRange.count;
    }
    expect(hasFx).toBe(true);
    withFx.release();
    withoutFx.release();
  });

  it.each(['cookpot'] as const)(
    '%s keeps its selected skin through preview, placement, and restoration',
    async prefabId => {
      vi.stubGlobal('window', new EventTarget());
      vi.stubGlobal('document', {
        createElement: () => ({ setAttribute: vi.fn(), style: {} }),
        body: { appendChild: vi.fn() },
      });
      const canvas = new EventTarget();
      const world = {
        scene: new THREE.Scene(),
        player: new THREE.Object3D(),
        ground: new THREE.Group(),
        camera: new THREE.PerspectiveCamera(),
        renderer: { domElement: canvas },
        scheduler: new GameTimeScheduler(),
      } as unknown as WorldContext;
      const skinId = recipeSkins[prefabId][0].id;
      const consume = vi.fn(() => true);
      const placement = managedBuildings(world, { consume });
      const player = placingPlayer(world, placement.placement, placement.spawnBuilding);
      vi.spyOn(PointerRaycaster.prototype, 'trackPointer').mockImplementation(() => {});
      vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(new THREE.Vector3(3, 0, 4));
      vi.spyOn(PointerRaycaster.prototype, 'isOverGround', 'get').mockReturnValue(true);
      player.pay(prefabId, skinId);
      await placement.begin(prefabId, skinId);
      const records = () => placement.exportRecords().filter(({ prefabId: id }) => id === prefabId);
      expect(records()).toHaveLength(0);
      expect(lookupPrefabInstance(world.scene.children[0])?.skinId).toBe(skinId);
      player.click();
      player.place();
      expect(consume).toHaveBeenCalledWith(prefabId, skinId);
      for (let frame = 0; frame < 100; frame++) {
        placement.update(0.1);
      }
      const record = records()[0].record;
      expect(record.components.building).toEqual({});
      expect(record.skinname).toBe(skinId);
      expect(record.transform.position).toEqual([3, 0, 4]);
      const restored = await placement.spawnFromSave(prefabId, record as EntitySaveRecord);
      expect(lookupPrefabInstance(restored)?.skinId).toBe(skinId);
      expect(records()[1].record).toEqual(record);
      await expect(placement.spawn(prefabId, 'missing_skin')).rejects.toThrow('Unsupported');
      placement.dispose();
    },
  );

  it('commits skins through the json without replacing the sprite and rejects a removed target', async () => {
    const { buildings } = labWorld();
    const model = buildings.spawnFromSave('researchlab4', {
      id: 'lab:signal',
      transform: { position: [3, 0, 4], rotationY: 0 },
      components: { building: {} },
    }) as THREE.Group;
    await prefabDisplay(model)!.artLoaded();
    const signal = prefabInstance<PrefabInstance>(model)!.sprite.skinId;
    const changes: unknown[] = [];
    const stop = onSignalChange(signal, (skinId: unknown) => changes.push(skinId));
    const originalMesh = meshOf(model);
    const disposeOldGeometry = vi.spyOn(originalMesh.geometry, 'dispose');
    expect(signal.peek()).toBeUndefined();
    expect(meshOf(model)).toBe(originalMesh);
    expect(changes).toEqual([]);

    expect(reskinEntity(reskinTarget(model))).toBe(true);
    expect(changes).toEqual([signal.peek()]);
    expect(signal.peek()).toBeDefined();
    await prefabDisplay(model)!.artLoaded();
    expect(meshOf(model)).toBe(originalMesh);
    expect(disposeOldGeometry).not.toHaveBeenCalled();
    expect(buildings.exportRecords()[0].record).toMatchObject({
      id: 'lab:signal',
      transform: { position: [3, 0, 4], rotationY: 0 },
      skinname: signal.peek(),
    });
    const removed = reskinTarget(model);
    const disposeCurrent = vi.spyOn(meshOf(model).geometry, 'dispose');
    buildings.dispose();
    expect(reskinEntity(removed)).toBe(false);
    expect(disposeCurrent).toHaveBeenCalledOnce();
    expect(changes).toHaveLength(1);
    stop();
  });

  it('releases a building sprite outside the tickingarea and reloads its logical animation and skin', async () => {
    const awake = createSignal(true);
    const { world, buildings } = labWorld({ tickingarea: () => createMemo(() => awake.get()) });
    const model = buildings.spawnFromSave('researchlab4', {
      id: 'lab:resident',
      transform: { position: [3, 0, 4], rotationY: 0 },
      components: { building: {} },
    }) as THREE.Group;
    const meshes = () => {
      let count = 0;
      model.traverse(object => {
        if (object instanceof THREE.Mesh) {
          count++;
        }
      });
      return count;
    };
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
    expect(reskinEntity(reskinTarget(model))).toBe(true);
    const skinId = prefabInstance<PrefabInstance>(model)!.sprite.skinId.peek();
    expect(meshes()).toBe(0);

    awake.set(true);
    await tick();
    expect(meshes()).toBe(1);
    expect(model.parent).toBe(world.scene);
    expect(prefabInstance(model)!.sprite).toBe(animation);
    expect(animation.currentAnimation).toBe('proximity_loop');
    expect(buildings.exportRecords()[0].record.skinname).toBe(skinId);
    buildings.dispose();
    expect(meshes()).toBe(0);
  });
});
