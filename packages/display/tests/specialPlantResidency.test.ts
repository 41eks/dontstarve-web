import { prefabDisplay, PrefabDisplayGroup } from '../src';
import { testPlayer } from '../../../tests/fixtures/testPlayer';
import * as THREE from 'three';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { SpriteState } from '@dontstarve-web/display';
import { loadAnim } from '../../animation/src/animationAssets';
import { flowerPrefabs } from '../../prefab/src/flower';
import { marbleShrubWorld } from '../../../tests/fixtures/marbleShrubFixture';
import { rockAvocadoSaplingPrefabs, ROCK_AVOCADO_SAPLING_ID } from '../../prefab/src/rock_avocado_fruit_sprout_sapling';
import { FireFxHost } from '../../prefab/src/treeFire';
import { prefabManager } from '../../../tests/fixtures/prefabManagerFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork } from '../../stategraphs/src/componentactions';
import type { GroundItemDefinition } from '../../prefab/src/groundPrefab';
import { bindTestWorld, drawn } from '../../../tests/fixtures/worldContentFixture';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { workTargets } from '../../../tests/fixtures/workTargets';
import { testItem } from '../../../tests/fixtures/testInventory';

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn() })),
}));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    async (url: string) =>
      new Response(
        await readFile(new URL(`../../../public/dst/data/${String(url).split('dst/data/')[1]}`, import.meta.url)),
      ),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function meshes(model: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  model.traverse(object => {
    if (object instanceof THREE.Mesh) {
      result.push(object);
    }
  });
  return result;
}
function environment() {
  const scene = new THREE.Scene(),
    scheduler = new GameTimeScheduler(),
    physics = new CANNON.World();
  const awake = createSignal(true);
  const tickingarea = () => createMemo(() => awake.get());
  const sources = bindTestWorld(scheduler, tickingarea);
  const spawned = vi.fn();
  const spawnGroundItem = (definition: GroundItemDefinition, point: ReadonlyVector3) => {
    const entity = testItem({ itemId: definition.itemId, count: definition.count });
    entity.transform.copyPosition(point);
    spawned(definition.itemId, point.clone());
    return entity;
  };
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6);
  return {
    scene,
    scheduler,
    physics,
    awake,
    tickingarea,
    sources,
    spawnGroundItem,
    spawned,
    rotation,
    dispose: () => {
      sources.unbind();
      scheduler.dispose();
    },
  };
}

it('preserves a natural rose, shares its art after wake and burns while dormant', async () => {
  const env = environment();
  const displays = new PrefabDisplayGroup(env.scene),
    fire = FireFxHost.create('/dst/data/anim');
  const flowers = prefabManager(
    displays,
    '/dst/data/anim',
    { scheduler: env.scheduler, tickingarea: env.tickingarea, fire, spawnGroundItem: env.spawnGroundItem },
    flowerPrefabs,
  );
  try {
    const rose = flowers.spawn('flower', new THREE.Vector3(12, 0, 24), {
      id: 'rose',
      components: { flower: { animation: 'rose' } },
    });
    const model = await drawn(rose.transform.model);
    await settle();
    const sprite = rose.sprite as SpriteState;
    expect(sprite).toBeInstanceOf(SpriteState);
    const pickable = rose.components.pickable;
    const before = flowers.exportRecords();
    const geometry = meshes(model)[0].geometry;
    env.awake.set(false);
    await settle();
    expect(model.parent).toBeNull();
    expect(sprite.loaded).toBe(false);
    expect(displays.renderEntities).toEqual([]);
    expect(rose.TheSim.FindEntities(rose.position, 0.01, ['flower'])).toHaveLength(1);
    expect(flowers.exportRecords()).toEqual(before);
    env.sources.camerarotation.set(env.rotation);
    env.awake.set(true);
    await settle();
    expect(model.parent).toBe(env.scene);
    expect(meshes(model)[0].geometry).toBe(geometry);
    expect(model.children[0].quaternion.equals(env.rotation)).toBe(true);
    expect(rose.components.pickable).toBe(pickable);
    expect(rose.listTags()).toContain('thorny');
    expect(rose.planted).toBeUndefined();
    rose.components.burnable!.Ignite();
    await settle();
    // The fire is a shared-batch instance at the rose, drawn by the rose's display once the fire's frames load.
    await prefabDisplay(model)!.artLoaded();
    expect(prefabDisplay(model)!.batchedEffects).toHaveLength(1);
    env.awake.set(false);
    await settle();
    expect(displays.renderEntities).toEqual([]);
    env.scheduler.advance(10);
    await settle();
    expect(env.spawned).toHaveBeenCalledWith('ash', new THREE.Vector3(12, 0, 24));
    expect(flowers.exportRecords()).toEqual([]);
    env.awake.set(true);
    await settle();
    displays.update(0);
    expect(model.parent).toBeNull();
    expect(meshes(model)).toEqual([]);
  } finally {
    flowers.dispose();
    displays.dispose();
    fire.dispose();
    env.dispose();
  }
});

it('grows a dormant marblebean, restores shrub shape/tint/snow and preserves the mined removal deadline', async () => {
  const env = environment();
  const shrubWorld = {
    scheduler: env.scheduler,
    getWatchWorldContent: env.sources.getWatchWorldContent,
    spawnGroundItem: env.spawnGroundItem,
  };
  const shrubs = marbleShrubWorld(env.scene, shrubWorld, { physics: env.physics, tickingarea: env.tickingarea });
  const { saplings } = shrubs;
  const restored = marbleShrubWorld(env.scene, shrubWorld, { tickingarea: env.tickingarea });
  try {
    const bean = saplings.spawn(new THREE.Vector3(12, 0, 24));
    await drawn(workTargets('DIG')[0].model);
    const beanSprite = bean.sprite;
    env.awake.set(false);
    await settle();
    expect(beanSprite.loaded).toBe(false);
    const savedBean = saplings.exportRecords()[0];
    expect(savedBean.components.saplingTimer!.timers.grow.timeleft).toBe(225);
    env.scheduler.advance(225);
    await settle();
    expect(saplings.exportRecords()).toEqual([]);
    expect(bean.isRemoved).toBe(true);
    const shrub = workTargets('MINE')[0].model;
    const sprite = prefabInstance(shrub)!.sprite as SpriteState;
    expect(sprite.loaded).toBe(false);
    expect(shrubs.exportRecords()[0].components.marbleShrub).toEqual({ shapenumber: 2, color: 0.75 });
    expect(env.physics.bodies).toHaveLength(1);
    env.scheduler.advance(1400);
    await settle();
    // growable sleeps with the entity: the record keeps the stage and the sleep that its OnEntityWake settles.
    expect(shrubs.exportRecords()[0].components.growable).toEqual({ stage: 1, time: 1300, sleeptime: 1400 });
    env.sources.snowLevel.set(0.02);
    env.sources.camerarotation.set(env.rotation);
    shrubs.update(0);
    const record = shrubs.exportRecords()[0];
    const restoredShrub = restored.spawn('marbleshrub', new THREE.Vector3(...record.transform.position), record);
    const restoredModel = restoredShrub.transform.model;
    expect(restored.exportRecords()).toEqual([record]);
    env.awake.set(true);
    await settle();
    await Promise.all([drawn(shrub), drawn(restoredModel)]);
    // LongUpdate advances both shrubs to stage 2 during wake. Their first art load is still pending then,
    // so the display settles the one-shot growth animation to its queued idle.
    expect(shrubs.exportRecords()[0].components.growable?.stage).toBe(2);
    expect(restored.exportRecords()[0].components.growable?.stage).toBe(2);
    expect(sprite.currentAnimation).toBe('idle_normal');
    expect(restoredShrub.sprite.currentAnimation).toBe('idle_normal');
    expect(shrub.children[0].quaternion.equals(env.rotation)).toBe(true);
    expect(Array.from(meshes(shrub)[0].geometry.getAttribute('position').array)).toEqual(
      Array.from(meshes(restoredModel)[0].geometry.getAttribute('position').array),
    );
    const material = (meshes(shrub)[0].material as THREE.MeshBasicMaterial[])[0];
    expect(material.color.r).toBe(0.75);
    const snowyCount = meshes(shrub)[0].geometry.drawRange.count;
    env.sources.snowLevel.set(0);
    await settle();
    expect(meshes(shrub)[0].geometry.drawRange.count).toBeLessThan(snowyCount);
    const target = workTargets('MINE')[0];
    for (let i = 0; i < 8 && !prefabInstance(shrub)!.hasTag('NOCLICK'); i++) {
      performToolWork('MINE', target.entity, testPlayer());
    }
    expect(prefabInstance(shrub)!.listTags()).toContain('NOCLICK');
    env.awake.set(false);
    await settle();
    expect(prefabInstance(shrub)!.isRemoved).toBe(false);
    const bank = await loadAnim('marbleshrub.zip', '/dst/data/anim');
    const clip = bank.animations.find(clip => clip.name === 'mined_normal')!;
    const seconds = clip.frames.length / clip.frameRate;
    env.scheduler.advance(seconds - 0.001);
    expect(prefabInstance(shrub)!.isRemoved).toBe(false);
    env.scheduler.advance(0.001);
    expect(prefabInstance(shrub)!.isRemoved).toBe(true);
    expect(shrubs.exportRecords()).toEqual([]);
    expect(env.physics.bodies).toHaveLength(0);
  } finally {
    shrubs.dispose();
    restored.dispose();
    env.dispose();
  }
});

it('keeps a sprout completion task alive without visual reload and cancels a second dormant sprout when dug', async () => {
  const env = environment();
  const spawnBush = vi.fn();
  const bushes = {
    spawn: (_prefab: string, position: THREE.Vector3) => {
      spawnBush(position.clone());
      return new THREE.Group();
    },
  };
  const displays = new PrefabDisplayGroup(env.scene),
    fire = FireFxHost.create('/dst/data/anim');
  const sprouts = prefabManager(
    displays,
    '/dst/data/anim',
    {
      scheduler: env.scheduler,
      tickingarea: env.tickingarea,
      fire,
      spawnPrefab: (id: string, position: ReadonlyVector3) => bushes.spawn(id, position as THREE.Vector3),
      spawnGroundItem: env.spawnGroundItem,
    },
    rockAvocadoSaplingPrefabs,
  );
  try {
    const sprout = sprouts.spawn(ROCK_AVOCADO_SAPLING_ID, new THREE.Vector3(12, 0, 24));
    await drawn(sprout.transform.model);
    const sprite = sprout.sprite,
      timer = sprout.components.timer;
    env.awake.set(false);
    await settle();
    expect(sprite.loaded).toBe(false);
    env.scheduler.advance(400);
    expect(sprouts.exportRecords()[0].record.components.saplingTimer!.timers.grow.timeleft).toBe(1100);
    env.scheduler.advance(1100);
    const completion = sprout.seedGrowth!,
      endTime = completion.NextTime();
    expect(endTime).toBeDefined();
    expect(spawnBush).not.toHaveBeenCalled();
    env.scheduler.advanceTo(endTime!);
    expect(spawnBush).toHaveBeenCalledExactlyOnceWith(new THREE.Vector3(12, 0, 24));
    expect(sprouts.exportRecords()).toEqual([]);
    expect(completion.NextTime()).toBeUndefined();
    expect(timer.snapshot('grow').value.status).toBe('expired');
    const second = sprouts.spawn(ROCK_AVOCADO_SAPLING_ID, new THREE.Vector3(24, 0, 24));
    await settle();
    expect(second.sprite.loaded).toBe(false);
    expect(workTargets('DIG')[0].work()).toBe(true);
    env.awake.set(true);
    env.scheduler.advance(2000);
    await settle();
    expect(spawnBush).toHaveBeenCalledOnce();
    expect(meshes(second.transform.model)).toEqual([]);
    expect(env.spawned).toHaveBeenCalledWith('rock_avocado_fruit_sprout', new THREE.Vector3(24, 0, 24));
  } finally {
    sprouts.dispose();
    displays.dispose();
    fire.dispose();
    env.dispose();
  }
});
