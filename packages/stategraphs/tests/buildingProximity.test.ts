import { wilsonPlayer } from '../../../tests/fixtures/wilsonPlayer';
import { withEntity } from '../../../tests/fixtures/entityFixture';
import { testPlayer } from '../../../tests/fixtures/testPlayer';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpriteAnimationController } from '../../animation/src/sprite';
import { PointerRaycaster } from '../src/pointerRaycaster';
import { PlayerActionPicker } from '../src/playeractionpicker';
import { PlayerController } from '../src/playercontroller';
import { Locomotor } from '../../prefab/src/locomotor';
import { WORLD_SCALE } from '../../prefab/src/tile';
import { createEquipmentExistenceState } from '../../signals/src';
import { getActionString } from '../src/actions';
import definitions from '../../prefab/src/definitions.json';
import { managedBuildings } from '../../../tests/fixtures/managedBuildings';
import type { WorldContext } from '../../prefab/src/worldContext';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindTestWorld } from '../../../tests/fixtures/worldContentFixture';

let unbindWorld: (() => void) | undefined;
afterEach(() => {
  unbindWorld?.();
  unbindWorld = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup(
  definition: { archive: string } = definitions.animatedBuildings.treasurechest,
  id: 'treasurechest' | 'cookpot' = 'treasurechest',
) {
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
  const scene = new THREE.Scene();
  const player = new THREE.Object3D();
  const { playerpositions, unbind } = bindTestWorld(new GameTimeScheduler());
  unbindWorld = unbind;
  const base = {
    scene,
    player,
    camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(),
    renderer: { domElement: canvas },
  };
  const mouseActions = new PlayerActionPicker(new PointerRaycaster(base as never));
  const world = { ...base, mouseActions } as unknown as WorldContext;
  const changes = vi.fn();
  const placement = managedBuildings(world, { onInteraction: changes });
  void placement.spawn(id);
  const model = scene.children[0];
  const animation = prefabInstance(model)!.sprite as SpriteAnimationController;
  // Opening and closing clips play out only once the display has drawn the building.
  await vi.waitFor(() => expect(prefabInstance(model)!.sprite.loaded).toBe(true));
  const playOnce = vi.spyOn(animation, 'playOnce');
  vi.spyOn(PointerRaycaster.prototype, 'pickMouseTarget').mockImplementation(
    () => ({ object: model, point: new THREE.Vector3() }) as THREE.Intersection,
  );
  mouseActions.pointer.updateHover();
  const stategraph = wilsonPlayer(() => 0.2).sg;
  const locomotor = new Locomotor(
    { position: player.position, velocity: new THREE.Vector3() },
    { physicsRadius: 0.5 * WORLD_SCALE },
  );
  // The player inst RUMMAGE opens the container for; SCENE.container needs its inventory.
  const doer = testPlayer({ model: withEntity(player, 'wilson') });
  const rummage = new PlayerController(
    world,
    stategraph,
    locomotor,
    createEquipmentExistenceState('HANDS'),
    doer,
    undefined,
    { placement: placement.placement },
  );
  // The world publishes player snapshots; proximity effects run after the microtask.
  const distance = async (value: number) => {
    player.position.copy(model.position).add(new THREE.Vector3(value, 0, 0));
    playerpositions.set([player.position.clone()]);
    await Promise.resolve();
  };
  const click = () => rummage.OnControl('PRIMARY', true, { clientX: 0, clientY: 0 });
  /** LMB RUMMAGE: the locomotor buffers it in reach and doshortaction performs it on frame 6. */
  const act = () => {
    click();
    locomotor.update(16, 1 / 30);
    stategraph.update(1);
  };
  const finish = () => {
    for (let frame = 0; frame < 50; frame++) {
      placement.update(0.1);
    }
  };
  return { placement, model, changes, playOnce, distance, click, act, finish, rummage, locomotor, mouseActions };
}

describe('building RUMMAGE and proximity', () => {
  it('opens the cook pot and its panel at once, and closes on RUMMAGE or leaving', async () => {
    const { placement, distance, act, finish, changes, model, playOnce, mouseActions } = await setup(
      definitions.animatedBuildings.cookpot,
      'cookpot',
    );
    await distance(0);
    expect(getActionString(mouseActions.getMouseActions().left!)).toBe('打开');
    act();
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'cookpot', isOpen: true, model });
    expect(playOnce).toHaveBeenLastCalledWith('cooking_pre_loop');
    // cookpot.lua OnSave has no open state: the pot reloads closed.
    expect(placement.exportRecords()[0].record.components.building).toEqual({});
    // actions.lua RUMMAGE.strfn: the doer's open container offers CLOSE.
    expect(getActionString(mouseActions.getMouseActions().left!)).toBe('关闭');
    finish();
    act();
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'cookpot', isOpen: false, model });
    finish();
    // onclose: PlayAnimation("idle_empty") rests on its last frame.
    expect(playOnce).toHaveBeenLastCalledWith('idle_empty');
    act();
    await distance(11);
    finish();
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'cookpot', isOpen: false, model });
    expect(playOnce).toHaveBeenLastCalledWith('idle_empty');
  });

  it('walks a distant player into reach before the chest opens', async () => {
    const { distance, act, locomotor, playOnce, finish, changes, model } = await setup();
    await distance(9);
    act();
    expect(locomotor.bufferedAction).toBeDefined();
    expect(playOnce).not.toHaveBeenCalled();
    finish();
    expect(changes).not.toHaveBeenCalled();
    // ARRIVE_STEP plus both physics radii: the chest has none, the player .5.
    await distance(1.5);
    act();
    expect(playOnce).toHaveBeenCalledWith('open');
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'treasurechest', isOpen: true, model });
  });

  it('keeps an open chest nearby through 9 units, then closes it and its panel', async () => {
    const { distance, act, playOnce, finish, changes, model } = await setup();
    await distance(0);
    act();
    finish();
    await distance(9);
    expect(changes).toHaveBeenCalledTimes(1);
    await distance(9.01);
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'treasurechest', isOpen: false, model });
    expect(playOnce).toHaveBeenLastCalledWith('close');
    finish();
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('closed');
    await distance(0);
    act();
    finish();
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'treasurechest', isOpen: true, model });
  });

  it('closes at once when the player leaves before the opening clip finishes', async () => {
    const { distance, act, playOnce, finish, changes, model } = await setup();
    await distance(0);
    act();
    await distance(11);
    finish();
    expect(playOnce.mock.calls.map(([name]) => name)).toEqual(['open', 'close']);
    expect(changes.mock.calls).toEqual([
      [{ buildId: 'treasurechest', isOpen: true, model }],
      [{ buildId: 'treasurechest', isOpen: false, model }],
    ]);
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('closed');
  });

  it('keeps a failed placement from rummaging or walking', async () => {
    const { placement, distance, act, playOnce, locomotor, rummage } = await setup();
    await distance(0);
    // The pointer is off the ground, so the placer neither shows nor builds.
    vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(undefined);
    vi.spyOn(PointerRaycaster.prototype, 'isOverGround', 'get').mockReturnValue(false);
    placement.begin('treasurechest');
    const walk = vi.spyOn(locomotor, 'goToPoint');
    act();
    expect(rummage.bufferedAction).toBeUndefined();
    expect(playOnce).not.toHaveBeenCalledWith('open');
    expect(walk).not.toHaveBeenCalled();
    expect(placement.placement.active).toBe(true);
    placement.cancel();
    act();
    expect(playOnce).toHaveBeenCalledWith('open');
  });
});
