import { useTestTileMap } from './tileMapFixture';
import { createPickupInventory } from './pickupFixture';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { ItemEntity } from '../../inventory/src';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirefliesController, FIREFLIES_LIGHT, configureFirefliesEntity } from '../../prefab/src/fireflies';
import { GroundItemManager } from '../../../src/groundItems';

import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { createMemo, createSignal, type HandEquipment, type ReadonlySignal } from '../../signals/src';
import { DisposeTileStates, GetTileKeyAtPoint, GetTileStateAtPoint } from '../../componets/src/tileManager';
import { bindTestWorld } from './worldContentFixture';
import { configureBugNetEntity } from '../../prefab/src/bugnet';
import { actionEntity, activePrefabs, disposeActionEntity } from '../../prefab/src/actionEntity';
import { mouseTargets } from '../../prefab/src/mouseTargets';
import { bindInstance, PrefabInstance, prefabInstance } from '../../prefab/src/prefabInstance';
import type { ArchiveSpriteCommands } from '@dontstarve-web/display';
import { displayLights } from '../../display/src/displaySprites';

/** The inst.Light an entity's model declares. */
const declaredLight = (model: THREE.Object3D) => prefabInstance(model)?.light.peek();
/** Whether the renderer reads a light at `model`. */
const listed = (model: THREE.Object3D) => [...displayLights()].some(entry => entry.model === model);
/** A swarm entity drawing through a mocked sprite. */
const swarmInstance = (animation: object) => new PrefabInstance('fireflies', animation as unknown as ArchiveSpriteCommands);

useTestTileMap();

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(stop => stop()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function netEquipment(itemId = 'bugnet'): HandEquipment {
  const entity = new ItemEntity({ itemId, count: 1 });
  configureBugNetEntity(entity);
  cleanups.push(() => entity.destroy());
  return { itemId, EQUIPSLOTS: 'HANDS', entity };
}

function setup(night = true, position = new THREE.Vector3(10, 0, 0), random = () => 0) {
  const scheduler = new GameTimeScheduler();
  const { cycle, playerpositions, getWatchWorldContent, unbind } = bindTestWorld(scheduler);
  cycle.set(night ? 'night' : 'day');
  playerpositions.set([position.clone()]);
  const model = new THREE.Group();
  const animation = { start: vi.fn(), playOnce: vi.fn(), update: vi.fn(), clearAnimation: vi.fn(), setLightOverride: vi.fn() };
  const entity = new ItemEntity({ itemId: 'fireflies', count: 1 });
  const handEquipment = createSignal<HandEquipment | null>(netEquipment());
  const instance = swarmInstance(animation);
  // As the swarm's display does: its model carries the swarm entity.
  bindInstance(model, instance);
  const controller = new FirefliesController(instance, model,
    { getWatchWorldContent, handEquipment }, entity.transform, random);
  cleanups.push(() => { controller.dispose(); unbind(); scheduler.dispose(); });
  return { model, instance, entity, animation, controller, cycle, playerpositions, handEquipment, setNight: (value: boolean) => { cycle.set(value ? 'night' : 'day'); },
    setPlayers: (value: THREE.Vector3[]) => { playerpositions.set(value.map(player => player.clone())); },
    tick: (seconds: number) => { for (let i = 0; i < Math.round(seconds * 100); i++) { scheduler.advance(.01); controller.update(.01); } } };
}

describe('source fireflies light and proximity', () => {
  it('requires an equipped NET-capable entity for mouse targeting without changing the swarm light or NET work state', async () => {
    const s = setup();
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    configureFirefliesEntity(s.entity); s.controller.bindEntity(s.entity);
    new THREE.Scene().add(s.model);
    const projected = actionEntity(s.model, 'fireflies', s.entity);
    cleanups.push(() => { disposeActionEntity(s.model); s.entity.destroy(); });
    expect(mouseTargets.has(projected)).toBe(false);
    s.controller.place(false); await settle(); s.tick(3.1);
    expect(s.controller.clickable).toBe(true);
    expect(mouseTargets.has(projected)).toBe(true);
    expect(s.entity.hasTag('NOCLICK')).toBe(false);
    expect(s.entity.hasTag('NOBLOCK')).toBe(true);
    const light = s.instance.light.peek(), clips = s.animation.playOnce.mock.calls.length;
    for (const hand of [{ itemId: 'axe', EQUIPSLOTS: 'HANDS' } as const, { itemId: 'bugnet', EQUIPSLOTS: 'HANDS' } as const, null]) {
      s.handEquipment.set(hand); await settle();
      expect(s.controller.clickable).toBe(false);
      expect(mouseTargets.has(projected)).toBe(false);
      expect(activePrefabs).toContain(projected);
      // The held-net gate only drops the mouse candidate; NOCLICK still follows the source fade.
      expect(s.entity.hasTag('NOCLICK')).toBe(false);
      expect(s.instance.hasTag('NOCLICK')).toBe(false);
      expect(s.controller.workable).toBe(true);
      expect(s.instance.light.peek()).toBe(light);
    }
    s.handEquipment.set(netEquipment('test_net')); await settle();
    expect(s.controller.clickable).toBe(true);
    expect(mouseTargets.has(projected)).toBe(true);
    expect(s.entity.hasTag('NOCLICK')).toBe(false);
    expect(s.animation.playOnce).toHaveBeenCalledTimes(clips);
    s.setNight(false); await settle(); s.tick(2.1); await settle(); s.tick(.8);
    expect(s.entity.hasTag('NOCLICK')).toBe(true);
    expect(mouseTargets.has(projected)).toBe(false);
    s.controller.dispose();
    const reads = vi.spyOn(s.handEquipment, 'get');
    s.handEquipment.set(null); await settle();
    expect(reads).not.toHaveBeenCalled();
  });

  it('skips hidden daytime animation and keeps settled light data unchanged between transitions', async () => {
    const s = setup(false);
    s.controller.place(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    s.tick(1);
    // Hidden by day: the manager does not visit the swarm, so its display advances no frames.
    expect(s.controller.updating.peek()).toBe(false);
    s.setNight(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    s.tick(2.1);
    await new Promise(resolve => setTimeout(resolve, 0));
    s.tick(3.1);
    expect(s.controller.updating.peek()).toBe(true);
    const light = s.instance.light.peek();
    expect(light?.intensity).toBe(.5);
    s.tick(1);
    expect(s.instance.light.peek()).toBe(light);
  });

  it('uses private world cycle changes for the delayed night check and releases world inputs on disposal', async () => {
    const s = setup(false);
    s.controller.place(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    s.setPlayers([new THREE.Vector3(10, 0, 0)]);
    const distance = vi.spyOn(s.playerpositions.peek()[0], 'distanceToSquared');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(distance).not.toHaveBeenCalled();
    s.cycle.set('dusk');
    await new Promise(resolve => setTimeout(resolve, 0));
    s.tick(3);
    expect(s.controller.clickable).toBe(false);
    s.setNight(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(distance).toHaveBeenCalled();
    s.tick(1.9);
    expect(s.controller.clickable).toBe(false);
    s.tick(.2);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.controller.clickable).toBe(true);
    s.tick(3);
    s.setNight(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.controller.intensity).toBe(0);
    expect(s.controller.workable).toBe(false);
    expect(s.controller.visible).toBe(false);
    expect(s.instance.light.peek()).toBeUndefined();
    s.controller.dispose();
    const readCycle = vi.spyOn(s.cycle, 'get');
    const readPositions = vi.spyOn(s.playerpositions, 'get');
    s.setNight(true);
    s.setPlayers([new THREE.Vector3()]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(readCycle).not.toHaveBeenCalled();
    expect(readPositions).not.toHaveBeenCalled();
  });

  it('fades in at night and uses the source radius, intensity, colour and falloff', async () => {
    const s = setup();
    s.controller.place(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('swarm_pre', expect.any(Function));
    expect(s.controller.clickable).toBe(true);
    expect(s.controller.workable).toBe(true);
    s.tick(1.5);
    expect(s.controller.intensity).toBeCloseTo(0.25);
    s.tick(1.6);
    expect(s.instance.light.peek()).toEqual(FIREFLIES_LIGHT);
    expect(s.animation.setLightOverride).toHaveBeenLastCalledWith(1);
    const complete = s.animation.playOnce.mock.calls[0][1] as () => void;
    complete();
    expect(s.animation.start).toHaveBeenLastCalledWith('swarm_loop');
  });

  it('uses published player snapshots and scaled near/far boundaries, retaining NET briefly during fade-out', async () => {
    const player = new THREE.Vector3(10, 0, 0);
    const s = setup(true, player);
    s.controller.place(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    s.tick(3.1);
    player.set(0, 0, 0);
    s.tick(1);
    expect(s.controller.intensity).toBe(0.5); // Moving the live player does not mutate the world snapshot.
    s.setPlayers([new THREE.Vector3(9, 0, 0)]);
    await new Promise(resolve => setTimeout(resolve, 0));
    s.tick(.1);
    expect(s.controller.intensity).toBe(.5); // Source near boundary is strictly < 3 * TILE_SIZE / 4.
    s.setPlayers([new THREE.Vector3(30, 0, 0), new THREE.Vector3(8.99, 0, 0)]);
    await new Promise(resolve => setTimeout(resolve, 0));
    s.tick(0.4);
    expect(s.animation.playOnce).toHaveBeenLastCalledWith('swarm_pst', expect.any(Function));
    expect(s.controller.intensity).toBeLessThan(0.5);
    s.tick(0.4);
    expect(s.controller.clickable).toBe(false);
    expect(s.instance.hasTag('NOCLICK')).toBe(true);
    expect(s.controller.workable).toBe(true);
    expect(s.instance.light.peek()).toBeUndefined();
    s.tick(1.6);
    expect(s.controller.workable).toBe(false);
    s.setPlayers([new THREE.Vector3(14.99, 0, 0)]);
    await new Promise(resolve => setTimeout(resolve, 0));
    s.tick(1);
    expect(s.controller.intensity).toBe(0);
    s.setPlayers([new THREE.Vector3(15, 0, 0)]);
    await new Promise(resolve => setTimeout(resolve, 0));
    s.tick(0.1);
    expect(s.controller.intensity).toBeGreaterThan(0);
    expect(s.controller.workable).toBe(true);
  });

  it('reverses a fade without restarting the light at zero and removes light on disposal', async () => {
    const s = setup();
    s.controller.place(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    s.tick(3.1);
    s.setPlayers([new THREE.Vector3()]);
    await new Promise(resolve => setTimeout(resolve, 0));
    s.tick(0.3);
    const value = s.controller.intensity;
    s.setPlayers([]);
    await new Promise(resolve => setTimeout(resolve, 0));
    s.tick(0.1);
    expect(s.controller.intensity).toBeGreaterThan(value);
    const stale = s.animation.playOnce.mock.calls[1][1] as () => void;
    stale();
    expect(s.controller.visible).toBe(true);
    s.controller.dispose();
    s.tick(5);
    expect(s.instance.light.peek()).toBeUndefined();
    expect(s.controller.workable).toBe(false);
  });
});

describe('fireflies tickingarea gate', () => {
  it('keeps world inputs asleep and checks daylight on wake before retaining any old light or fade', async () => {
    const scheduler = new GameTimeScheduler();
    const awake = createSignal(true), queried: ReadonlySignal<number>[] = [];
    const area = createMemo(() => awake.get());
    const { cycle, playerpositions, getWatchWorldContent, unbind } = bindTestWorld(scheduler, tile => { queried.push(tile); return area; });
    cycle.set('day'); playerpositions.set([new THREE.Vector3(1, 0, 0)]);
    const model = new THREE.Group();
    const entity = new ItemEntity({ itemId: 'fireflies', count: 1 });
    const animation = { start: vi.fn(), playOnce: vi.fn(), update: vi.fn(), clearAnimation: vi.fn(), setLightOverride: vi.fn() };
    const instance = swarmInstance(animation);
    const controller = new FirefliesController(instance, model, { getWatchWorldContent,
      handEquipment: createSignal<HandEquipment | null>(netEquipment()) }, entity.transform, () => 0);
    cleanups.push(() => { controller.dispose(); unbind(); scheduler.dispose(); });
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const tick = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 100); i++) { scheduler.advance(.01); controller.update(.01); } };
    // Both watched inputs share one private tile key, updated on ground placement.
    expect(queried).toHaveLength(2); expect(queried[1]).toBe(queried[0]);
    entity.transform.position.set(4, 0, 6);
    controller.place(false); await settle();
    expect(queried[0].peek()).toBe(GetTileKeyAtPoint(new THREE.Vector3(4, 0, 6)));
    expect(controller.clickable).toBe(false);

    awake.set(false);
    cycle.set('night'); playerpositions.set([new THREE.Vector3(40, 0, 6)]);
    await settle(); tick(5);
    expect(controller.clickable).toBe(false); // Sleeping swarms cannot see night or the new player snapshot.
    expect(controller.visible).toBe(false); // OnEntitySleep: no fadein while the tile sleeps

    awake.set(true); await settle(); tick(3.1); await settle();
    expect(controller.visible).toBe(true);
    expect(controller.updating.peek()).toBe(true);
    expect(controller.clickable).toBe(true); // wake resyncs cycle and positions and runs the usual night check

    const stale = animation.playOnce.mock.calls.at(-1)![1] as () => void;
    awake.set(false); await settle();
    const sleepingIntensity = controller.intensity;
    cycle.set('day'); playerpositions.set([new THREE.Vector3(50, 0, 6)]); await settle();
    expect(controller.intensity).toBe(sleepingIntensity); // World inputs stay gated during sleep.
    const daytimePlayerDistance = vi.spyOn(playerpositions.peek()[0], 'distanceToSquared');
    awake.set(true); await settle(); // The wake effect extinguishes it without any animation frame update.
    expect(controller.intensity).toBe(0);
    expect(controller.workable).toBe(false);
    expect(controller.updating.peek()).toBe(false);
    expect(controller.visible).toBe(false);
    expect(instance.hasTag('NOCLICK')).toBe(true);
    expect(instance.light.peek()).toBeUndefined();
    expect(daytimePlayerDistance).not.toHaveBeenCalled();
    stale();
    expect(animation.start).not.toHaveBeenCalled();

    controller.place(true); await settle(); // Daytime drops cannot start another fade or delayed flash.
    tick(10); await settle();
    expect(controller.visible).toBe(false);
    expect(controller.intensity).toBe(0);
    expect(controller.clickable).toBe(false);
    expect(controller.workable).toBe(false);
    expect(instance.light.peek()).toBeUndefined();

    cycle.set('night'); await settle(); tick(2.1); await settle(); tick(3.1);
    expect(controller.visible).toBe(true);
    expect(controller.intensity).toBe(.5);
    expect(controller.clickable).toBe(true);
  });
});

describe('real fireflies archive and ground transfers', () => {
  function assets() {
    vi.stubGlobal('fetch', async () => new Response(await readFile(
      new URL('../../../public/dst/data/anim/fireflies.zip', import.meta.url))));
  }

  it('orients active billboards from the world camera rotation signal only when it changes', async () => {
    assets();
    const scheduler = new GameTimeScheduler();
    const { camerarotation, getWatchWorldContent, unbind } = bindTestWorld(scheduler);
    const scene = new THREE.Scene(), inventory = createPickupInventory();
    const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
    const manager = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
      { domElement: canvas } as unknown as THREE.WebGLRenderer, 'images.zip', inventory, '/anim', new THREE.Group(), undefined,
      { getWatchWorldContent }, undefined, undefined, scheduler, undefined, undefined, undefined, getWatchWorldContent);
    cleanups.push(() => { manager.dispose(); inventory.dispose(); unbind(); scheduler.dispose(); });
    const definition = { itemId: 'fireflies', count: 1, name: '萤火虫', icon: 'fireflies.tex' };
    const first = await manager.spawnFromSave('fireflies:a', definition, new THREE.Vector3());
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3);
    camerarotation.set(turned);
    await settle();
    expect(first.quaternion.equals(turned)).toBe(true);
    // The per-frame argument no longer drives orientation once the world publishes the rotation.
    manager.update(.1, new THREE.Quaternion());
    expect(first.quaternion.equals(turned)).toBe(true);
    // Items created after the turn start from the current rotation.
    const later = await manager.spawnFromSave('fireflies:b', definition, new THREE.Vector3(1, 0, 0));
    await settle();
    expect(later.quaternion.equals(turned)).toBe(true);
  });

  it('visits a swarm in the frame loop only while it fades or shows its animation', async () => {
    assets();
    const scheduler = new GameTimeScheduler();
    const { cycle, playerpositions, getWatchWorldContent, unbind } = bindTestWorld(scheduler);
    cycle.set('day'); playerpositions.set([new THREE.Vector3(100, 0, 0)]);
    const scene = new THREE.Scene(), inventory = createPickupInventory();
    const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
    const manager = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
      { domElement: canvas } as unknown as THREE.WebGLRenderer, 'images.zip', inventory, '/anim', new THREE.Group(), undefined,
      { getWatchWorldContent }, undefined, undefined, scheduler, undefined, undefined, undefined, getWatchWorldContent);
    cleanups.push(() => { manager.dispose(); inventory.dispose(); unbind(); scheduler.dispose(); });
    const model = await manager.spawnFromSave('fireflies:idle',
      { itemId: 'fireflies', count: 1, name: '萤火虫', icon: 'fireflies.tex' }, new THREE.Vector3());
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    await settle();
    const update = vi.spyOn(FirefliesController.prototype, 'update');
    for (let i = 0; i < 5; i++) { scheduler.advance(.1); manager.update(.1, new THREE.Quaternion()); }
    expect(update).not.toHaveBeenCalled();
    cycle.set('night');
    await settle();
    for (let i = 0; i < 40; i++) { scheduler.advance(.1); manager.update(.1, new THREE.Quaternion()); await settle(); }
    expect(update).toHaveBeenCalled();
    expect(declaredLight(model)?.intensity).toBeGreaterThan(0);
  });

  it('keeps resources only in active tiles, disposes departing geometry and restores the same logical entities on return', async () => {
    assets();
    const scheduler = new GameTimeScheduler();
    const position = createSignal<THREE.Vector3 | undefined>(new THREE.Vector3());
    const { cycle, playerpositions, getWatchWorldContent, unbind } = bindTestWorld(scheduler, GetTileStateAtPoint(position));
    cycle.set('night'); playerpositions.set([new THREE.Vector3()]);
    const scene = new THREE.Scene(), inventory = createPickupInventory();
    const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
    const manager = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
      { domElement: canvas } as unknown as THREE.WebGLRenderer, 'images.zip', inventory, '/anim', new THREE.Group(), undefined,
      { getWatchWorldContent });
    cleanups.push(() => { manager.dispose(); inventory.dispose(); unbind(); DisposeTileStates(position); scheduler.dispose(); });
    const definition = { itemId: 'fireflies', count: 1, name: '萤火虫', icon: 'fireflies.tex' };
    const near = await manager.spawnFromSave('fireflies:near', definition, new THREE.Vector3(30, 0, 0));
    const far = await manager.spawnFromSave('fireflies:far', definition, new THREE.Vector3(300, 0, 0));
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    await settle();
    const geometry = (model: THREE.Object3D) => {
      let result: THREE.BufferGeometry | undefined;
      model.traverse(object => { if (object instanceof THREE.Mesh) result = object.geometry; });
      return result;
    };
    // Source frame buffers belong to ArchiveSpriteAssets; a departing swarm drops its visual and instance.
    // The near swarm fades in on load, and its sprite is built when swarm_pre starts.
    await vi.waitFor(() => expect(geometry(near)).toBeDefined());
    expect(geometry(far)).toBeUndefined();
    expect(far.parent).toBeNull();
    expect(manager.renderEntities.map(entry => entry.object)).toEqual([near]);
    const records = manager.exportRecords();
    const nearEntity = manager.entities.get('fireflies:near');
    for (let i = 0; i < 51; i++) { scheduler.advance(.1); manager.update(.1, new THREE.Quaternion()); }
    expect(declaredLight(near)?.intensity).toBe(.5);
    await settle();
    expect(listed(near)).toBe(true);
    const target = manager.netCaptureTargets[0];
    const nearUpdate = vi.spyOn(prefabInstance(near)!.sprite, 'update');
    position.set(new THREE.Vector3(300, 0, 0));
    playerpositions.set([new THREE.Vector3(300, 0, 0)]);
    await settle();
    expect(geometry(near)).toBeUndefined();
    expect(near.parent).toBeNull();
    // inst.Light stays declared through OnEntitySleep; the swarm's display stops listing it for the renderer.
    expect(declaredLight(near)?.intensity).toBe(.5);
    expect(listed(near)).toBe(false);
    // A player standing next to the swarm keeps it from fading in: it plays no animation, so nothing is built or sorted.
    expect(geometry(far)).toBeUndefined();
    expect(manager.renderEntities).toEqual([]);
    expect(target.isValid()).toBe(false);
    expect(target.capture()).toBe(false);
    nearUpdate.mockClear();
    manager.update(.1, new THREE.Quaternion());
    expect(nearUpdate).not.toHaveBeenCalled();
    expect(manager.exportRecords()).toEqual(records);
    expect(manager.entities.get('fireflies:near')).toBe(nearEntity);

    position.set(new THREE.Vector3()); playerpositions.set([new THREE.Vector3()]);
    await settle();
    expect(geometry(near)).toBeDefined();
    expect(geometry(far)).toBeUndefined();
    // The retained looping clip uses the shared instance batch after wake, so it has no ordinary draw entry.
    expect(near.visible).toBe(true);
    expect(manager.renderEntities).toEqual([]);
    expect(manager.exportRecords()).toEqual(records);
    expect(manager.entities.get('fireflies:near')).toBe(nearEntity);
    manager.update(.1, new THREE.Quaternion());
    expect(declaredLight(near)?.intensity).toBe(.5);
    manager.dispose();
    position.set(new THREE.Vector3(300, 0, 0)); await settle();
    expect(scene.children).toHaveLength(0);
    expect(geometry(near)).toBeUndefined(); expect(geometry(far)).toBeUndefined();
  });

  it('splits live drops, prevents bare-hand pickup, captures atomically and restores dark daytime swarms', async () => {
    assets();
    const scene = new THREE.Scene();
    const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
    const inventory = createPickupInventory();
    const pickup = vi.spyOn(inventory, 'GiveItem');
    pickup.mockImplementationOnce(entity => { entity.PushEvent('ondropped', undefined); return false; });
    const scheduler = new GameTimeScheduler();
    const { cycle, getWatchWorldContent, unbind } = bindTestWorld(scheduler); cycle.set('night');
    cleanups.push(() => { unbind(); scheduler.dispose(); });
    const manager = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
      { domElement: canvas } as unknown as THREE.WebGLRenderer, 'images.zip', inventory, '/anim', new THREE.Group(), undefined,
      { getWatchWorldContent });
    cleanups.push(() => manager.dispose());
    const definition = { itemId: 'fireflies', count: 2, name: '萤火虫', icon: 'fireflies.tex' };
    expect(await manager.drop(definition, new THREE.Vector3(8, 0, 9), () => false)).toBe(false);
    expect(scene.children).toHaveLength(0);
    const entity = manager.entities.create(definition);
    expect(await manager.drop(definition, new THREE.Vector3(8, 0, 9), () => entity)).toBe(true);
    expect(manager.exportRecords().map(r => r.components.stack!.count)).toEqual([1, 1]);
    const records = manager.exportRecords();
    expect(records[0].id).toBe(entity.id);
    expect(records[1].id).not.toBe(entity.id);
    const [target] = manager.netCaptureTargets;
    expect(target.capture()).toBe(false);
    expect(scene.children).toHaveLength(2);
    expect(target.capture()).toBe(true);
    expect(pickup).toHaveBeenLastCalledWith(entity, { x: 8, y: 0, z: 9 });
    expect(target.capture()).toBe(false);
    expect(declaredLight(target.model)).toBeUndefined();
    expect(manager.exportRecords()).toHaveLength(1);
    const dark = new GroundItemManager(new THREE.Scene(), new THREE.PerspectiveCamera(),
      { domElement: canvas } as unknown as THREE.WebGLRenderer, 'images.zip', inventory, '/anim', new THREE.Group());
    cleanups.push(() => dark.dispose());
    const restored = await dark.spawnFromSave(records[0].id, { ...definition, count: 1 }, new THREE.Vector3(8, 0, 9));
    expect(dark.exportRecords()).toEqual([records[0]]);
    expect(declaredLight(restored)).toBeUndefined();
    expect(dark.netCaptureTargets[0].isValid()).toBe(false);
    dark.update(5, new THREE.Quaternion());
    expect(dark.exportRecords()).toHaveLength(1);
  });
});
