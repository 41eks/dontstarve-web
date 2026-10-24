import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Wortox } from '../../prefab/src/wortox';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import { BufferedAction } from '../../stategraphs/src/bufferedaction';
import type { WilsonStateGraphHost } from '../../stategraphs/src/SGwilson';
import { Object3D, PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from 'three';
import { BlinkActionController } from '../../stategraphs/src/blink';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('allows empty-inventory hops and settles one soul after two hops or five game seconds', () => {
  const scheduler = new GameTimeScheduler(), inventory = { ConsumeByName: vi.fn() };
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
  wortox.TryToPortalHop(); scheduler.advanceTo(9.99);
  expect(inventory.ConsumeByName).toHaveBeenCalledTimes(2);
  expect(wortox.echoTimer.peek().status).toBe('expired');
  wortox.TryToPortalHop(); wortox.dispose(); scheduler.advanceTo(100);
  expect(wortox.echoTimer.peek().status).toBe('stopped');
  expect(inventory.ConsumeByName).toHaveBeenCalledTimes(2);
  expect(wortox.TryToPortalHop()).toBe(false);
});

it('saves and restores Lua counters without persisting the transient finish task', async () => {
  const scheduler = new GameTimeScheduler(), inventory = { ConsumeByName: vi.fn() };
  const original = new Wortox(scheduler, inventory), restored = new Wortox(scheduler, inventory);
  original.TryToPortalHop();
  const template = deserializeSave(await readFile(new URL('../../../public/saves/Cluster_1/Caves.json', import.meta.url), 'utf8'), SAVE_CATALOG);
  const document = deserializeSave(serializeSave(template, {
    entities: template.world.entities, playerTransform: template.players.local.transform,
    inventory: inventoryStateFromSave(template), elapsedSeconds: template.world.elapsedSeconds,
    playerWortox: original.OnSave(),
  }, SAVE_CATALOG), SAVE_CATALOG);
  expect(document.players.local.wortox).toEqual({ freehops: 1, soulhopcost: 0 });
  restored.OnLoad(document.players.local.wortox);
  expect(restored.echoTimer.peek().status).toBe('stopped');
  expect(restored.TryToPortalHop()).toBe(true);
  expect(restored.OnSave()).toEqual({ freehops: 0, soulhopcost: 0 });
  document.players.local.wortox!.freehops = 8;
  expect(() => deserializeSave(JSON.stringify(document), SAVE_CATALOG)).toThrow('freehops');
  original.dispose(); restored.dispose();
});

it('commits BLINK after the pre-animation, teleports after 11 frames and restores collision and invincibility', () => {
  const point = new Vector3(12, 0, 24), position = new Vector3();
  const state = new Wortox(new GameTimeScheduler(), { ConsumeByName: vi.fn() });
  let invincible = false, collisions = true, tint = 0;
  const host: WilsonStateGraphHost = {
    playAnimation: clip => clip.name === 'wortox_portal_jumpin_pre' ? .2 : 1,
    playSound() {}, setCasting() {}, onStateChanged() {},
    rez: { isHidden: false, setHidden() {}, setMultColour() {}, setInvincible: value => { invincible = value; } },
    soulHop: { tryToPortalHop: () => state.TryToPortalHop(), facePoint() {}, teleport: target => position.copy(target),
      setPhysicsEnabled: enabled => { collisions = enabled; }, setTint: value => { tint = value; }, spawnFx: vi.fn(), playSound() {} },
  };
  const graph = new WilsonStateGraph(host);
  const execute = vi.fn(() => graph.beginPortalJump(point));
  const action = new BufferedAction('BLINK', execute, () => true, { pos: point });
  expect(graph.pushBufferedAction(action)).toBe(true);
  graph.update(.19); expect(execute).not.toHaveBeenCalled();
  graph.update(.01); expect(execute).toHaveBeenCalledOnce();
  expect(graph.stateName).toBe('portal_jumpin');
  graph.update(4 / 30); expect(invincible).toBe(true); expect(position.lengthSq()).toBe(0);
  graph.update(7 / 30); expect(graph.stateName).toBe('portal_jumpout'); expect(position).toEqual(point);
  expect(collisions).toBe(false); expect(invincible).toBe(true);
  graph.requestOneShot('item_out'); graph.requestCrafting(true); graph.pushEvent('unequip');
  expect(graph.stateName).toBe('portal_jumpout');
  graph.update(7 / 30); expect(invincible).toBe(false);
  graph.update(1 / 30); expect(collisions).toBe(true); expect(tint).toBe(0);
  graph.cancelAction('BLINK'); expect(collisions).toBe(true); expect(invincible).toBe(false);
  let valid = true;
  const cancelled = vi.fn(() => graph.beginPortalJump(point));
  graph.pushBufferedAction(new BufferedAction('BLINK', cancelled, () => valid, { pos: point }));
  valid = false; graph.update(.2);
  expect(cancelled).not.toHaveBeenCalled(); expect(graph.stateName).toBe('idle');
  graph.pushBufferedAction(new BufferedAction('BLINK', () => graph.beginPortalJump(point), () => true, { pos: point }));
  graph.update(.2 + 4 / 30);
  expect(invincible).toBe(true);
  graph.goToState('death');
  expect(invincible).toBe(false); expect(tint).toBe(0); expect(collisions).toBe(true);
  state.dispose();
});

it('buffers a free map jump without walking, revalidates before commit and snaps only after teleporting', () => {
  vi.stubGlobal('window', new EventTarget());
  const player = new Object3D(), point = new Vector3(1200, 0, -900);
  const tryToPortalHop = vi.fn(() => false), snapCamera = vi.fn(() => player.position.clone());
  const teleport = vi.fn((position: Vector3) => player.position.copy(position));
  const graph = new WilsonStateGraph({
    playAnimation: clip => clip.name === 'wortox_portal_jumpin_pre' ? .2 : 1,
    playSound() {}, setCasting() {}, onStateChanged() {},
    soulHop: { tryToPortalHop, facePoint() {}, teleport, snapCamera,
      setPhysicsEnabled() {}, setTint() {}, spawnFx() {}, playSound() {} },
  });
  const locomotor = { destination: undefined, stop: vi.fn(), goToPoint: vi.fn(() => false) };
  let eligible = true, valid = true;
  const canBlinkTo = vi.fn(() => false);
  const controller = new BlinkActionController({ player, scene: new Scene(), camera: new PerspectiveCamera(),
    ground: new Object3D(), renderer: { domElement: new EventTarget() } as unknown as WebGLRenderer },
  { stategraph: graph }, locomotor, {
    canSoulHop: () => eligible, canBlinkTo, canMapBlinkTo: () => valid, hasSoulEcho: () => false,
  });
  try {
    eligible = false;
    expect(controller.requestMap(point)).toBe(false);
    eligible = true;
    expect(controller.requestMap(point)).toBe(true);
    expect(graph.getBufferedAction()?.action).toBe('BLINK_MAP');
    valid = false;
    graph.update(.2);
    expect(graph.stateName).toBe('idle');
    expect(teleport).not.toHaveBeenCalled();
    valid = true;
    expect(controller.requestMap(point)).toBe(true);
    expect(controller.requestMap(point)).toBe(false);
    graph.update(.2);
    expect(graph.stateName).toBe('portal_jumpin');
    expect(tryToPortalHop).not.toHaveBeenCalled();
    expect(locomotor.goToPoint).not.toHaveBeenCalled();
    expect(canBlinkTo).not.toHaveBeenCalled();
    graph.update(11 / 30);
    expect(teleport).toHaveBeenCalledExactlyOnceWith(point);
    expect(snapCamera).toHaveReturnedWith(point);
    graph.requestOneShot('item_out'); graph.requestCrafting(true); graph.pushEvent('unequip');
    expect(graph.stateName).toBe('portal_jumpout');
    graph.update(14 / 30);
    expect(graph.stateName).toBe('idle');
    controller.dispose();
    expect(controller.requestMap(point)).toBe(false);
  } finally { controller.dispose(); }
});
