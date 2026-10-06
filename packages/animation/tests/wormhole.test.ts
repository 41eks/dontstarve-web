import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { executeDebugCommand } from '../../../src/debugCommands';
import type { InventoryStore } from '../../../src/inventory';
import { EntityRegistry } from '../../../src/entityRegistry';
import { WormholeManager, WORMHOLE_ID, WORMHOLE_SKINS,
  WORMHOLE_ENTER_DISTANCE, WORMHOLE_EXIT_DISTANCE } from '../../prefab/src/wormhole';
import { loadAnim, loadSpriteSkinArchive } from '../src/animationAssets';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function stubWormholeAssets() {
  const files = ['teleporter_worm.zip', 'teleporter_worm_build.zip',
    ...WORMHOLE_SKINS.flatMap((skin) => [`dynamic/${skin}.zip`, `dynamic/${skin}.dyn`])];
  const archives = new Map(await Promise.all(files.map(async (file) => [file,
    await readFile(new URL(`../../../public/dst/data/anim/${file}`, import.meta.url))] as const)));
  const fetchAsset = vi.fn(async (url: string) => {
    const file = url.replace('/dst/data/anim/', '');
    return new Response(archives.get(file)!, { status: archives.has(file) ? 200 : 404 });
  });
  vi.stubGlobal('fetch', fetchAsset);
  vi.stubGlobal('window', new EventTarget());
  return fetchAsset;
}

it('opens and closes with source distance hysteresis and frame-specific layering, including interrupted transitions', async () => {
  await stubWormholeAssets();
  const player = new THREE.Vector3(100, 50, 0);
  const manager = new WormholeManager(new THREE.Scene(), '/dst/data/anim', () => [player]);
  const model = await manager.spawn(new THREE.Vector3());
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
  const step = (frames: number) => { for (let i = 0; i < frames; i++) manager.update(1 / 30, quaternion); };
  const clip = () => model.userData.animationController.currentAnimation;
  try {
    player.x = WORMHOLE_ENTER_DISTANCE + 0.01;
    step(1);
    expect(clip()).toBe('idle_loop');
    player.x = WORMHOLE_ENTER_DISTANCE;
    step(9);
    expect(clip()).toBe('open_pre');
    expect(manager.renderEntities).toHaveLength(1);
    step(1);
    expect(manager.renderEntities).toHaveLength(0);
    expect(model.children[0].renderOrder).toBe(0);
    expect(model.children[0].children[0].renderOrder).toBe(-0.5);
    step(60);
    expect(clip()).toBe('open_loop');
    expect(model.quaternion.equals(quaternion)).toBe(true);
    player.x = WORMHOLE_EXIT_DISTANCE;
    step(1);
    expect(clip()).toBe('open_loop');
    player.x += 0.01;
    step(3);
    expect(clip()).toBe('open_pst');
    expect(manager.renderEntities).toHaveLength(0);
    step(1);
    expect(manager.renderEntities).toHaveLength(1);
    step(60);
    expect(clip()).toBe('idle_loop');
    player.x = 0;
    step(3);
    expect(clip()).toBe('open_pre');
    player.x = 100;
    step(1);
    expect(clip()).toBe('open_pst');
    player.x = 0;
    step(1);
    expect(clip()).toBe('open_pre');
    step(60);
    expect(clip()).toBe('open_loop');
  } finally { manager.dispose(); }
});

it('reskins a live opening wormhole and restores its identity and skin', async () => {
  const fetchAsset = await stubWormholeAssets();
  const scene = new THREE.Scene();
  const player = new THREE.Vector3(100, 0, 0);
  const manager = new WormholeManager(scene, '/dst/data/anim', () => [player]);
  const model = await manager.spawn(new THREE.Vector3(0, 0, 0));
  const id = model.userData.entityId;
  const step = (frames: number) => { for (let i = 0; i < frames; i++) manager.update(1 / 30, new THREE.Quaternion()); };
  try {
    const canceled = await manager.reskinTargets[0].prepareNextSkin();
    canceled.dispose();
    expect(canceled.apply()).toBe(false);
    expect(model.userData.skinId).toBeUndefined();
    const prepared = await manager.reskinTargets[0].prepareNextSkin();
    player.x = 0;
    step(9);
    expect(prepared.apply()).toBe(true);
    expect(model.userData.animationController.currentAnimation).toBe('open_pre');
    expect(manager.renderEntities).toHaveLength(1);
    step(1);
    expect(manager.renderEntities).toHaveLength(0);
    step(60);
    expect(model.userData.animationController.currentAnimation).toBe('open_loop');
    expect(prepared.apply()).toBe(false);
    prepared.dispose();

    const skinId = WORMHOLE_SKINS[0];
      expect(model.userData.entityId).toBe(id);
      expect(model.userData.skinId).toBe(skinId);
      expect(model.userData.animationController.currentAnimation).toBe('open_loop');
      expect(model.position.toArray()).toEqual([0, 0, 0]);
      const saved = manager.exportRecords()[0];
      expect(saved.components).toEqual(skinId ? { wormhole: { skinId } } : {});
      if (skinId) {
        const skin = await loadSpriteSkinArchive(`dynamic/${skinId}.zip`, '/dst/data/anim');
        expect(skin.buildPackage.build.name).toBe(skinId);
        const mesh = model.children[0].children[0] as THREE.Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        expect(materials.some((material) => (material as THREE.MeshBasicMaterial).map?.image.data
          === skin.buildPackage.atlases[0].pixels)).toBe(true);
        const restored = await manager.spawn(new THREE.Vector3(...saved.transform.position), saved);
        expect(restored.userData.skinId).toBe(skinId);
        expect(restored.userData.entityId).toBe(id);
      }
    expect(fetchAsset.mock.calls.filter(([url]) => url.endsWith('.dyn'))).toHaveLength(1);
    await expect(manager.spawn(new THREE.Vector3(), {
      id: 'bad_skin', transform: { position: [0, 0, 0], rotationY: 0 }, components: { wormhole: { skinId: 'missing' } },
    })).rejects.toThrow('Unsupported wormhole skin');
    const late = await manager.reskinTargets[0].prepareNextSkin();
    manager.dispose();
    expect(late.apply()).toBe(false);
    late.dispose();
    expect(scene.children).toHaveLength(0);
  } finally { manager.dispose(); }
});
