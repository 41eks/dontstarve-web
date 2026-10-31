import { prefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { WARDROBE_DEFINITION } from '../../prefab/src/wardrobe';
import { WORLD_SCALE } from '../../prefab/src/tile';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import {
  AnimatedBuildingPlacement,
  type AnimatedBuildingBuiltContext,
  type AnimatedBuildingDefinition,
} from '../../prefab/src/animatedBuildingPlacement';
import { COOK_POT_DEFINITION } from '../../prefab/src/cook_pot';
import { TREASURE_CHEST_DEFINITION } from '../../prefab/src/treasurechest';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { modelHasTag } from '../../prefab/src/prefabInstance';
import { findActionEntity } from '../../prefab/src/actionEntity';
import { getRummageActions, performRummageAction, type RummageTarget } from '../../stategraphs/src/rummage';
import { miniMapEntities } from '../../map/src/minimapEntities';
import type { WorldContext } from '../../prefab/src/worldContext';
import type { SpriteAnimationController } from '../src/sprite';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup(definition: AnimatedBuildingDefinition, id = 'building') {
  const bytes = await readFile(new URL(`../../../public/dst/data/anim/${definition.archive}`, import.meta.url));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', {
    createElement: () => ({ setAttribute: vi.fn(), style: {} }),
    body: { appendChild: vi.fn() },
  });
  const canvas = new EventTarget();
  const world = {
    physics: new CANNON.World(), scene: new THREE.Scene(), player: new THREE.Object3D(), ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(), renderer: { domElement: canvas },
  } as unknown as WorldContext;
  world.player.position.set(100, 0, 100);
  const consume = vi.fn(() => true);
  const placement = new AnimatedBuildingPlacement(world, { [id]: definition }, consume);
  vi.spyOn(PointerRaycaster.prototype, 'trackPointer').mockImplementation(() => {});
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(new THREE.Vector3(3, 0, 4));
  const isOverGround = vi.spyOn(PointerRaycaster.prototype, 'isOverGround', 'get').mockReturnValue(true);
  vi.spyOn(PointerRaycaster.prototype, 'raycastPointer').mockImplementation((objects) =>
    ({ object: objects[0], point: new THREE.Vector3() }) as THREE.Intersection,
  );
  const click = () => canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0 }));
  return { placement, world, consume, isOverGround, click };
}

const buildings = [
  ['cookpot', COOK_POT_DEFINITION, 'idle_empty'],
] as const;

it.each(buildings)('%s runs its built animation only after a successful placement', async (_id, definition, idle) => {
  let playOnce: ReturnType<typeof vi.spyOn> | undefined;
  const onbuilt = vi.fn((context: AnimatedBuildingBuiltContext) => {
    playOnce = vi.spyOn(context.animation as SpriteAnimationController, 'playOnce');
    definition.onbuilt!(context);
  });
  const { placement, world, consume, isOverGround, click } = await setup({ ...definition, onbuilt });
  await placement.spawn('building');
  expect(onbuilt).not.toHaveBeenCalled();
  await placement.begin('building');
  const placerModel = world.scene.children[1], placer = prefabInstance(placerModel)!;
  // MakePlacer: its own non-persisting entity, declaring a looping clip, SetLightOverride(1) and the placer tags.
  expect(placer.prefab).toBe('building_placer');
  expect(placer.persists).toBe(false);
  for (const tag of ['CLASSIFIED', 'NOCLICK', 'placer']) expect(placer.hasTag(tag)).toBe(true);
  expect(placer.sprite.sprite.peek()).toMatchObject({ clip: { name: idle, loop: true }, lightOverride: 1, opacity: .65, visible: true });
  expect(placer.position.toArray()).toEqual([3, 0, 4]);
  expect(onbuilt).not.toHaveBeenCalled();

  isOverGround.mockReturnValue(false);
  click();
  expect(consume).not.toHaveBeenCalled();
  isOverGround.mockReturnValue(true);
  consume.mockReturnValue(false);
  click();
  expect(onbuilt).not.toHaveBeenCalled();
  expect(placement.exportRecords()).toHaveLength(1);

  consume.mockReturnValue(true);
  click();
  expect(onbuilt).toHaveBeenCalledTimes(1);
  // The build spawns the building itself and releases the placer.
  const { model, animation } = onbuilt.mock.calls[0][0];
  expect(model).not.toBe(placerModel);
  expect(placer.status.peek()).toBe('removed');
  expect(placerModel.parent).toBeNull();
  expect(prefabInstance(model)!.prefab).toBe('building');
  expect(playOnce).toHaveBeenCalledExactlyOnceWith('place', expect.any(Function));
  expect(prefabInstance(model)!.sprite.sprite.peek().lightOverride).toBeUndefined();
  expect(placement.exportRecords()[1].record.transform.position).toEqual([3, 0, 4]);
  for (let frame = 0; frame < 100; frame++) placement.update(0.1);
  expect(animation.sprite.peek().clip).toMatchObject({ name: idle, loop: true });

  await placement.spawnFromSave('building', placement.exportRecords()[1].record);
  await placement.begin('building');
  placement.cancel();
  expect(onbuilt).toHaveBeenCalledTimes(1);
});

it('lets a prefab control built effects and keeps interaction blocked until it completes', async () => {
  let context: AnimatedBuildingBuiltContext;
  const onbuilt = vi.fn((built: AnimatedBuildingBuiltContext) => { context = built; });
  // A storage building's real ID gives it its container.
  const { placement, world, click } = await setup({ ...TREASURE_CHEST_DEFINITION, onProximity: false, onbuilt }, 'treasurechest');
  await placement.begin('treasurechest');
  click();
  const playOnce = vi.spyOn(context!.animation as SpriteAnimationController, 'playOnce');
  const { model } = context!, chest = findActionEntity(model) as unknown as RummageTarget;
  // While the place clip runs, its container cannot be opened, so RUMMAGE is neither offered nor performed.
  expect(getRummageActions(model, world.player)).toEqual([]);
  expect(performRummageAction(chest, world.player)).toBe(false);
  placement.update(0.1);
  expect(onbuilt).toHaveBeenCalledTimes(1);
  expect(playOnce).not.toHaveBeenCalled();

  context!.onComplete();
  expect(getRummageActions(model, world.player).map(({ action }) => action.action)).toEqual(['RUMMAGE']);
  expect(performRummageAction(chest, world.player)).toBe(true);
  expect(playOnce).toHaveBeenCalledExactlyOnceWith('open', expect.any(Function));
});


it('gives placed and restored chests a map icon at their foot and releases it with the entity', async () => {
  const { placement, world, click } = await setup({ ...TREASURE_CHEST_DEFINITION, onbuilt: undefined });
  const icons = () => [...miniMapEntities()].filter(icon => world.scene.children.some(model => model.position === icon.position));
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    await placement.begin('building');
    // The placer is not the chest: no icon until the build is committed.
    await settle(); expect(icons()).toHaveLength(0);
    click(); await settle();
    const [built] = icons();
    expect(built.icon).toBe('treasurechest.png');
    expect(built.position).toBe(world.scene.children[0].position);
    expect([built.position.x, built.position.z]).toEqual([3, 4]);
    const restored = await placement.spawnFromSave('building', {
      id: 'imported-chest', transform: { position: [-12, 0, 24], rotationY: 0 },
      components: { building: { state: 'closed' }, container: { slotCount: 9, slots: [] } } });
    await settle();
    expect(icons().map(({ position }) => [position.x, position.z])).toEqual([[3, 4], [-12, 24]]);
    expect(modelHasTag(restored, 'chest')).toBe(true);
    expect(placement.getSpellTargets(world.scene.children[0])[0].removeOne()).toBe(true);
    await settle();
    expect(built.enabled).toBe(false);
    expect(icons().map(({ position }) => position)).toEqual([restored.position]);
    const [kept] = icons();
    placement.dispose(); await settle();
    expect(kept.enabled).toBe(false);
    expect(miniMapEntities().has(kept)).toBe(false);
  } finally { placement.dispose(); }
});

it('binds a committed building collider at its foot, restores it from saves and removes it with the entity', async () => {
  const { placement, world, consume, click } = await setup(WARDROBE_DEFINITION);
  const physics = world.physics!;
  try {
    await placement.begin('building');
    expect(physics.bodies).toHaveLength(0);
    consume.mockReturnValue(false); click();
    expect(physics.bodies).toHaveLength(0);
    consume.mockReturnValue(true); click();
    expect(physics.bodies).toHaveLength(1);
    const record = placement.exportRecords()[0].record;
    const body = physics.bodies[0];
    expect(body.position.toArray()).toEqual([3, WORLD_SCALE, 4]);
    expect(body.shapes.some(shape => shape instanceof CANNON.Sphere && shape.radius === .75 * WORLD_SCALE)).toBe(true);
    await placement.spawnFromSave('building', { ...record, id: 'restored-building' });
    expect(physics.bodies).toHaveLength(2);
    expect(physics.bodies[1].position.toArray()).toEqual(body.position.toArray());
    placement.dispose();
    expect(physics.bodies).toHaveLength(0);
  } finally { placement.dispose(); }
});
