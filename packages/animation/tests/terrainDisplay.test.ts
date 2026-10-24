import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { ArchivePropsManager } from '../../prefab/src/archive_props';
import { MarbleShrubManager } from '../../prefab/src/marbleshrub';
import { NightmareRockManager } from '../../prefab/src/nightmarerock';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { FACING } from '../src/facing';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const prepareSpawn = async () => ({ spawnedEntity: undefined, spawn: () => true, dispose() {} }) as never;
const meshes = (model: THREE.Object3D) => { const found: THREE.Mesh[] = []; model.traverse(o => { if (o instanceof THREE.Mesh) found.push(o); }); return found; };
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('restores portal ground layers, its declared shadow and statue work state without replacing logical entities', async () => {
  const scene = new THREE.Scene(), awake = createSignal(true), cameraFacing = createSignal<number>(FACING.DOWN);
  const manager = new ArchivePropsManager(scene, { prepareSpawn, cameraFacing, tickingarea: () => createMemo(() => awake.get()) });
  try {
    const portal = (await manager.spawn('archive_portal', new THREE.Vector3(3, 0, 6)))!;
    const statue = (await manager.spawn('archive_moon_statue', new THREE.Vector3(9, 0, 6)))!;
    const ambient = (await manager.spawn('archive_ambient_sfx', new THREE.Vector3(15, 0, 6)))!;
    const mine = manager.mineTargets[0];
    mine.entity.components.workable!.WorkedBy({}, 5);
    await settle();
    const shadow = portal.children.find(child => child.userData.tags?.includes('DECOR'))!;
    const records = manager.exportRecords();
    const work = mine.entity.components.workable!.GetWorkLeft();
    const shadowInstance = prefabInstance(shadow)!;
    expect(shadowInstance.persists).toBe(false);
    expect(shadow.userData.tags).toEqual(['DECOR', 'NOCLICK']);
    // The archive path is stable root -> drawn sprite -> visual -> merged frame.
    const portalVisual = portal.children[0].children[0];
    expect(portalVisual.rotation.x).toBe(-Math.PI / 2);
    const portalOrder = portalVisual.renderOrder;
    expect(shadow.children[0].children[0].renderOrder).toBeLessThan(portalOrder);
    awake.set(false); await settle();
    for (const model of [portal, statue, ambient, shadow]) {
      expect(prefabInstance(model)!.status.peek()).toBe('asleep');
      expect(model.parent).toBeNull();
      expect(meshes(model)).toHaveLength(0);
    }
    expect(manager.exportRecords()).toEqual(records);
    expect(mine.entity.components.workable!.GetWorkLeft()).toBe(work);
    cameraFacing.set(FACING.UPRIGHT); await settle();
    awake.set(true); await settle();
    expect(portal.parent).toBe(scene); expect(shadow.parent).toBe(portal); expect(ambient.parent).toBe(scene);
    expect(portal.rotation.y).toBe(0);
    expect(portal.children[0].children[0].rotation.x).toBe(-Math.PI / 2);
    expect(portal.children[0].children[0].renderOrder).toBe(portalOrder);
    expect(shadow.children[0].children[0].renderOrder).toBeLessThan(portalOrder);
    expect(shadowInstance.sprite.sprite.peek().facing).toBe(FACING.UPRIGHT);
    expect(prefabInstance(statue)!.sprite.currentAnimation).toMatch(/^idle_med_/);
    expect(manager.exportRecords()).toEqual(records);
    awake.set(false); await settle();
    mine.entity.components.workable!.WorkedBy({}, work);
    expect(prefabInstance(statue)!.status.peek()).toBe('removed');
    manager.dispose(); await settle();
    awake.set(true); await settle();
    expect(scene.children).toEqual([]);
  } finally { manager.dispose(); }
});

it('grows an unloaded marble shrub and keeps shape, colour and the scheduled mined-removal deadline', async () => {
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(false);
  const manager = new MarbleShrubManager(scene, { scheduler, prepareSpawn, tickingarea: () => createMemo(() => awake.get()) });
  try {
    const model = await manager.spawn('marbleshrub', new THREE.Vector3(12, 0, 24), {
      id: 'growing-shrub', transform: { position: [12, 0, 24], rotationY: 0 },
      components: { growable: { stage: 1, time: 1 }, marbleShrub: { shapenumber: 3, color: .7 } },
    });
    const instance = prefabInstance(model)!;
    await settle();
    expect(instance.status.peek()).toBe('asleep');
    scheduler.advance(1); await settle();
    const record = manager.exportRecords()[0];
    expect(record.id).toBe('growing-shrub');
    expect(record.components.growable.stage).toBe(2);
    expect(record.components.marbleShrub).toEqual({ shapenumber: 3, color: .7 });
    expect(instance.sprite.currentAnimation).toBe('idle_normal');
    expect(meshes(model)).toHaveLength(0);
    awake.set(true); await settle();
    expect(instance.position).toBe(model.position);
    expect(model.parent).toBe(scene);
    expect(instance.sprite.sprite.peek().colour).toEqual([.7, .7, .7]);
    expect(instance.sprite.sprite.peek().appearance.get('archive-symbol:marbleshrub_top1')).toMatchObject({ sourceSymbol: 'marbleshrub_top3' });
    awake.set(false); await settle();
    const target = manager.mineTargets[0];
    target.entity.components.workable!.WorkedBy({}, 8);
    expect(instance.status.peek()).toBe('asleep');
    expect(instance.persists).toBe(false);
    expect(manager.exportRecords()).toEqual([]);
    scheduler.advance(30);
    expect(instance.status.peek()).toBe('removed');
    awake.set(true); await settle();
    expect(scene.children).toEqual([]);
  } finally { manager.dispose(); scheduler.dispose(); }
});

it('settles a sanityrock transition on sleep and restores its stategraph pose and collision on wake', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true), physics = new CANNON.World();
  const player = { position: new THREE.Vector3(12, 0, 6), sanity: { IsSane: () => true, IsInsane: () => false } };
  const manager = new NightmareRockManager(scene, '/dst/data/anim', { scheduler, physics,
    tickingarea: () => createMemo(() => awake.get()), getPlayers: () => [player], fx: { prepare: async () => {}, spawn: vi.fn() } });
  try {
    const model = await manager.spawn('sanityrock', new THREE.Vector3(12, 0, 6));
    const rock = model.userData.nightmareRock;
    scheduler.advance(0);
    expect(rock.sg.stateName).toBe('raise');
    const instance = prefabInstance(model)!, records = manager.exportRecords();
    expect(instance.sprite.currentAnimation).toBe('raise');
    awake.set(false); await settle();
    expect(rock.sg.stateName).toBe('idle');
    expect(instance.status.peek()).toBe('asleep');
    expect(model.parent).toBeNull(); expect(meshes(model)).toHaveLength(0);
    expect(instance.physicsBody!.collisionResponse).toBe(true);
    expect(manager.exportRecords()).toEqual(records);
    awake.set(true); await settle();
    expect(model.parent).toBe(scene);
    expect(instance.sprite.currentAnimation).toBe('idle_active');
    expect(instance.position.toArray()).toEqual([12, 0, 6]);
    awake.set(false); await settle();
    rock.ConcealForMinigame(true); scheduler.advance(.2); await settle();
    expect(rock.sg.stateName).toBe('concealed');
    expect(instance.physicsBody!.collisionResponse).toBe(false);
    awake.set(true); await settle();
    expect(model.visible).toBe(false);
    manager.dispose(); await settle();
    expect(instance.status.peek()).toBe('removed'); expect(physics.bodies).toEqual([]);
    awake.set(false); awake.set(true); await settle();
    expect(scene.children).toEqual([]);
  } finally { manager.dispose(); scheduler.dispose(); }
});
