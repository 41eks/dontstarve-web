import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpriteAnimationController } from '../src/sprite';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { PointerRaycaster } from '../../prefab/src/pointerRaycaster';
import { RESEARCH_LAB_DEFINITIONS, RESEARCH_LAB_IDS } from '../../prefab/src/scienceprototyper';
import { TREASURE_CHEST_DEFINITION } from '../../prefab/src/treasurechest';
import { COOK_POT_DEFINITION } from '../../prefab/src/cook_pot';
import { ICE_BOX_DEFINITION } from '../../prefab/src/icebox';
import type { WorldContext } from '../../prefab/src/worldContext';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup(definition = TREASURE_CHEST_DEFINITION) {
  const bytes = await readFile(new URL(`../../../public/dst/data/anim/${definition.archive}`, import.meta.url));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', {
    createElement: () => ({ setAttribute: vi.fn(), style: {} }),
    body: { appendChild: vi.fn() },
  });
  const canvas = new EventTarget();
  const scene = new THREE.Scene();
  const player = new THREE.Object3D();
  const world = {
    scene,
    player,
    camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(),
    renderer: { domElement: canvas },
  } as unknown as WorldContext;
  const changes = vi.fn();
  const placement = new AnimatedBuildingPlacement(world, { building: definition }, () => true, changes);
  await placement.spawn('building');
  const model = scene.children[0];
  const animation = model.userData.animationController as SpriteAnimationController;
  const playOnce = vi.spyOn(animation, 'playOnce');
  const start = vi.spyOn(animation, 'start');
  vi.spyOn(PointerRaycaster.prototype, 'raycastPointer').mockImplementation((objects) =>
    ({ object: objects[0], point: new THREE.Vector3() }) as THREE.Intersection,
  );
  const distance = (value: number) => {
    player.position.copy(model.position).add(new THREE.Vector3(value, 100, 0));
  };
  const click = () => canvas.dispatchEvent(Object.assign(new Event('pointerdown'), {
    button: 0, clientX: 0, clientY: 0,
  }));
  const finish = () => {
    for (let frame = 0; frame < 50; frame++) placement.update(0.1);
  };
  return { placement, model, changes, playOnce, start, distance, click, finish };
}

describe('building proximity interactions', () => {
  it('opens the cook pot immediately, loops its animation and closes on click or leaving', async () => {
    const { placement, distance, click, finish, changes, model, start } = await setup(COOK_POT_DEFINITION);
    distance(11);
    click();
    expect(changes).not.toHaveBeenCalled();
    distance(0);
    click();
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'building', isOpen: true, model });
    expect(start).toHaveBeenLastCalledWith('cooking_pre_loop');
    expect(placement.exportRecords()[0].record.components.building?.state).toBe('open');
    finish();
    click();
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'building', isOpen: false, model });
    finish();
    expect(start).toHaveBeenLastCalledWith('idle_empty');
    click();
    distance(11);
    finish();
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'building', isOpen: false, model });
    expect(start).toHaveBeenLastCalledWith('idle_empty');
  });
  it('blocks distant chest clicks and checks the current position on click', async () => {
    const { distance, click, playOnce, finish, changes, model } = await setup();
    distance(9.01);
    click();
    expect(playOnce).not.toHaveBeenCalled();
    distance(9);
    click();
    expect(playOnce).toHaveBeenCalledWith('open', expect.any(Function));
    finish();
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'building', isOpen: true, model });
  });

  it('keeps an open chest nearby through 10 units, then closes it and its panel', async () => {
    const { placement, distance, click, playOnce, start, finish, changes, model } = await setup();
    distance(9);
    click();
    finish();
    distance(10);
    placement.update(0);
    expect(changes).toHaveBeenCalledTimes(1);
    distance(10.01);
    placement.update(0);
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'building', isOpen: false, model });
    expect(playOnce).toHaveBeenLastCalledWith('close', expect.any(Function));
    finish();
    expect(start).toHaveBeenLastCalledWith('closed');
    click();
    expect(playOnce).toHaveBeenCalledTimes(2);
    distance(9);
    click();
    finish();
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'building', isOpen: true, model });
  });

  it('cancels opening when the player leaves before the animation finishes', async () => {
    const { placement, distance, click, playOnce, start, finish, changes, model } = await setup();
    distance(0);
    click();
    distance(11);
    placement.update(0.1);
    finish();
    expect(playOnce.mock.calls.map(([name]) => name)).toEqual(['open', 'close']);
    expect(changes.mock.calls).toEqual([[{ buildId: 'building', isOpen: false, model }]]);
    expect(start).toHaveBeenLastCalledWith('closed');
  });

  it.each(['researchlab4'] as const)('%s switches between proximity and idle animations', async (id) => {
    const definition = RESEARCH_LAB_DEFINITIONS[id];
    const onturnon = vi.fn(definition.onturnon!);
    const onturnoff = vi.fn(definition.onturnoff!);
    const { placement, distance, start, model } = await setup({ ...definition, onturnon, onturnoff });
    distance(9.01);
    placement.update(0);
    expect(onturnon).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    distance(9);
    placement.update(0);
    expect(onturnon).toHaveBeenCalledExactlyOnceWith({
      model, animation: model.userData.animationController, skinId: undefined,
    });
    expect(start).toHaveBeenLastCalledWith('proximity_loop');
    distance(10);
    placement.update(0);
    expect(onturnon).toHaveBeenCalledTimes(1);
    expect(onturnoff).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);
    distance(10.01);
    placement.update(0);
    placement.update(0);
    expect(onturnoff).toHaveBeenCalledExactlyOnceWith({
      model, animation: model.userData.animationController, skinId: undefined,
    });
    expect(start).toHaveBeenLastCalledWith('idle');
    expect(start).toHaveBeenCalledTimes(2);
    distance(9);
    placement.update(0);
    expect(onturnon).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenLastCalledWith('proximity_loop');
  });
});
