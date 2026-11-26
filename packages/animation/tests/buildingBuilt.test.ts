import { GameTimeScheduler } from '../../signals/src';
import { PrefabInstance, prefabInstance } from '../../prefab/src/prefabInstance';
import { SpriteState } from '../../display/src';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import definitions from '../../prefab/src/definitions.json';
import { WORLD_SCALE } from '../../prefab/src/tile';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { managedBuildings } from './managedBuildings';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { findActionEntity } from '../../prefab/src/actionEntity';
import { performRummageAction } from '../../stategraphs/src/rummage';
import { miniMapEntities } from '../../map/src/minimapEntities';
import type { WorldContext } from '../../prefab/src/worldContext';
import type { SpriteAnimationController } from '../src/sprite';
import { sceneActions } from './sceneActions';
import { disposePlacingPlayers, placingPlayer } from './placingPlayer';

afterEach(() => {
  disposePlacingPlayers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup(definition: { archive: string }) {
  const bytes = await readFile(new URL(`../../../public/dst/data/anim/${definition.archive}`, import.meta.url));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bytes)),
  );
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', {
    createElement: () => ({ setAttribute: vi.fn(), style: {} }),
    body: { appendChild: vi.fn() },
  });
  const canvas = new EventTarget();
  const world = {
    physics: new CANNON.World(),
    scene: new THREE.Scene(),
    player: new THREE.Object3D(),
    ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(),
    renderer: { domElement: canvas },
    scheduler: new GameTimeScheduler(),
  } as unknown as WorldContext;
  world.player.position.set(100, 0, 100);
  const consume = vi.fn(() => true);
  const placement = managedBuildings(world, { consume });
  vi.spyOn(PointerRaycaster.prototype, 'trackPointer').mockImplementation(() => {});
  const point = new THREE.Vector3(3, 0, 4);
  const ground = vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(point);
  const isOverGround = (onGround: boolean) => ground.mockReturnValue(onGround ? point : undefined);
  vi.spyOn(PointerRaycaster.prototype, 'raycastPointer').mockImplementation(
    objects => ({ object: objects[0], point: new THREE.Vector3() }) as THREE.Intersection,
  );
  // The click is the player's BUILD: it walks to the placer and builds on the hit frame.
  const player = placingPlayer(world, placement.placement, placement.spawnBuilding);
  const click = () => {
    player.click();
    player.place();
  };
  const begin = (recipe: Parameters<typeof placement.begin>[0]) => {
    player.pay(recipe);
    return placement.begin(recipe);
  };
  return { placement: { ...placement, begin }, world, consume, isOverGround, click };
}

it("runs a cookpot's built animation only after a successful placement", async () => {
  const { placement, world, consume, isOverGround, click } = await setup(definitions.animatedBuildings.cookpot);
  // inst:ListenForEvent("onbuilt"): the build pushes the event on the entity it spawns.
  const pushEvent = vi.spyOn(PrefabInstance.prototype, 'PushEvent'),
    playOnce = vi.spyOn(SpriteState.prototype, 'playOnce');
  const onbuilt = () => pushEvent.mock.calls.filter(([event]) => event === 'onbuilt');
  const records = () => placement.exportRecords().filter(({ prefabId }) => prefabId === 'cookpot');
  try {
    await placement.spawn('cookpot');
    expect(onbuilt()).toHaveLength(0);
    await placement.begin('cookpot');
    const placerModel = world.scene.children.at(-1)!,
      placer = prefabInstance(placerModel)!;
    // MakePlacer: its own non-persisting entity, declaring a looping clip, SetLightOverride(1) and the placer tags.
    expect(placer.prefab).toBe('cookpot_placer');
    expect(placer.persists).toBe(false);
    for (const tag of ['CLASSIFIED', 'NOCLICK', 'placer']) {
      expect(placer.hasTag(tag)).toBe(true);
    }
    expect(placer.sprite.sprite.value).toMatchObject({
      clip: { name: 'idle_empty', loop: true },
      lightOverride: 1,
      opacity: 0.65,
      visible: true,
    });
    expect(placer.position.toArray()).toEqual([3, 0, 4]);

    isOverGround(false);
    click();
    expect(consume).not.toHaveBeenCalled();
    isOverGround(true);
    consume.mockReturnValue(false);
    click();
    // builder:DoBuild refuses on the hit frame: nothing is built, and the placer was released by the click.
    expect(onbuilt()).toHaveLength(0);
    expect(records()).toHaveLength(1);
    expect(placer.status.value).toBe('removed');

    consume.mockReturnValue(true);
    await placement.begin('cookpot');
    click();
    expect(onbuilt()).toHaveLength(1);
    // The build spawns the building itself and releases the placer.
    const built = pushEvent.mock.contexts[
      pushEvent.mock.calls.findIndex(([event]) => event === 'onbuilt')
    ] as PrefabInstance;
    expect(built.prefab).toBe('cookpot');
    expect(built.transform.model).not.toBe(placerModel);
    expect(placerModel.parent).toBeNull();
    // onbuilt: PlayAnimation("place"), PushAnimation("idle_empty", false).
    expect(playOnce.mock.calls.filter(([name]) => name === 'place')).toHaveLength(1);
    expect(built.sprite.sprite.value.lightOverride).toBeUndefined();
    expect(records()[1].record.transform.position).toEqual([3, 0, 4]);
    await vi.waitFor(() => expect(built.sprite.loaded).toBe(true));
    for (let frame = 0; frame < 100; frame++) {
      placement.update(0.1);
    }
    expect(built.sprite.sprite.value.clip).toMatchObject({ name: 'idle_empty', loop: false });

    await placement.spawnFromSave('cookpot', records()[1].record);
    await placement.begin('cookpot');
    placement.cancel();
    expect(onbuilt()).toHaveLength(1);
  } finally {
    placement.dispose();
  }
});

it('opens a chest during its place clip, as source onbuilt does not lock the container', async () => {
  // A storage building's real ID gives it its container.
  const { placement, world, click } = await setup(definitions.animatedBuildings.treasurechest);
  await placement.begin('treasurechest');
  click();
  const model = world.scene.children[0],
    instance = prefabInstance(model)!;
  const playOnce = vi.spyOn(instance.sprite as SpriteAnimationController, 'playOnce');
  expect(sceneActions(model).filter(action => action === 'RUMMAGE')).toEqual(['RUMMAGE']);
  expect(performRummageAction(findActionEntity(model)!, world.player)).toBe(true);
  expect(playOnce).toHaveBeenCalledExactlyOnceWith('open');
});

it('gives placed and restored chests a map icon at their foot and releases it with the entity', async () => {
  const { placement, world, click } = await setup(definitions.animatedBuildings.treasurechest);
  const icons = () =>
    [...miniMapEntities()].filter(icon => world.scene.children.some(model => model.position === icon.position));
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    await placement.begin('treasurechest');
    // The placer is not the chest: no icon until the build is committed.
    await settle();
    expect(icons()).toHaveLength(0);
    click();
    await settle();
    const [built] = icons();
    expect(built.icon).toBe('treasurechest.png');
    expect(built.position).toBe(world.scene.children[0].position);
    expect([built.position.x, built.position.z]).toEqual([3, 4]);
    const restored = await placement.spawnFromSave('treasurechest', {
      id: 'imported-chest',
      transform: { position: [-12, 0, 24], rotationY: 0 },
      components: { building: {}, container: { items: {} } },
    });
    await settle();
    expect(icons().map(({ position }) => [position.x, position.z])).toEqual([
      [3, 4],
      [-12, 24],
    ]);
    expect(prefabInstance(restored)!.hasTag('chest')).toBe(true);
    prefabInstance(world.scene.children[0])!.remove();
    await settle();
    expect(built.enabled).toBe(false);
    expect(icons().map(({ position }) => position)).toEqual([restored.position]);
    const [kept] = icons();
    placement.dispose();
    await settle();
    expect(kept.enabled).toBe(false);
    expect(miniMapEntities().has(kept)).toBe(false);
  } finally {
    placement.dispose();
  }
});

it('binds a committed building collider at its foot, restores it from saves and removes it with the entity', async () => {
  const { placement, world, consume, click } = await setup(definitions.animatedBuildings.cookpot);
  const physics = world.physics!;
  try {
    await placement.begin('cookpot');
    expect(physics.bodies).toHaveLength(0);
    consume.mockReturnValue(false);
    click();
    expect(physics.bodies).toHaveLength(0);
    consume.mockReturnValue(true);
    await placement.begin('cookpot');
    click();
    expect(physics.bodies).toHaveLength(1);
    const record = placement.exportRecords().find(({ prefabId }) => prefabId === 'cookpot')!.record;
    const body = physics.bodies[0];
    expect(body.position.toArray()).toEqual([3, WORLD_SCALE, 4]);
    // MakeObstaclePhysics(inst, .5).
    expect(body.shapes.some(shape => shape instanceof CANNON.Sphere && shape.radius === 0.5 * WORLD_SCALE)).toBe(true);
    await placement.spawnFromSave('cookpot', { ...record, id: 'restored-building' });
    expect(physics.bodies).toHaveLength(2);
    expect(physics.bodies[1].position.toArray()).toEqual(body.position.toArray());
    placement.dispose();
    expect(physics.bodies).toHaveLength(0);
  } finally {
    placement.dispose();
  }
});
