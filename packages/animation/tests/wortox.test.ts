import { wilsonPlayer } from './wilsonPlayer';
import { testPlayer } from './testPlayer';
import { addComponent } from '../../prefab/src/components';
import { Health } from '../../componets/src/health';
import type { PlayerAction } from '../../stategraphs/src/actionfns';
import { afterEach, expect, it, vi } from 'vitest';
import { Wortox } from '../../prefab/src/wortox';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { BufferedAction } from '../../stategraphs/src/bufferedaction';
import { Object3D, PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from 'three';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';
import { Locomotor } from '../../prefab/src/locomotor';
import { GetPointSpecialActions } from '../../prefab/src/wortoxPlayer';
import { createEquipmentExistenceState } from '../../signals/src';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { savedInventoryOf } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { importedSave } from './importedSave';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('allows empty-inventory hops and settles one soul after two hops or five game seconds', () => {
  const scheduler = new GameTimeScheduler(),
    inventory = { ConsumeByName: vi.fn() };
  const wortox = new Wortox(scheduler, inventory);
  expect(wortox.TryToPortalHop()).toBe(true);
  expect(wortox.OnSave()).toEqual({ freehops: 1, soulhopcost: 0 });
  expect(wortox.echoTimer.peek()).toEqual({ status: 'scheduled', endTime: 5 });
  scheduler.advanceTo(4.99);
  expect(inventory.ConsumeByName).not.toHaveBeenCalled();
  expect(wortox.TryToPortalHop()).toBe(true);
  expect(inventory.ConsumeByName).toHaveBeenCalledExactlyOnceWith('wortox_soul', 1);
  expect(wortox.OnSave()).toEqual({ freehops: 0, soulhopcost: 0 });
  expect(wortox.echoTimer.peek().status).toBe('stopped');
  wortox.TryToPortalHop();
  scheduler.advanceTo(9.99);
  expect(inventory.ConsumeByName).toHaveBeenCalledTimes(2);
  expect(wortox.echoTimer.peek().status).toBe('expired');
  wortox.TryToPortalHop();
  wortox.dispose();
  scheduler.advanceTo(100);
  expect(wortox.echoTimer.peek().status).toBe('stopped');
  expect(inventory.ConsumeByName).toHaveBeenCalledTimes(2);
  expect(wortox.TryToPortalHop()).toBe(false);
});

it('saves and restores Lua counters without persisting the transient finish task', async () => {
  const scheduler = new GameTimeScheduler(),
    inventory = { ConsumeByName: vi.fn() };
  const original = new Wortox(scheduler, inventory),
    restored = new Wortox(scheduler, inventory);
  original.TryToPortalHop();
  const template = importedSave('Caves');
  const document = deserializeSave(
    serializeSave(
      template,
      {
        entities: template.world.entities,
        playerTransform: template.players.local.transform,
        inventory: savedInventoryOf(template),
        elapsedSeconds: template.world.elapsedSeconds,
        playerWortox: original.OnSave(),
      },
      SAVE_CATALOG,
    ),
    SAVE_CATALOG,
  );
  expect(document.players.local.wortox).toEqual({ freehops: 1, soulhopcost: 0 });
  restored.OnLoad(document.players.local.wortox);
  expect(restored.echoTimer.peek().status).toBe('stopped');
  expect(restored.TryToPortalHop()).toBe(true);
  expect(restored.OnSave()).toEqual({ freehops: 0, soulhopcost: 0 });
  document.players.local.wortox!.freehops = 8;
  expect(() => deserializeSave(JSON.stringify(document), SAVE_CATALOG)).toThrow('freehops');
  original.dispose();
  restored.dispose();
});

it('commits BLINK after the pre-animation, teleports after 11 frames and restores collision and invincibility', () => {
  const point = new Vector3(12, 0, 24),
    position = new Vector3();
  const state = new Wortox(new GameTimeScheduler(), { ConsumeByName: vi.fn() });
  let collisions = true,
    tint = 0;
  // The player inst: its health's invincibility and the soul hop host the application binds.
  let health!: Health;
  const inst = wilsonPlayer(
    name => (name === 'wortox_portal_jumpin_pre' ? 0.2 : 1),
    inst => {
      health = addComponent(inst, 'health', Health, 150);
      inst.soulHopHost = {
        tryToPortalHop: () => state.TryToPortalHop(),
        facePoint() {},
        teleport: (target: Vector3) => position.copy(target),
        setPhysicsEnabled: (enabled: boolean) => {
          collisions = enabled;
        },
        setTint: (value: number) => {
          tint = value;
        },
        spawnFx: vi.fn(),
      };
    },
  );
  const graph = inst.sg;
  const execute = vi.fn(() => graph.beginPortalJump(point));
  const action: PlayerAction<'BLINK'> = new BufferedAction('BLINK', execute, () => true, { pos: point });
  expect(graph.pushBufferedAction(action)).toBe(true);
  graph.update(0.19);
  expect(execute).not.toHaveBeenCalled();
  graph.update(0.01);
  expect(execute).toHaveBeenCalledOnce();
  expect(graph.stateName).toBe('portal_jumpin');
  graph.update(4 / 30);
  expect(health.invincible).toBe(true);
  expect(position.lengthSq()).toBe(0);
  graph.update(7 / 30);
  expect(graph.stateName).toBe('portal_jumpout');
  expect(position).toEqual(point);
  expect(collisions).toBe(false);
  expect(health.invincible).toBe(true);
  graph.requestOneShot('item_out');
  graph.pushEvent('unequip');
  expect(graph.stateName).toBe('portal_jumpout');
  graph.update(7 / 30);
  expect(health.invincible).toBe(false);
  graph.update(1 / 30);
  expect(collisions).toBe(true);
  expect(tint).toBe(0);
  graph.cancelAction('BLINK');
  expect(collisions).toBe(true);
  expect(health.invincible).toBe(false);
  let valid = true;
  const cancelled = vi.fn(() => graph.beginPortalJump(point));
  graph.pushBufferedAction(new BufferedAction('BLINK', cancelled, () => valid, { pos: point }));
  valid = false;
  graph.update(0.2);
  expect(cancelled).not.toHaveBeenCalled();
  expect(graph.stateName).toBe('idle');
  graph.pushBufferedAction(
    new BufferedAction(
      'BLINK',
      () => graph.beginPortalJump(point),
      () => true,
      { pos: point },
    ),
  );
  graph.update(0.2 + 4 / 30);
  expect(health.invincible).toBe(true);
  graph.goToState('death');
  expect(health.invincible).toBe(false);
  expect(tint).toBe(0);
  expect(collisions).toBe(true);
  state.dispose();
});

it('runs the map right click as BLINK_MAP without walking, revalidates before commit and snaps only after teleporting', () => {
  vi.stubGlobal('window', new EventTarget());
  const point = new Vector3(1200, 0, -900);
  const tryToPortalHop = vi.fn(() => false),
    snapCamera = vi.fn(() => player.position.clone());
  const teleport = vi.fn((position: Vector3) => player.position.copy(position));
  // The player inst: Wortox's soul hop host and point actions, and its own SGwilson.
  let eligible = true,
    valid = true;
  const inst = wilsonPlayer(
    name => (name === 'wortox_portal_jumpin_pre' ? 0.2 : 1),
    inst => {
      inst.addTag('soulstealer');
      inst.soulHopHost = {
        tryToPortalHop,
        facePoint() {},
        teleport,
        snapCamera,
        setPhysicsEnabled() {},
        setTint() {},
        spawnFx() {},
      };
      inst.CanSoulhop = () => eligible;
      inst.CanBlinkTo = vi.fn(() => false);
      inst.CanBlinkFromWithMap = () => valid;
    },
  );
  const graph = inst.sg,
    player = inst.transform.model;
  const world = {
    player,
    scene: new Scene(),
    camera: new PerspectiveCamera(),
    ground: new Object3D(),
    renderer: { domElement: new EventTarget() } as unknown as WebGLRenderer,
  } as ActionWorldContext;
  world.mouseActions = new PlayerActionPicker(new PointerRaycaster(world));
  const body = { position: player.position, velocity: new Vector3() };
  const locomotor = new Locomotor(body, {});
  const goToPoint = vi.spyOn(locomotor, 'goToPoint');
  const doer = testPlayer({ model: player });
  world.mouseActions.pointspecialactionsfn = (_doer, pos, useitem, right) =>
    GetPointSpecialActions(inst, player.position, pos, useitem, right);
  const controller = new PlayerController(world, graph, locomotor, createEquipmentExistenceState('HANDS'), doer);
  try {
    eligible = false;
    expect(controller.OnMapAction(point)).toBe(false);
    eligible = true;
    expect(controller.OnMapAction(point)).toBe(true);
    locomotor.update(16, 1 / 30);
    expect(graph.getBufferedAction()?.action).toBe('BLINK_MAP');
    valid = false;
    graph.update(0.2);
    expect(graph.stateName).toBe('idle');
    expect(teleport).not.toHaveBeenCalled();
    valid = true;
    expect(controller.OnMapAction(point)).toBe(true);
    locomotor.update(16, 1 / 30);
    expect(controller.OnMapAction(point)).toBe(false);
    graph.update(0.2);
    expect(graph.stateName).toBe('portal_jumpin');
    expect(tryToPortalHop).not.toHaveBeenCalled();
    expect(goToPoint).not.toHaveBeenCalled();
    expect(inst.CanBlinkTo).not.toHaveBeenCalled();
    expect(inst.checkingmapactions).toBeUndefined();
    graph.update(11 / 30);
    expect(teleport).toHaveBeenCalledExactlyOnceWith(point);
    expect(snapCamera).toHaveReturnedWith(point);
    graph.requestOneShot('item_out');
    graph.pushEvent('unequip');
    expect(graph.stateName).toBe('portal_jumpout');
    graph.update(14 / 30);
    expect(graph.stateName).toBe('idle');
    controller.dispose();
    expect(controller.OnMapAction(point)).toBe(false);
  } finally {
    controller.dispose();
    world.mouseActions.dispose();
  }
});
