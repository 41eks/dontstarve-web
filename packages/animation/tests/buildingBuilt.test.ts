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
import { miniMapEntities } from '../../map/src/minimapEntities';
import type { WorldContext } from '../../prefab/src/worldContext';
import type { SpriteAnimationController } from '../src/sprite';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup(definition: AnimatedBuildingDefinition) {
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
  const placement = new AnimatedBuildingPlacement(world, { building: definition }, consume);
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
  const onbuilt = vi.fn(definition.onbuilt!);
  const { placement, world, consume, isOverGround, click } = await setup({ ...definition, onbuilt });
  await placement.spawn('building');
  expect(onbuilt).not.toHaveBeenCalled();
  await placement.begin('building');
  const model = world.scene.children[1];
  const animation = model.userData.animationController as SpriteAnimationController;
  const playOnce = vi.spyOn(animation, 'playOnce');
  const start = vi.spyOn(animation, 'start');
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
  expect(onbuilt.mock.calls[0][0]).toMatchObject({ model, animation });
  expect(playOnce).toHaveBeenCalledExactlyOnceWith('place', expect.any(Function));
  expect(placement.exportRecords()[1].record.transform.position).toEqual([3, 0, 4]);
  for (let frame = 0; frame < 100; frame++) placement.update(0.1);
  expect(start).toHaveBeenLastCalledWith(idle);

  await placement.spawnFromSave('building', placement.exportRecords()[1].record);
  await placement.begin('building');
  placement.cancel();
  expect(onbuilt).toHaveBeenCalledTimes(1);
});

it('lets a prefab control built effects and keeps interaction blocked until it completes', async () => {
  let context: AnimatedBuildingBuiltContext;
  const onbuilt = vi.fn((built: AnimatedBuildingBuiltContext) => { context = built; });
  const { placement, world, click } = await setup({ ...TREASURE_CHEST_DEFINITION, onProximity: false, onbuilt });
  await placement.begin('building');
  const animation = world.scene.children[0].userData.animationController as SpriteAnimationController;
  const playOnce = vi.spyOn(animation, 'playOnce');
  click();
  click();
  placement.update(0.1);
  expect(onbuilt).toHaveBeenCalledTimes(1);
  expect(playOnce).not.toHaveBeenCalled();

  context!.onComplete();
  click();
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
