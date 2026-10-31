import { prefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpriteAnimationController } from '../src/sprite';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { RummageActionController, RUMMAGE_REACH } from '../../stategraphs/src/rummage';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import type { ActionAnimationController } from '../../stategraphs/src/actionContext';
import { getActionString } from '../../stategraphs/src/actions';
import { TREASURE_CHEST_DEFINITION } from '../../prefab/src/treasurechest';
import { COOK_POT_DEFINITION } from '../../prefab/src/cook_pot';
import type { WorldContext } from '../../prefab/src/worldContext';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindTestWorld } from './worldContentFixture';

let unbindWorld: (() => void) | undefined;
afterEach(() => {
  unbindWorld?.();
  unbindWorld = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup(definition = TREASURE_CHEST_DEFINITION, id = 'treasurechest') {
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
  const { playerpositions, unbind } = bindTestWorld(new GameTimeScheduler());
  unbindWorld = unbind;
  const base = { scene, player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(), renderer: { domElement: canvas } };
  const mouseActions = new PlayerActionPicker(new PointerRaycaster(base as never));
  const world = { ...base, mouseActions } as unknown as WorldContext;
  const changes = vi.fn();
  const placement = new AnimatedBuildingPlacement(world, { [id]: definition }, () => true, changes);
  placement.spawn(id);
  const model = scene.children[0];
  const animation = prefabInstance(model)!.sprite as SpriteAnimationController;
  // Opening and closing clips play out only once the display has drawn the building.
  await vi.waitFor(() => expect(prefabInstance(model)!.sprite.loaded).toBe(true));
  const playOnce = vi.spyOn(animation, 'playOnce');
  const start = vi.spyOn(animation, 'start');
  vi.spyOn(PointerRaycaster.prototype, 'pickMouseTarget').mockImplementation(() =>
    ({ object: model, point: new THREE.Vector3() }) as THREE.Intersection);
  const stategraph = new WilsonStateGraph({ playAnimation: () => .2, playSound() {}, setCasting() {}, onStateChanged() {} });
  const locomotor = { destination: undefined as THREE.Vector3 | undefined, goToPoint: vi.fn(() => true), stop: vi.fn() };
  const rummage = new RummageActionController(world, { stategraph, cancelEmote() {}, setFacing() {} } as unknown as ActionAnimationController,
    locomotor);
  // The world publishes player snapshots; proximity effects run after the microtask.
  const distance = async (value: number) => {
    player.position.copy(model.position).add(new THREE.Vector3(value, 0, 0));
    playerpositions.set([player.position.clone()]);
    await Promise.resolve();
  };
  const click = () => canvas.dispatchEvent(Object.assign(new Event('pointerdown', { cancelable: true }), {
    button: 0, clientX: 0, clientY: 0,
  }));
  /** LMB RUMMAGE: the controller buffers it in reach and doshortaction performs it on frame 6. */
  const act = () => { click(); rummage.update(); stategraph.update(1); };
  const finish = () => {
    for (let frame = 0; frame < 50; frame++) placement.update(0.1);
  };
  return { placement, model, changes, playOnce, start, distance, click, act, finish, rummage, locomotor, mouseActions };
}

describe('building RUMMAGE and proximity', () => {
  it('opens the cook pot immediately, loops its animation and closes on RUMMAGE or leaving', async () => {
    const { placement, distance, act, finish, changes, model, start, mouseActions } = await setup(COOK_POT_DEFINITION, 'cookpot');
    await distance(0);
    expect(getActionString(mouseActions.getMouseActions().left!)).toBe('打开');
    act();
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'cookpot', isOpen: true, model });
    expect(start).toHaveBeenLastCalledWith('cooking_pre_loop');
    expect(placement.exportRecords()[0].record.components.building?.state).toBe('open');
    // actions.lua RUMMAGE.strfn: the doer's open container offers CLOSE.
    expect(getActionString(mouseActions.getMouseActions().left!)).toBe('关闭');
    finish();
    act();
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'cookpot', isOpen: false, model });
    finish();
    expect(start).toHaveBeenLastCalledWith('idle_empty');
    act();
    await distance(11);
    finish();
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'cookpot', isOpen: false, model });
    expect(start).toHaveBeenLastCalledWith('idle_empty');
  });

  it('walks a distant player into reach before the chest opens', async () => {
    const { distance, act, rummage, locomotor, playOnce, finish, changes, model } = await setup();
    await distance(9);
    act();
    expect(locomotor.goToPoint).toHaveBeenCalledWith(model.position.clone().add(new THREE.Vector3(RUMMAGE_REACH * .8, 0, 0)));
    expect(playOnce).not.toHaveBeenCalled();
    finish();
    expect(changes).not.toHaveBeenCalled();
    await distance(RUMMAGE_REACH);
    rummage.update();
    act();
    expect(playOnce).toHaveBeenCalledWith('open', expect.any(Function));
    finish();
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'treasurechest', isOpen: true, model });
  });

  it('keeps an open chest nearby through 10 units, then closes it and its panel', async () => {
    const { distance, act, playOnce, start, finish, changes, model } = await setup();
    await distance(0);
    act();
    finish();
    await distance(10);
    expect(changes).toHaveBeenCalledTimes(1);
    await distance(10.01);
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'treasurechest', isOpen: false, model });
    expect(playOnce).toHaveBeenLastCalledWith('close', expect.any(Function));
    finish();
    expect(start).toHaveBeenLastCalledWith('closed');
    await distance(0);
    act();
    finish();
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'treasurechest', isOpen: true, model });
  });

  it('cancels opening when the player leaves before the animation finishes', async () => {
    const { distance, act, playOnce, start, finish, changes, model } = await setup();
    await distance(0);
    act();
    await distance(11);
    finish();
    expect(playOnce.mock.calls.map(([name]) => name)).toEqual(['open', 'close']);
    expect(changes.mock.calls).toEqual([[{ buildId: 'treasurechest', isOpen: false, model }]]);
    expect(start).toHaveBeenLastCalledWith('closed');
  });

  it('leaves a click to the build placer instead of rummaging under it', async () => {
    const { placement, distance, act, playOnce, mouseActions } = await setup();
    await distance(0);
    // The pointer is off the ground, so the placer neither shows nor builds.
    vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(undefined);
    vi.spyOn(PointerRaycaster.prototype, 'isOverGround', 'get').mockReturnValue(false);
    placement.begin('treasurechest');
    expect(mouseActions.getMouseActions(Object.assign(new Event('pointerdown'), { button: 0 }) as PointerEvent)).toEqual({});
    act();
    expect(playOnce).not.toHaveBeenCalledWith('open', expect.any(Function));
    placement.cancel();
    act();
    expect(playOnce).toHaveBeenCalledWith('open', expect.any(Function));
  });
});
