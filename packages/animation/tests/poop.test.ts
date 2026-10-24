import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { FliesController } from '../../prefab/src/flies';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import * as sound from '../../prefab/src/sound';
import { GroundItemManager } from '../../../src/groundItems';
import { createPickupInventory } from './pickupFixture';
import { setSpriteEntityRenderOrder } from '../src/renderOrder';

afterEach(() => { sound.DisposeSounds(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('uses source near/far hysteresis, cancels stale animation completion and releases each flies loop independently', () => {
  const handles: { stop: ReturnType<typeof vi.fn> }[] = [];
  vi.spyOn(sound, 'PlaySound').mockImplementation(() => {
    const handle = { stop: vi.fn(), isPlaying: () => true, setVolume: vi.fn() };
    handles.push(handle); return handle;
  });
  const scheduler = new GameTimeScheduler();
  const player = new THREE.Vector3(12, 0, 0);
  const sprite = () => ({ model: new THREE.Group(), currentAnimation: '', start: vi.fn(), playOnce: vi.fn(),
    setPaused: vi.fn(), setAnimation: vi.fn(), update: vi.fn(), dispose: vi.fn() });
  const a = sprite(), b = sprite();
  const first = new FliesController(a, new THREE.Vector3(), scheduler, () => [player]);
  const second = new FliesController(b, new THREE.Vector3(-20, 0, 0), scheduler, () => [player]);
  scheduler.advance(0);
  expect(handles).toHaveLength(2);
  const waiting = first.playerprox.timerState.peek();
  scheduler.advance(.2); first.update(.1);
  expect(first.playerprox.timerState.peek()).toBe(waiting);
  const stale = a.playOnce.mock.calls[0][1];
  player.x = 6; scheduler.advance(.2);
  expect(first.playerprox.IsPlayerClose()).toBe(false); // source near is strictly < 2 DST units
  player.x = 5.9; scheduler.advance(.34);
  expect(first.playerprox.IsPlayerClose()).toBe(true);
  expect(a.playOnce).toHaveBeenLastCalledWith('swarm_pst');
  expect(handles[0].stop).toHaveBeenCalledOnce();
  expect(handles[1].stop).not.toHaveBeenCalled();
  stale?.();
  expect(a.start).not.toHaveBeenCalled();
  player.x = 8.9; scheduler.advance(.34);
  expect(handles).toHaveLength(2);
  player.x = 9; scheduler.advance(.34);
  expect(first.playerprox.IsPlayerClose()).toBe(false);
  expect(handles).toHaveLength(3);
  expect(a.playOnce).toHaveBeenLastCalledWith('swarm_pre', expect.any(Function));
  first.OnEntitySleep();
  expect(handles[2].stop).toHaveBeenCalledOnce();
  expect(first.playerprox.timerState.peek()).toEqual({ status: 'stopped' });
  first.OnEntityWake();
  expect(handles).toHaveLength(4);
  first.dispose(); second.dispose();
  scheduler.advance(10);
  expect(handles).toHaveLength(4);
  expect(handles.every(handle => handle.stop.mock.calls.length === 1)).toBe(true);
  expect(first.initTimerState.peek()).toEqual({ status: 'stopped' });
});

it('renders real flies child art, preloads looping audio and preserves manure through pickup, drop and save restoration', async () => {
  const sources: { loop: boolean; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  const context = { state: 'running', destination: {}, resume: vi.fn(), close: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async () => ({ duration: .8 })),
    createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }),
    createBufferSource: () => {
      const source = { loop: false, buffer: null, onended: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      sources.push(source); return source;
    },
  };
  vi.stubGlobal('AudioContext', class { constructor() { return context; } });
  const fetch = vi.fn(async (url: string) => {
    const name = url.split('/').at(-1)!;
    return new Response(await readFile(new URL(`../../../public/dst/data/${name.endsWith('.wav') ? 'sound' : 'anim'}/${name}`, import.meta.url)));
  });
  vi.stubGlobal('fetch', fetch);
  const scene = new THREE.Scene(), player = new THREE.Group(); player.position.x = 12;
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
  const inventory = createPickupInventory();
  const manager = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
    { domElement: canvas } as unknown as THREE.WebGLRenderer, 'images.zip', inventory, '/anim', player, undefined,
    { isNight: () => false, getPlayerPositions: () => [player.position] });
  const item = { itemId: 'poop', count: 3, name: '便便', icon: 'poop.tex' };
  let restoredManager: GroundItemManager | undefined;
  try {
    expect(await manager.drop(item, new THREE.Vector3(), () => false)).toBe(false);
    manager.update(.1, new THREE.Quaternion());
    expect(sources).toHaveLength(0);
    const model = await manager.spawnFromSave('poop-identity', item, new THREE.Vector3());
    manager.update(.1, new THREE.Quaternion());
    expect(sources).toHaveLength(1);
    expect(sources[0].loop).toBe(true);
    for (let index = 75; index <= 81; index++) expect(fetch).toHaveBeenCalledWith(`/dst/data/sound/common.fsb-${index}.wav`);
    expect(context.decodeAudioData).toHaveBeenCalled();
    const flies = model.userData.flies as THREE.Group;
    expect(flies.parent).toBe(model);
    expect(flies.userData.tags).toEqual(['NOCLICK', 'DECOR']);
    for (let frame = 0; frame < 20; frame++) manager.update(.1, new THREE.Quaternion());
    const mesh = flies.children[0].children[0] as THREE.Mesh;
    expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
    const entries = manager.renderEntities;
    expect(entries).toHaveLength(2);
    setSpriteEntityRenderOrder(flies, 2);
    expect(flies.children[0].renderOrder).toBe(2);
    expect(entries.find(entry => entry.object === flies)!.footPosition.toArray()).toEqual([0, 0, 0]);
    const [saved] = JSON.parse(JSON.stringify(manager.exportRecords()));
    expect(saved).toMatchObject({ id: 'poop-identity', transform: { position: [0, 0, 0] }, components: { stack: { itemId: 'poop', count: 3 } } });
    const entity = model.userData.pickupTarget.entity;
    expect(inventory.GiveItem(entity)).toBe(true);
    expect(manager.exportRecords()).toEqual([]);
    expect(manager.renderEntities).toEqual([]);
    expect(sources[0].stop).toHaveBeenCalledOnce();
    expect(sources[0].disconnect).toHaveBeenCalledOnce();
    inventory.DropItem(entity, new THREE.Vector3(2, 0, 4));
    await vi.waitFor(() => expect(scene.children).toHaveLength(1));
    manager.update(.1, new THREE.Quaternion());
    expect(sources).toHaveLength(2);
    expect(scene.children[0].userData.flies).toBeDefined();
    const [dropped] = JSON.parse(JSON.stringify(manager.exportRecords()));
    expect(dropped).toMatchObject({ id: saved.id, transform: { position: [2, 0, 4] }, components: saved.components });
    manager.dispose();
    expect(sources[1].stop).toHaveBeenCalledOnce();
    restoredManager = new GroundItemManager(new THREE.Scene(), new THREE.PerspectiveCamera(),
      { domElement: canvas } as unknown as THREE.WebGLRenderer, 'images.zip', createPickupInventory(), '/anim', player, undefined,
      { isNight: () => false, getPlayerPositions: () => [player.position] });
    const restored = await restoredManager.spawnFromSave(dropped.id, item, new THREE.Vector3(...dropped.transform.position));
    restoredManager.update(.1, new THREE.Quaternion());
    expect(restoredManager.exportRecords()).toEqual([dropped]);
    expect(restored.userData.flies).toBeDefined();
    expect(sources).toHaveLength(3);
    const restoredEntity = restored.userData.pickupTarget.entity;
    restoredEntity.components.burnable.Ignite();
    expect(restored.userData.flies).toBeUndefined();
    expect(sources[2].stop).toHaveBeenCalledOnce();
    expect(sources[2].disconnect).toHaveBeenCalledOnce();
  } finally { manager.dispose(); restoredManager?.dispose(); }
});
