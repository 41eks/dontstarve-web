import { playerDoer } from './playerDoer';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter, createEquipmentExistenceState } from '../../signals/src';
import { Workable, type WorkAction } from '../../componets/src/workable';
import { createEmptyEntity } from '../../prefab/src/prefabInstance';
import { actionEntity } from '../../prefab/src/actionEntity';
import { Locomotor } from '../../prefab/src/locomotor';
import { RockManager } from '../../prefab/src/rocks';
import { WORLD_SCALE } from '../../prefab/src/tile';
import { PlaySound } from '../../prefab/src/sound';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { collectEquippedItemActions } from '../../stategraphs/src/componentactions';
import { PlayerActionFilter, getActionString, isGhostValidAction } from '../../stategraphs/src/actions';
import { Hauntable } from '../../componets/src/hauntable';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';
import type { PlayerActionEvents } from '../../stategraphs/src/actionEvents';
import { equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { updateMovement } from '../../../src/updatePlayerMovement';
import { FIXED_TIMESTEP, MAX_SUBSTEPS } from '../../../src/physicsTiming';
import type { PlayerBody } from '../../../src/types/Player';
import { actionTool, netEntity } from './actionFixtures';
import { bufferingPerformer } from './bufferingPerformer';
import { createPickupInventory } from './pickupFixture';
import { wilsonPlayerInstance, createWilsonPlayer, type WilsonAnimationController } from './playerVisual';
import { workTargets } from './workTargets';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {}, setVolume() {} })) }));
vi.mock('../../../src/InputManager', () => ({ input: { isPressed: () => false, isManualMovement: () => false, isActionInterrupting: () => false } }));

beforeEach(() => vi.stubGlobal('window', new EventTarget()));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

/** A player with a picker, a real locomotor on the player's own position and a buffering stategraph. */
function setup(tool: Parameters<typeof actionTool>[0]) {
  const scene = new THREE.Scene(), player = new THREE.Group(), canvas = new EventTarget();
  const actionEvents = new EventEmitter<PlayerActionEvents>();
  const world = { player, scene, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: canvas }, actionEvents } as unknown as ActionWorldContext;
  world.mouseActions = new PlayerActionPicker(new PointerRaycaster(world));
  const body = { position: player.position, velocity: new THREE.Vector3() } as unknown as CANNON.Body;
  const locomotor = new Locomotor(body, { physicsRadius: .5 * WORLD_SCALE });
  const hand = createEquipmentExistenceState('HANDS');
  const equipped = actionTool(tool);
  hand.set(equipped);
  const animation = bufferingPerformer();
  let manual = false;
  const controller = new PlayerController(world, animation.performer, locomotor, hand, playerDoer(player), () => manual);
  vi.spyOn(PointerRaycaster.prototype, 'trackPointer').mockImplementation(() => {});
  const pick = vi.spyOn(PointerRaycaster.prototype, 'pickMouseTarget');
  const created: { remove(): void }[] = [];
  const target = (prefab: string, action: WorkAction, position: THREE.Vector3) => {
    const { instance, display } = createEmptyEntity(prefab);
    created.push(instance);
    display.mount(scene);
    instance.position.copy(position);
    const workable = new Workable(instance);
    workable.SetWorkAction(action);
    workable.SetWorkLeft(3);
    instance.components.workable = workable;
    const entity = actionEntity(display.model, prefab, instance);
    pick.mockReturnValue({ object: display.model } as unknown as THREE.Intersection);
    return { instance, display, entity, workable };
  };
  const click = (button: 0 | 2) => {
    const event = Object.assign(new Event('pointerdown', { cancelable: true }), { button });
    canvas.dispatchEvent(event);
    return event;
  };
  return { world, player, locomotor, hand, equipped, animation, controller, target, click, actionEvents,
    moveManually: () => { manual = true; },
    dispose: () => { controller.dispose(); world.mouseActions!.dispose(); created.forEach(instance => instance.remove()); } };
}

describe('PlayerController', () => {
  it('buffers the picked equipped action, walks into the arrive distance and works the target at the hit frame', () => {
    const s = setup('pickaxe');
    try {
      const rock = s.target('rock1', 'MINE', new THREE.Vector3(10, 0, 0));
      // componentactions tool: MINE on the left button; the right button repeats it, so the picker keeps only one.
      expect(s.world.mouseActions!.getMouseActions()).toMatchObject({ left: { action: 'MINE', target: rock.entity, invobject: s.equipped.entity } });
      expect(s.world.mouseActions!.getMouseActions().right).toBeUndefined();
      expect(s.click(0).defaultPrevented).toBe(true);
      expect(s.controller.bufferedAction).toMatchObject({ action: 'MINE', target: rock.entity, invobject: s.equipped.entity });
      expect(s.locomotor.bufferedAction).toBeDefined();
      expect(s.animation.stategraph.pushBufferedAction).not.toHaveBeenCalled();
      // ARRIVE_STEP plus both physics radii: the target has none, the player .5.
      s.player.position.x = 10 - 2.1; s.locomotor.update(16, 1 / 30);
      expect(s.animation.stategraph.pushBufferedAction).not.toHaveBeenCalled();
      s.player.position.x = 10 - 1.9; s.locomotor.update(16, 1 / 30);
      expect(s.animation.stategraph.pushBufferedAction).toHaveBeenCalledOnce();
      expect(s.animation.setFacing).toHaveBeenCalled();
      expect(s.locomotor.bufferedAction).toBeUndefined();
      expect(s.equipped.entity.components.finiteuses.remaining).toBeUndefined();
      expect(s.animation.hit()).toBe(true);
      expect(rock.workable.GetWorkLeft()).toBe(2);
      expect(s.equipped.entity.components.finiteuses.remaining).toBeLessThan(33);
      // Another click is another action: it drops the buffered MINE.
      pickNothing();
      s.click(0);
      expect(s.animation.stategraph.cancelAction).toHaveBeenCalledWith('MINE');
      expect(s.controller.bufferedAction).toBeUndefined();
    } finally { s.dispose(); }
  });

  it('takes HAMMER only on the right button and DIG only as an rmb action', () => {
    const s = setup('hammer');
    try {
      const wall = s.target('wall_stone', 'HAMMER', new THREE.Vector3(1, 0, 0));
      expect(s.world.mouseActions!.getMouseActions()).toEqual({ right: expect.objectContaining({ action: 'HAMMER', target: wall.entity }) });
      expect(s.click(0).defaultPrevented).toBe(false);
      expect(s.click(2).defaultPrevented).toBe(true);
      expect(s.animation.last).toMatchObject({ action: 'HAMMER', invobject: s.equipped.entity });
      const shovel = actionTool('shovel').entity, plant = s.target('grass', 'DIG', new THREE.Vector3(1, 0, 0)).entity;
      expect(collectEquippedItemActions(shovel, undefined, plant, false)).toEqual([]);
      expect(collectEquippedItemActions(shovel, undefined, plant, true)).toEqual(['DIG']);
    } finally { s.dispose(); }
  });

  it.each(['manual movement', 'Escape', 'another action', 'an unequipped tool', 'an invalid target'] as const)(
    'drops the walked-to action on %s', (reason) => {
      const s = setup('pickaxe');
      try {
        const rock = s.target('rock1', 'MINE', new THREE.Vector3(10, 0, 0));
        s.click(0);
        expect(s.locomotor.bufferedAction).toBeDefined();
        if (reason === 'manual movement') { s.moveManually(); s.controller.update(); }
        if (reason === 'Escape') window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Escape' }));
        if (reason === 'another action') s.actionEvents.emit('action:begin', { owner: {}, action: 'PICK' });
        if (reason === 'an unequipped tool') s.hand.set(null);
        if (reason === 'an invalid target') { rock.workable.SetWorkable(false); s.locomotor.update(16, 1 / 30); }
        expect(s.controller.bufferedAction).toBeUndefined();
        expect(s.locomotor.bufferedAction).toBeUndefined();
        s.player.position.x = 9; s.locomotor.update(16, 1 / 30);
        expect(s.animation.stategraph.pushBufferedAction).not.toHaveBeenCalled();
      } finally { s.dispose(); }
    });
});

describe('PlayerController scene actions', () => {
  it('keeps ghost-exclusive HAUNT from the living, offers it to a ghost and walks to its mindistance', () => {
    const s = setup('pickaxe');
    const scheduler = new GameTimeScheduler();
    try {
      s.hand.set(null);
      const { instance, display } = createEmptyEntity('pighouse');
      display.mount(s.world.scene);
      instance.position.set(10, 0, 0);
      const hauntable = new Hauntable(instance, scheduler);
      const haunted = vi.fn(() => true);
      hauntable.SetOnHauntFn(haunted);
      instance.components.hauntable = hauntable;
      const entity = actionEntity(display.model, 'pighouse', instance);
      vi.mocked(PointerRaycaster.prototype.pickMouseTarget).mockReturnValue({ object: display.model } as unknown as THREE.Intersection);
      const picker = s.world.mouseActions!;
      // player_common.lua PlayerActionFilter (default priority) and the ghost's GhostActionFilter above it.
      picker.PushActionFilter(PlayerActionFilter, -99);
      expect(picker.getMouseActions().left).toBeUndefined();
      picker.PushActionFilter(isGhostValidAction, 99);
      expect(picker.getMouseActions().left).toMatchObject({ action: 'HAUNT', target: entity });
      expect(s.click(0).defaultPrevented).toBe(true);
      // mindistance = 2 outweighs ARRIVE_STEP plus the player's .5 radius.
      s.player.position.x = 10 - 2.1 * WORLD_SCALE; s.locomotor.update(16, 1 / 30);
      expect(s.animation.stategraph.pushBufferedAction).not.toHaveBeenCalled();
      s.player.position.x = 10 - 1.9 * WORLD_SCALE; s.locomotor.update(16, 1 / 30);
      expect(s.animation.last).toMatchObject({ action: 'HAUNT', target: entity });
      expect(s.animation.hit()).toBe(true);
      expect(haunted).toHaveBeenCalledOnce();
      picker.PopActionFilter(isGhostValidAction);
      expect(picker.getMouseActions().left).toBeUndefined();
      instance.remove();
    } finally { s.dispose(); scheduler.dispose(); }
  });
});

describe('PlayerController equipped actions', () => {
  it('offers ATTACK (RANGEDLIGHT) on the right button for a weapon that can light the target', () => {
    const weapon = { prefab: 'firestaff', isRemoved: false, hasTag: () => false, components: { weapon: {} } } as never;
    const target = { prefab: 'evergreen', isRemoved: false, hasTag: () => false, components: {} };
    const canLight = vi.fn((_target: unknown, _weapon: unknown) => true);
    const doer = { hasTag: () => false, components: { combat: { CanLightTarget: canLight } } };
    // componentactions EQUIPPED.weapon: combat:CanLightTarget on the right button only.
    expect(collectEquippedItemActions(weapon, doer as never, target, false)).toEqual([]);
    expect(collectEquippedItemActions(weapon, doer as never, target, true)).toEqual(['ATTACK']);
    expect(canLight).toHaveBeenLastCalledWith(target, (weapon as { components: { weapon: object } }).components.weapon);
    expect(getActionString({ action: 'ATTACK', doer, invobject: weapon, target: target as never })).toBe('点燃');
    canLight.mockReturnValue(false);
    expect(collectEquippedItemActions(weapon, doer as never, target, true)).toEqual([]);
    expect(getActionString({ action: 'ATTACK', doer, invobject: weapon, target: target as never })).toBe('攻击');
  });
});

function pickNothing() {
  vi.mocked(PointerRaycaster.prototype.pickMouseTarget).mockReturnValue(undefined as never);
}

describe('PlayerController with the Wilson stategraph', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  });

  it('commits mining at frame seven and preserves durability when cancelled, finished elsewhere or unequipped', async () => {
    const player = await createWilsonPlayer('/dst/data/anim');
    const animation = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
    await animation.setCarryItem('goldenpickaxe');
    const inventory = createPickupInventory();
    inventory.add('goldenpickaxe', 1);
    inventory.transfer(inventorySlotAddress(0), equipmentSlotAddress('hand'), 1);
    const tool = inventory.getEntity(equipmentSlotAddress('hand'))!;
    const scene = new THREE.Scene();
    const loot = vi.fn(() => undefined);
    const rocks = new RockManager(scene, '/dst/data/anim', { spawnGroundItem: loot });
    const world = { player, scene, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
      renderer: { domElement: new EventTarget() } } as unknown as ActionWorldContext;
    const locomotor = new Locomotor({ position: player.position, velocity: new THREE.Vector3() } as unknown as CANNON.Body);
    const controller = new PlayerController(world, animation, locomotor, inventory.handEquipment, playerDoer(player));
    const advance = (frames: number) => { for (let i = 0; i < frames; i++) animation.update(1 / 30); };
    const mine = () => controller.createAction({ action: 'MINE', target: workTargets('MINE')[0].entity, invobject: tool })!;
    const begin = () => {
      expect(controller.DoAction(mine())).toBe(true);
      while (animation.stategraph.stateName === 'mine_start') animation.update(1 / 30);
    };
    try {
      await rocks.spawn('rock_flintless_low', new THREE.Vector3(1, 0, 0));
      player.position.set(0, 0, 15);
      expect(controller.DoAction(mine())).toBe(true);
      expect(locomotor.destination).toBeDefined();
      player.position.set(1, 0, 3); locomotor.update(16, 1 / 30);
      expect(animation.stategraph.stateName).toBe('mine_start');
      while (animation.stategraph.stateName === 'mine_start') animation.update(1 / 30);
      advance(6);
      expect(tool.components.finiteuses.remaining).toBeUndefined();
      expect(workTargets('MINE')[0].entity.components.workable!.GetWorkLeft()).toBe(2);
      advance(1);
      expect(tool.components.finiteuses.remaining).toBe(32.75);
      expect(workTargets('MINE')[0].entity.components.workable!.GetWorkLeft()).toBe(1);
      expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/use_pick_rock');
      advance(60);
      begin(); advance(6); controller.cancel(); advance(60);
      expect(tool.components.finiteuses.remaining).toBe(32.75);
      begin(); advance(6);
      // Another worker completes this boulder before the buffered action lands.
      vi.spyOn(Math, 'random').mockReturnValue(.9);
      expect(workTargets('MINE')[0].work()).toBe(true);
      advance(60);
      expect(tool.components.finiteuses.remaining).toBe(32.75);
      expect(workTargets('MINE')).toEqual([]);
      expect(rocks.exportRecords()).toEqual([]);
      expect(loot).toHaveBeenCalledTimes(2);
      await rocks.spawn('rock1', new THREE.Vector3(1, 0, 0));
      begin(); advance(6); inventory.transfer(equipmentSlotAddress('hand'), inventorySlotAddress(0), 1); advance(60);
      expect(tool.components.finiteuses.remaining).toBe(32.75);
      expect(workTargets('MINE')[0].entity.components.workable!.GetWorkLeft()).toBe(6);
    } finally { controller.dispose(); rocks.dispose(); inventory.dispose(); }
  });

  it('follows a moving butterfly through slow frames and nets it at the swing', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const file = new URL(String(url), 'https://test.invalid').pathname.split('/anim/').at(-1)!;
      return new Response(await readFile(new URL(`../../../public/dst/data/anim/${file}`, import.meta.url)));
    });
    const player = await createWilsonPlayer('/anim');
    const animation = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
    await animation.setCarryItem('bugnet');
    const body = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(0.5), linearDamping: 0 }) as PlayerBody;
    body.position.y = 0.5;
    body.canJump = true;
    const physics = new CANNON.World();
    physics.addBody(body);
    const locomotor = new Locomotor(body, { physicsRadius: .5 * WORLD_SCALE });
    const camera = new THREE.PerspectiveCamera();
    const world = { player, camera, ground: new THREE.Group(), renderer: { domElement: new EventTarget() } } as unknown as ActionWorldContext;
    const captured = vi.fn();
    const butterfly = netEntity(captured);
    butterfly.transform.position.set(8, 0, 0);
    const hand = createEquipmentExistenceState('HANDS');
    const net = actionTool('bugnet');
    hand.set(net);
    const controller = new PlayerController(world, animation, locomotor, hand, playerDoer(player));
    const move = updateMovement(camera, player, body, locomotor);
    try {
      expect(controller.DoAction(controller.createAction({ action: 'NET', target: butterfly, invobject: net.entity })!)).toBe(true);
      for (let frame = 0; frame < 100 && !captured.mock.calls.length; frame++) {
        move(16, 0.5);
        animation.update(0.5);
        physics.step(FIXED_TIMESTEP, 0.5, MAX_SUBSTEPS);
        butterfly.transform.position.x += 4 * 0.1;
      }
      expect(captured).toHaveBeenCalledOnce();
      expect(body.position.x).toBeGreaterThan(8);
    } finally { controller.dispose(); }
  });
});
