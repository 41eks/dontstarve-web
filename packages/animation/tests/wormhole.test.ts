import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { wormholePrefabs, WORMHOLE_ID, WORMHOLE_SKINS, WORMHOLE_ENTER_DISTANCE, WORMHOLE_EXIT_DISTANCE, WormholeInstance } from '../../prefab/src/wormhole';
import { PrefabEntityManager, type PrefabInstance, prefabInstance } from '../../prefab/src/prefabInstance';
import type { EntitySaveRecord } from '../../prefab/src/saveRecord';
import { loadSpriteSkinArchive } from '../src/animationAssets';
import { isMouseTarget } from '../../stategraphs/src/mouseTargets';
import { bindTestWorld, publishTestCamera } from './worldContentFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { reskinEntity, reskinTargetOf } from '../../prefab/src/reskin_tool';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { PlaySound } from '../../prefab/src/sound';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {}, isPlaying: () => true })) }));
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

function setup() {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler();
  // The wormhole's display turns itself to the world's camera rotation; playerprox follows its player positions.
  const content = bindTestWorld(scheduler);
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { scheduler });
  prefabs.register(wormholePrefabs({ scheduler, getWatchWorldContent: content.getWatchWorldContent }));
  const spawn = (position: THREE.Vector3, record?: EntitySaveRecord) => prefabs.spawnAs(WormholeInstance, WORMHOLE_ID, position, record);
  /** Player positions reach playerprox through its effect, which runs once the change settles. */
  const playerAt = async (x: number) => { content.playerpositions.set([new THREE.Vector3(x, 0, 0)]); await new Promise(resolve => setTimeout(resolve, 0)); };
  // Game time advances by whole frames, so a frame timeline lands on its frame without summing 1/30s.
  let frame = 0;
  const step = (frames: number, quaternion = new THREE.Quaternion()) => {
    for (let i = 0; i < frames; i++) { scheduler.advanceTo(++frame / 30); publishTestCamera(quaternion); displays.update(1 / 30); }
  };
  const dispose = () => { prefabs.dispose(); displays.dispose(); content.unbind(); scheduler.dispose(); };
  return { scene, content, displays, prefabs, spawn, playerAt, step, dispose };
}

it('opens and closes with source distance hysteresis and frame-specific layering, including interrupted transitions', async () => {
  await stubWormholeAssets();
  const s = setup();
  await s.playerAt(100);
  const wormhole = s.spawn(new THREE.Vector3()), model = wormhole.transform.model;
  await prefabDisplay(model)!.artLoaded();
  expect(isMouseTarget(model)).toBe(true);
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
  const clip = () => wormhole.sprite.currentAnimation;
  try {
    // playerprox's range test is strict: a player exactly at the near distance is not near.
    await s.playerAt(WORMHOLE_ENTER_DISTANCE);
    s.step(1, quaternion);
    expect(clip()).toBe('idle_loop');
    await s.playerAt(WORMHOLE_ENTER_DISTANCE - .01);
    expect(wormhole.sg.stateName).toBe('opening');
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/common/teleportworm/open', expect.anything());
    s.step(9, quaternion);
    expect(clip()).toBe('open_pre');
    expect(s.displays.renderEntities).toHaveLength(1);
    // FrameEvent(10, SetGroundLayering).
    s.step(1, quaternion);
    expect(s.displays.renderEntities).toHaveLength(0);
    // The display applies the declared layer in its effect, under the root it keeps around the drawn sprite.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(model.children[0].children[0].children[0].renderOrder).toBe(-0.5);
    s.step(60, quaternion);
    expect(clip()).toBe('open_loop');
    expect(wormhole.sg.stateName).toBe('open');
    s.content.camerarotation.set(quaternion);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(model.children[0].getWorldQuaternion(new THREE.Quaternion()).angleTo(quaternion)).toBeCloseTo(0);
    expect(model.rotation.y).toBe(0);
    await s.playerAt(WORMHOLE_EXIT_DISTANCE - .01);
    s.step(1, quaternion);
    expect(clip()).toBe('open_loop');
    await s.playerAt(WORMHOLE_EXIT_DISTANCE);
    s.step(3, quaternion);
    expect(clip()).toBe('open_pst');
    expect(s.displays.renderEntities).toHaveLength(0);
    // FrameEvent(4, SetBBLayering).
    s.step(1, quaternion);
    expect(s.displays.renderEntities).toHaveLength(1);
    s.step(60, quaternion);
    expect(clip()).toBe('idle_loop');
    await s.playerAt(0);
    s.step(3, quaternion);
    expect(clip()).toBe('open_pre');
    // opening is tagged open, so the far player closes it; closing is not, so the near one reopens it.
    await s.playerAt(100);
    s.step(1, quaternion);
    expect(clip()).toBe('open_pst');
    await s.playerAt(0);
    s.step(1, quaternion);
    expect(clip()).toBe('open_pre');
    s.step(60, quaternion);
    expect(clip()).toBe('open_loop');
  } finally { s.dispose(); }
  expect(isMouseTarget(model)).toBe(false);
});

it('reskins a live opening wormhole and restores its identity and skin', async () => {
  const fetchAsset = await stubWormholeAssets();
  const s = setup();
  await s.playerAt(100);
  const wormhole = s.spawn(new THREE.Vector3()), model = wormhole.transform.model;
  await prefabDisplay(model)!.artLoaded();
  const id = wormhole.entityId;
  const target = () => reskinTargetOf(prefabInstance(model))!;
  try {
    expect(wormhole.skinId).toBeUndefined();
    await s.playerAt(0);
    s.step(9);
    expect(reskinEntity(target())).toBe(true);
    expect(wormhole.sprite.currentAnimation).toBe('open_pre');
    expect(s.displays.renderEntities).toHaveLength(1);
    s.step(1);
    expect(s.displays.renderEntities).toHaveLength(0);
    s.step(60);
    expect(wormhole.sprite.currentAnimation).toBe('open_loop');

    const skinId = WORMHOLE_SKINS[0];
    expect(wormhole.entityId).toBe(id);
    expect(wormhole.skinId).toBe(skinId);
    expect(model.position.toArray()).toEqual([0, 0, 0]);
    await vi.waitFor(async () => {
      const skin = await loadSpriteSkinArchive(`dynamic/${skinId}.zip`, '/dst/data/anim');
      expect(skin.buildPackage.build.name).toBe(skinId);
      const mesh = model.children[0].children[0].children[0] as THREE.Mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      expect(materials.some((material) => ((material as THREE.MeshBasicMaterial).map as THREE.DataTexture | null)?.image.data
        === skin.buildPackage.atlases[0].pixels)).toBe(true);
    });
    const [{ record: saved }] = s.prefabs.exportRecords();
    expect(saved.components).toEqual({});
    expect(saved.skinname).toBe(skinId);
    expect(PREFAB_DEFINITIONS.wormholes.parseComponents(saved.components, 'wormhole', {} as never)).toEqual(saved.components);
    expect(() => PREFAB_DEFINITIONS.wormholes.parseComponents({ wormhole: { skinId: 'missing' } }, 'wormhole', {} as never)).toThrow();
    const restored = setup();
    try {
      const loaded = restored.spawn(new THREE.Vector3(...saved.transform.position), saved);
      expect(loaded.skinId).toBe(skinId);
      expect(loaded.entityId).toBe(id);
    } finally { restored.dispose(); }
    expect(fetchAsset.mock.calls.filter(([url]) => url.endsWith('.dyn'))).toHaveLength(1);
    const late = target();
    s.dispose();
    expect(reskinEntity(late)).toBe(false);
    expect(s.scene.children).toHaveLength(0);
  } finally { s.dispose(); }
});

it('ends open_pre on game time while its art never loads', async () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  vi.stubGlobal('window', new EventTarget());
  const s = setup();
  await s.playerAt(100);
  const wormhole = s.spawn(new THREE.Vector3());
  try {
    await s.playerAt(WORMHOLE_ENTER_DISTANCE - .01);
    expect(wormhole.sg.stateName).toBe('opening');
    // open_pre is 17 frames; its animover comes from the logical clip, not from a drawn sprite.
    s.step(16);
    expect(wormhole.sg.stateName).toBe('opening');
    s.step(2);
    expect(wormhole.sg.stateName).toBe('open');
    expect(wormhole.sprite.loaded).toBe(false);
  } finally { s.dispose(); }
});
