import { PrefabDisplayGroup } from '../../display/src';
import { testPlayer } from './testPlayer';
import { prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { archivePropsPrefabs } from '../../prefab/src/archive_props';
import { marbleShrubWorld } from './marbleShrubFixture';
import { nightmareRockWorld } from './nightmareRockFixture';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { FACING } from '../src/facing';
import { workTargets } from './workTargets';

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn(), isPlaying: () => true })),
}));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const spawnGroundItem = () => undefined;
const meshes = (model: THREE.Object3D) => {
  const found: THREE.Mesh[] = [];
  model.traverse(o => {
    if (o instanceof THREE.Mesh) {
      found.push(o);
    }
  });
  return found;
};
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('restores portal ground layers, its shadow child and statue work state without replacing logical entities', async () => {
  const scene = new THREE.Scene(),
    awake = createSignal(true),
    cameraFacing = createSignal<number>(FACING.DOWN),
    scheduler = new GameTimeScheduler();
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {
    tickingarea: () => createMemo(() => awake.get()),
  });
  prefabs.register(
    archivePropsPrefabs({
      scheduler,
      spawnGroundItem,
      cameraFacing,
      fx: { collapse: () => {} },
      spawnPrefab: (id, position) => prefabs.spawn(id, position),
    }),
  );
  try {
    const portal = prefabs.spawn('archive_portal', new THREE.Vector3(3, 0, 6)).transform.model;
    const statue = prefabs.spawn('archive_moon_statue', new THREE.Vector3(9, 0, 6)).transform.model;
    const ambient = prefabs.spawn('archive_ambient_sfx', new THREE.Vector3(15, 0, 6)).transform.model;
    const shadowInstance = scene.children
      .map(model => prefabInstance(model)!)
      .find(inst => inst.prefab === 'archive_portal_shadow')!;
    const shadow = shadowInstance.transform.model;
    await Promise.all([portal, shadow].map(model => prefabDisplay(model)!.artLoaded()));
    const mine = workTargets('MINE')[0];
    mine.entity.components.workable!.WorkedBy(testPlayer(), 5);
    await settle();
    const records = prefabs.exportRecords();
    const work = mine.entity.components.workable!.GetWorkLeft();
    expect(shadowInstance.persists).toBe(false);
    expect(shadowInstance.listTags()).toEqual(expect.arrayContaining(['DECOR', 'NOCLICK']));
    // The archive path is stable root -> drawn sprite -> visual -> merged frame.
    const portalVisual = portal.children[0].children[0];
    expect(portalVisual.rotation.x).toBe(-Math.PI / 2);
    // Both stay at the terrain's group order; their mesh orders lay the shadow (sort order 1) under the portal (FinalOffset 2).
    expect([portalVisual.renderOrder, shadow.children[0].children[0].renderOrder]).toEqual([0, 0]);
    const portalOrder = portalVisual.children[0].renderOrder;
    expect(shadow.children[0].children[0].children[0].renderOrder).toBeLessThan(portalOrder);
    awake.set(false);
    await settle();
    for (const model of [portal, statue, ambient, shadow]) {
      expect(prefabInstance(model)!.status.peek()).toBe('asleep');
      expect(model.parent).toBeNull();
      expect(meshes(model)).toHaveLength(0);
    }
    expect(prefabs.exportRecords()).toEqual(records);
    expect(mine.entity.components.workable!.GetWorkLeft()).toBe(work);
    cameraFacing.set(FACING.UPRIGHT);
    await settle();
    awake.set(true);
    await settle();
    await Promise.all([portal, shadow].map(model => prefabDisplay(model)!.artLoaded()));
    expect(portal.parent).toBe(scene);
    expect(shadow.parent).toBe(scene);
    expect(ambient.parent).toBe(scene);
    expect(portal.rotation.y).toBe(0);
    expect(portal.children[0].children[0].rotation.x).toBe(-Math.PI / 2);
    expect(portal.children[0].children[0].children[0].renderOrder).toBe(portalOrder);
    expect(shadow.children[0].children[0].children[0].renderOrder).toBeLessThan(portalOrder);
    expect(shadowInstance.sprite.sprite.peek().facing).toBe(FACING.UPRIGHT);
    expect(prefabInstance(statue)!.sprite.currentAnimation).toMatch(/^idle_med_/);
    expect(prefabs.exportRecords()).toEqual(records);
    awake.set(false);
    await settle();
    mine.entity.components.workable!.WorkedBy(testPlayer(), work);
    expect(prefabInstance(statue)!.status.peek()).toBe('removed');
    prefabs.dispose();
    displays.dispose();
    await settle();
    awake.set(true);
    await settle();
    expect(scene.children).toEqual([]);
  } finally {
    prefabs.dispose();
    displays.dispose();
    scheduler.dispose();
  }
});

it('grows an unloaded marble shrub and keeps shape, colour and the scheduled mined-removal deadline', async () => {
  const scene = new THREE.Scene(),
    scheduler = new GameTimeScheduler(),
    awake = createSignal(false);
  const manager = marbleShrubWorld(
    scene,
    { scheduler, spawnGroundItem },
    { tickingarea: () => createMemo(() => awake.get()) },
  );
  try {
    const instance = manager.spawn('marbleshrub', new THREE.Vector3(12, 0, 24), {
      id: 'growing-shrub',
      components: { growable: { stage: 1, time: 1 }, marbleShrub: { shapenumber: 3, color: 0.7 } },
    });
    const model = workTargets('MINE')[0].model;
    await settle();
    expect(instance.status.peek()).toBe('asleep');
    scheduler.advance(1);
    await settle();
    const record = manager.exportRecords()[0];
    expect(record.id).toBe('growing-shrub');
    expect(record.components.growable!.stage).toBe(2);
    expect(record.components.marbleShrub).toEqual({ shapenumber: 3, color: 0.7 });
    expect(instance.sprite.currentAnimation).toBe('idle_normal');
    expect(meshes(model)).toHaveLength(0);
    awake.set(true);
    await settle();
    expect(instance.position).toBe(model.position);
    expect(model.parent).toBe(scene);
    expect(instance.sprite.sprite.peek().colour).toEqual([0.7, 0.7, 0.7]);
    expect(instance.sprite.sprite.peek().appearance.get('archive-symbol:marbleshrub_top1')).toMatchObject({
      sourceSymbol: 'marbleshrub_top3',
    });
    awake.set(false);
    await settle();
    const target = workTargets('MINE')[0];
    target.entity.components.workable!.WorkedBy(testPlayer(), 8);
    expect(instance.status.peek()).toBe('asleep');
    expect(instance.persists).toBe(false);
    expect(manager.exportRecords()).toEqual([]);
    scheduler.advance(30);
    expect(instance.status.peek()).toBe('removed');
    awake.set(true);
    await settle();
    expect(scene.children).toEqual([]);
  } finally {
    manager.dispose();
    scheduler.dispose();
  }
});

it('keeps a sanityrock transition on game time through sleep and restores its stategraph pose and collision on wake', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const scene = new THREE.Scene(),
    scheduler = new GameTimeScheduler(),
    awake = createSignal(true),
    physics = new CANNON.World();
  const player = { position: new THREE.Vector3(12, 0, 6), sanity: { IsSane: () => true, IsInsane: () => false } };
  const manager = nightmareRockWorld(
    scene,
    { scheduler, getPlayers: () => [player] },
    { physics, tickingarea: () => createMemo(() => awake.get()) },
  );
  try {
    const rock = manager.spawn('sanityrock', new THREE.Vector3(12, 0, 6)),
      model = rock.transform.model;
    await prefabDisplay(model)!.artLoaded();
    scheduler.advance(0);
    expect(rock.sg.stateName).toBe('raise');
    const instance = prefabInstance(model)!,
      records = manager.exportRecords();
    expect(instance.sprite.currentAnimation).toBe('raise');
    awake.set(false);
    await settle();
    // Unloading the art does not end the transition: raise (45 frames) still ends on game time.
    expect(rock.sg.stateName).toBe('raise');
    expect(instance.status.peek()).toBe('asleep');
    scheduler.advance(44.5 / 30);
    expect(rock.sg.stateName).toBe('raise');
    scheduler.advance(1 / 30);
    expect(rock.sg.stateName).toBe('idle');
    expect(model.parent).toBeNull();
    expect(meshes(model)).toHaveLength(0);
    expect(instance.physicsBody!.collisionResponse).toBe(true);
    expect(manager.exportRecords()).toEqual(records);
    awake.set(true);
    await settle();
    expect(model.parent).toBe(scene);
    expect(instance.sprite.currentAnimation).toBe('idle_active');
    expect(instance.position.toArray()).toEqual([12, 0, 6]);
    awake.set(false);
    await settle();
    // lower_to_conceal (24 frames) ends on game time, asleep as awake.
    rock.ConcealForMinigame(rock, true);
    scheduler.advance(0.2 + 24.5 / 30);
    await settle();
    expect(rock.sg.stateName).toBe('concealed');
    expect(instance.physicsBody!.collisionResponse).toBe(false);
    awake.set(true);
    await settle();
    expect(model.visible).toBe(false);
    manager.dispose();
    await settle();
    expect(instance.status.peek()).toBe('removed');
    expect(physics.bodies).toEqual([]);
    awake.set(false);
    awake.set(true);
    await settle();
    expect(scene.children).toEqual([]);
  } finally {
    manager.dispose();
    scheduler.dispose();
  }
});
