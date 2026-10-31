import { actionTool, netEntity } from './actionFixtures';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bugnetVisual } from '../../prefab/src/bugnet';
import { AnimState } from '../src/animState';
import { overrideArchives } from './animStateFixture';
import { BugNetCaptureController, type ButterflyCaptureTarget } from '../../stategraphs/src/net';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createGroundItemVisual } from './groundItemVisual';
import { wilsonPlayerInstance, createWilsonPlayer, type WilsonAnimationController } from './playerVisual';
import type { WorldContext } from '../../prefab/src/worldContext';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src/slots';
import { Locomotor } from '../../prefab/src/locomotor';
import { updateMovement } from '../../../src/updatePlayerMovement';
import { FIXED_TIMESTEP, MAX_SUBSTEPS } from '../../../src/physicsTiming';
import { createEquipmentExistenceState } from '../../signals/src';
import type { PlayerBody } from '../../../src/types/Player';

vi.mock('../../../src/InputManager', () => ({ input: { isPressed: () => false, isManualMovement: () => false, isActionInterrupting: () => false } }));

beforeEach(() => vi.stubGlobal('window', new EventTarget()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const canvas = new EventTarget();
  const player = new THREE.Group();
  const world = { player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: canvas } } as unknown as WorldContext;
  const locomotor = { goToPoint: vi.fn(() => true), stop: vi.fn(), destination: undefined };
  const equipped = createEquipmentExistenceState('HANDS');
  const net = actionTool('bugnet');
  equipped.set(net);
  let manual = false;
  let hit: (() => void) | undefined;
  const animation = { isNetting: false, isCasting: false, setFacing: vi.fn(),
    playBugNet: vi.fn((callback: () => void) => { hit = callback; return true; }) };
  const target: ButterflyCaptureTarget = { id: 'butterfly1', entity: netEntity(() => target.capture()), model: new THREE.Group(),
    position: new THREE.Vector3(8, 0, 0), isValid: vi.fn(() => true), capture: vi.fn(() => true) };
  const controller = new BugNetCaptureController(world, animation as unknown as WilsonAnimationController,
    locomotor, equipped, () => [target], () => manual);
  return { canvas, player, locomotor, animation, target, controller,
    equip: (value: boolean) => equipped.set(value ? net : null),
    moveManually: () => { manual = true; }, hit: () => hit?.() };
}

describe('NET action on a moving butterfly', () => {
  it('requires the equipped net, follows the creature and captures only at impact', () => {
    const s = setup();
    s.equip(false);
    expect(s.controller.request(s.target)).toBe(false);
    s.equip(true);
    expect(s.controller.request(s.target)).toBe(true);
    s.controller.update(0.01);
    expect(s.locomotor.goToPoint).toHaveBeenCalledWith(s.target.position);
    expect(s.animation.playBugNet).not.toHaveBeenCalled();
    s.target.position.x = 10;
    s.controller.update(0.2);
    expect(s.locomotor.goToPoint).toHaveBeenCalledTimes(2);
    s.player.position.x = 9;
    s.controller.update(0.01);
    expect(s.locomotor.stop).toHaveBeenCalled();
    expect(s.animation.playBugNet).toHaveBeenCalledOnce();
    expect(s.target.capture).not.toHaveBeenCalled();
    s.target.position.x = 12.9;
    s.hit();
    expect(s.target.capture).toHaveBeenCalledOnce();
  });

  it.each(['escaped', 'unequipped'] as const)('revalidates %s targets at impact', (reason) => {
    const s = setup();
    s.target.position.x = 1;
    s.controller.request(s.target);
    s.controller.update(0.01);
    if (reason === 'escaped') s.target.position.x = 4.1;
    if (reason === 'unequipped') s.equip(false);
    s.hit();
    expect(s.target.capture).not.toHaveBeenCalled();
  });
});

describe('original bugnet assets and Wilson action', () => {
  function useRealAssets() {
    vi.stubGlobal('fetch', async (url: string) => {
      const file = new URL(String(url), 'https://test.invalid').pathname.split('/anim/').at(-1)!;
      const bytes = await readFile(new URL(`../../../public/dst/data/anim/${file}`, import.meta.url));
      return new Response(bytes);
    });
  }

  function advance(controller: WilsonAnimationController, frames: number) {
    for (let i = 0; i < frames; i++) controller.update(1 / 60);
  }

  it('uses the source ground pose, hand swap and skin builds', async () => {
    useRealAssets();
    expect(inventoryItemMaxStack('bugnet')).toBe(1);
    expect(inventoryItemEquipmentKind('bugnet')).toBe('hand');
    const assets = new GroundItemAssets();
    const ground = await createGroundItemVisual(assets, 'bugnet');
    const meshes: THREE.Mesh[] = [];
    ground.model.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
    expect(meshes).toHaveLength(1);
    expect(meshes[0].geometry.drawRange.count).toBeGreaterThan(0);
    expect((meshes[0].material as THREE.MeshBasicMaterial[])[0].name).toBe('ground:swap_bugnet');
    const anim = new AnimState(() => {});
    bugnetVisual({ id: 'bugnet', prefab: 'bugnet', skinId: 'bugnet_frog' }).onequip({ AnimState: anim, PushEvent() {} });
    expect(overrideArchives(anim, 'swap_object')).toEqual([GROUND_ITEM_DEFINITIONS.bugnet.skinArchives.bugnet_frog, 'swap_bugnet.zip']);
    const player = await createWilsonPlayer('/anim');
    const controller = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
    controller.setCarryItem('bugnet');
    const mesh = player.getObjectByProperty('isMesh', true) as THREE.Mesh;
    // The player's display loads the named swap build, then draws it.
    await vi.waitFor(() => expect((mesh.material as THREE.MeshBasicMaterial[]).some(material => material.name === 'ground:swap_bugnet')).toBe(true));
    expect((mesh.material as THREE.MeshBasicMaterial[]).every(material => material.forceSinglePass)).toBe(true);
    ground.dispose();
  });

  it('plays pre then swing, performs NET at frame 10 once and cancels on unequip', async () => {
    useRealAssets();
    const player = await createWilsonPlayer('/anim');
    const controller = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
    const capture = vi.fn();
    expect(controller.playBugNet(capture)).toBe(false);
    await controller.setCarryItem('bugnet');
    expect(controller.playBugNet(capture)).toBe(true);
    expect(controller.isNetting).toBe(true);
    expect(controller.playBugNet(capture)).toBe(false);
    advance(controller, 35); // Before pre's 8 frames + swing's 10 frames (0.6 s).
    expect(capture).not.toHaveBeenCalled();
    advance(controller, 3);
    expect(capture).toHaveBeenCalledOnce();
    advance(controller, 60);
    expect(capture).toHaveBeenCalledOnce();
    expect(controller.isNetting).toBe(false);
    expect(controller.playBugNet(capture)).toBe(true);
    advance(controller, 10);
    await controller.setCarryItem(null);
    advance(controller, 100);
    expect(controller.isNetting).toBe(false);
    expect(capture).toHaveBeenCalledOnce();
  });

  it('completes moving-target pursuit and source animation under slow frames', async () => {
    useRealAssets();
    const player = await createWilsonPlayer('/anim');
    player.position.set(0, 0, 0);
    const animation = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
    await animation.setCarryItem('bugnet');
    const body = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(0.5), linearDamping: 0 }) as PlayerBody;
    body.position.y = 0.5;
    body.canJump = true;
    const physics = new CANNON.World();
    physics.addBody(body);
    const locomotor = new Locomotor(body);
    const camera = new THREE.PerspectiveCamera();
    const world = { player, camera, ground: new THREE.Group(), renderer: { domElement: new EventTarget() } } as unknown as WorldContext;
    const target: ButterflyCaptureTarget = { id: 'moving', entity: netEntity(() => target.capture()), model: new THREE.Group(),
      position: new THREE.Vector3(8, 0, 0), isValid: () => true, capture: vi.fn(() => true) };
    const equipped = createEquipmentExistenceState('HANDS');
    const net = actionTool('bugnet');
  equipped.set(net);
    const capture = new BugNetCaptureController(world, animation, locomotor, equipped, () => [target]);
    const move = updateMovement(camera, player, body, locomotor);
    capture.request(target);
    for (let frame = 0; frame < 100 && !vi.mocked(target.capture).mock.calls.length; frame++) {
      capture.update(0.5);
      move(16, 0.5);
      animation.update(0.5);
      physics.step(FIXED_TIMESTEP, 0.5, MAX_SUBSTEPS);
      target.position.x += 4 * 0.1;
    }
    expect(target.capture).toHaveBeenCalledOnce();
    expect(body.position.x).toBeGreaterThan(8);
  });
});

describe('NET hover candidates', () => {
  it('builds no targets for the mouse picker until the net is equipped', () => {
    let provider!: (model?: THREE.Object3D) => readonly unknown[];
    const world = { player: new THREE.Group(), camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
      renderer: { domElement: new EventTarget() },
      mouseActions: { pointer: {}, register: (source: typeof provider) => { provider = source; return () => {}; } } } as unknown as WorldContext;
    const equipped = createEquipmentExistenceState('HANDS');
    const target: ButterflyCaptureTarget = { id: 'butterfly1', entity: netEntity(() => true), model: new THREE.Group(),
      position: new THREE.Vector3(), isValid: () => true, capture: () => true };
    const getTargets = vi.fn(() => [target]);
    const controller = new BugNetCaptureController(world, { isNetting: false, isCasting: false } as unknown as WilsonAnimationController,
      { goToPoint: vi.fn(), stop: vi.fn(), destination: undefined } as never, equipped, getTargets);
    expect(provider()).toEqual([]);
    expect(getTargets).not.toHaveBeenCalled();
    equipped.set(actionTool('bugnet'));
    expect(provider(target.model)).toHaveLength(1);
    expect(getTargets).toHaveBeenCalledExactlyOnceWith(target.model);
    controller.dispose();
  });
});
