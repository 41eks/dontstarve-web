import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import {
  AnimatedBuildingPlacement,
  type AnimatedBuildingBuiltContext,
  type AnimatedBuildingDefinition,
} from '../../prefab/src/animatedBuildingPlacement';
import { COOK_POT_DEFINITION } from '../../prefab/src/cook_pot';
import { TREASURE_CHEST_DEFINITION } from '../../prefab/src/treasurechest';
import { PointerRaycaster } from '../../prefab/src/pointerRaycaster';
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
    scene: new THREE.Scene(), player: new THREE.Object3D(), ground: new THREE.Group(),
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
