import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal, EventEmitter } from '@dontstarve-web/signals';
import { SpriteState } from '@dontstarve-web/display';
import { loadAnim } from '../src/animationAssets';
import { ItemEntity } from '../../inventory/src';
import { FlowerPlanting } from '../../prefab/src/flower';
import { MarbleShrubManager } from '../../prefab/src/marbleshrub';
import { MarbleBeanSaplingManager } from '../../prefab/src/marblebean_sapling';
import { RockAvocadoSaplingManager } from '../../prefab/src/rock_avocado_fruit_sprout_sapling';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork } from '../../stategraphs/src/componentactions';
import type { WorldContext, WorldEvents } from '../../prefab/src/worldContext';
import type { GroundItemDefinition } from '../../prefab/src/groundPrefab';
import { bindTestWorld, drawn } from './worldContentFixture';
import { modelHasTag, prefabInstance } from '../../prefab/src/prefabInstance';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(
    `../../../public/dst/data/${String(url).split('dst/data/')[1]}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function meshes(model: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  model.traverse(object => { if (object instanceof THREE.Mesh) result.push(object); });
  return result;
}
function environment() {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), physics = new CANNON.World();
  const awake = createSignal(true);
  const tickingarea = () => createMemo(() => awake.get());
  const sources = bindTestWorld(scheduler, tickingarea);
  const spawned = vi.fn();
  const spawnGroundItem = (definition: GroundItemDefinition, point: THREE.Vector3) => {
    const entity = new ItemEntity({ itemId: definition.itemId, count: definition.count });
    entity.transform.position.copy(point); spawned(definition.itemId, point.clone());
    return entity;
  };
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .6);
  return { scene, scheduler, physics, awake, tickingarea, sources, spawnGroundItem, spawned, rotation,
    dispose: () => { sources.unbind(); scheduler.dispose(); } };
}

it('preserves a natural rose, shares its art after wake and burns while dormant', async () => {
  const env = environment(), worldEvents = new EventEmitter<WorldEvents>();
  const ash = vi.fn(); worldEvents.on('spawnAsh', ash);
  const world = { scene: env.scene, camera: new THREE.PerspectiveCamera(), scheduler: env.scheduler, tickingarea: env.tickingarea } as unknown as WorldContext;
  const flowers = new FlowerPlanting(world, Math.random, { scheduler: env.scheduler, worldEvents });
  try {
    const model = await drawn(flowers.spawnFromSave('rose', 'rose', new THREE.Vector3(12, 0, 24), false));
    await settle();
    const sprite = model.userData.animationController as SpriteState;
    expect(sprite).toBeInstanceOf(SpriteState);
    const pickable = model.userData.components.pickable;
    const before = flowers.exportRecords();
    const geometry = meshes(model)[0].geometry;
    env.awake.set(false); await settle();
    expect(model.parent).toBeNull(); expect(sprite.loaded).toBe(false); expect(flowers.renderEntities).toEqual([]);
    expect(flowers.plantedFlowers[0].position).toBe(model.position);
    expect(flowers.exportRecords()).toEqual(before);
    env.sources.camerarotation.set(env.rotation);
    env.awake.set(true); await settle();
    expect(model.parent).toBe(env.scene);
    expect(meshes(model)[0].geometry).toBe(geometry);
    expect(model.children[0].quaternion.equals(env.rotation)).toBe(true);
    expect(model.userData.components.pickable).toBe(pickable);
    expect(prefabInstance(model)!.listTags()).toContain('thorny');
    expect(model.userData.planted).toBe(false);
    model.userData.components.burnable.Ignite(); await settle();
    expect(flowers.renderEntities.some(({ object }) => object.name === 'fire')).toBe(true);
    env.awake.set(false); await settle();
    expect(flowers.renderEntities).toEqual([]);
    env.scheduler.advance(10); await settle();
    expect(ash).toHaveBeenCalledWith(new THREE.Vector3(12, 0, 24));
    expect(flowers.exportRecords()).toEqual([]);
    env.awake.set(true); await settle();
    expect(model.parent).toBeNull(); expect(meshes(model)).toEqual([]);
  } finally { flowers.dispose(); env.dispose(); }
});

it('grows a dormant marblebean, restores shrub shape/tint/snow and preserves the mined removal deadline', async () => {
  const env = environment();
  const shrubs = new MarbleShrubManager(env.scene, { scheduler: env.scheduler, physics: env.physics, tickingarea: env.tickingarea,
    getWatchWorldContent: env.sources.getWatchWorldContent, spawnGroundItem: env.spawnGroundItem });
  const saplings = new MarbleBeanSaplingManager(env.scene, { scheduler: env.scheduler, tickingarea: env.tickingarea, shrubs, spawnGroundItem: env.spawnGroundItem });
  const restored = new MarbleShrubManager(env.scene, { scheduler: env.scheduler, tickingarea: env.tickingarea,
    getWatchWorldContent: env.sources.getWatchWorldContent, spawnGroundItem: env.spawnGroundItem });
  try {
    const bean = await drawn(saplings.spawn(new THREE.Vector3(12, 0, 24)));
    const beanSprite = bean.userData.animationController as SpriteState;
    env.awake.set(false); await settle();
    expect(beanSprite.loaded).toBe(false);
    const savedBean = saplings.exportRecords()[0];
    expect(savedBean.components.saplingTimer!.timers.grow.timeleft).toBe(225);
    env.scheduler.advance(225); await settle();
    expect(saplings.exportRecords()).toEqual([]); expect(bean.userData.removed).toBe(true);
    const shrub = shrubs.mineTargets[0].model;
    const sprite = shrub.userData.animationController as SpriteState;
    expect(sprite.loaded).toBe(false);
    expect(shrubs.exportRecords()[0].components.marbleShrub).toEqual({ shapenumber: 2, color: .75 });
    expect(env.physics.bodies).toHaveLength(1);
    env.scheduler.advance(2700); await settle();
    expect(shrubs.exportRecords()[0].components.growable.stage).toBe(2);
    env.sources.snowLevel.set(.02); env.sources.camerarotation.set(env.rotation); shrubs.update(0, env.rotation);
    const record = shrubs.exportRecords()[0];
    const loaded = await drawn(restored.spawn('marbleshrub', new THREE.Vector3(...record.transform.position), record));
    await settle(); expect(restored.exportRecords()).toEqual([record]);
    env.awake.set(true); await settle();
    expect(sprite.currentAnimation).toBe('idle_normal');
    expect(shrub.children[0].quaternion.equals(env.rotation)).toBe(true);
    expect(Array.from(meshes(shrub)[0].geometry.getAttribute('position').array))
      .toEqual(Array.from(meshes(loaded)[0].geometry.getAttribute('position').array));
    const material = (meshes(shrub)[0].material as THREE.MeshBasicMaterial[])[0];
    expect(material.color.r).toBe(.75);
    const snowyCount = meshes(shrub)[0].geometry.drawRange.count;
    env.sources.snowLevel.set(0); await settle();
    expect(meshes(shrub)[0].geometry.drawRange.count).toBeLessThan(snowyCount);
    const target = shrubs.mineTargets[0];
    for (let i = 0; i < 8 && !modelHasTag(shrub, 'NOCLICK'); i++) performToolWork('MINE', target.entity, {});
    expect(prefabInstance(shrub)!.listTags()).toContain('NOCLICK');
    env.awake.set(false); await settle();
    expect(shrub.userData.removed).toBe(false);
    const bank = await loadAnim('marbleshrub.zip', '/dst/data/anim');
    const clip = bank.animations.find(clip => clip.name === 'mined_normal')!;
    const seconds = clip.frames.length / clip.frameRate;
    env.scheduler.advance(seconds - .001); expect(shrub.userData.removed).toBe(false);
    env.scheduler.advance(.001); expect(shrub.userData.removed).toBe(true);
    expect(shrubs.exportRecords()).toEqual([]);
    expect(env.physics.bodies).toHaveLength(0);
  } finally { saplings.dispose(); shrubs.dispose(); restored.dispose(); env.dispose(); }
});

it('keeps a sprout completion task alive without visual reload and cancels a second dormant sprout when dug', async () => {
  const env = environment();
  const spawnBush = vi.fn();
  const bushes = { spawnNatural: (position: THREE.Vector3) => { spawnBush(position.clone()); return new THREE.Group(); } };
  const sprouts = new RockAvocadoSaplingManager(env.scene, { scheduler: env.scheduler, tickingarea: env.tickingarea, bushes, spawnGroundItem: env.spawnGroundItem });
  try {
    const model = await drawn(sprouts.spawn(new THREE.Vector3(12, 0, 24)));
    const sprite = model.userData.animationController as SpriteState;
    const timer = model.userData.components.timer;
    env.awake.set(false); await settle();
    expect(sprite.loaded).toBe(false);
    env.scheduler.advance(400);
    expect(sprouts.exportRecords()[0].components.saplingTimer!.timers.grow.timeleft).toBe(1100);
    env.scheduler.advance(1100);
    const completion = model.userData.saplingState.completionTimer;
    const snapshot = completion.peek();
    expect(snapshot.status).toBe('scheduled'); expect(spawnBush).not.toHaveBeenCalled();
    env.scheduler.advanceTo(snapshot.endTime);
    expect(spawnBush).toHaveBeenCalledExactlyOnceWith(new THREE.Vector3(12, 0, 24));
    expect(sprouts.exportRecords()).toEqual([]); expect(completion.peek().status).toBe('stopped');
    expect(timer.snapshot('grow').peek().status).toBe('expired');
    const second = await drawn(sprouts.spawn(new THREE.Vector3(24, 0, 24))); await settle();
    expect((second.userData.animationController as SpriteState).loaded).toBe(false);
    expect(sprouts.digTargets[0].dig()).toBe(true);
    env.awake.set(true); env.scheduler.advance(2000); await settle();
    expect(spawnBush).toHaveBeenCalledOnce(); expect(meshes(second)).toEqual([]);
    expect(env.spawned).toHaveBeenCalledWith('rock_avocado_fruit_sprout', new THREE.Vector3(24, 0, 24));
  } finally { sprouts.dispose(); env.dispose(); }
});
