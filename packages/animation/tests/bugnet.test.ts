import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BugNetCaptureController, loadBugNetEquipment, type ButterflyCaptureTarget } from '../../prefab/src/bugnet';
import { createGroundItemSprite, GroundItemAssets } from '../../prefab/src/groundItems';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import type { WorldContext } from '../../prefab/src/worldContext';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src/slots';
import { Locomotor } from '../../prefab/src/locomotor';
import { updateMovement } from '../../../src/updatePlayerMovement';
import { FIXED_TIMESTEP, MAX_SUBSTEPS } from '../../../src/physicsTiming';
import type { PlayerBody } from '../../../src/types/Player';

vi.mock('../../../src/InputManager', () => ({ input: { isPressed: () => false } }));

beforeEach(() => vi.stubGlobal('window', new EventTarget()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const canvas = new EventTarget();
  const player = new THREE.Group();
  const world = { player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: canvas } } as unknown as WorldContext;
  const locomotor = { goToPoint: vi.fn(() => true), stop: vi.fn(), destination: undefined };
  let equipped = true;
  let manual = false;
  let hit: (() => void) | undefined;
  const animation = { isNetting: false, isCasting: false, setFacing: vi.fn(),
    playBugNet: vi.fn((callback: () => void) => { hit = callback; return true; }) };
  const target: ButterflyCaptureTarget = { id: 'butterfly1', model: new THREE.Group(),
    position: new THREE.Vector3(8, 0, 0), isValid: vi.fn(() => true), capture: vi.fn(() => true) };
  const controller = new BugNetCaptureController(world, animation as unknown as WilsonAnimationController,
    locomotor, () => equipped, () => [target], () => manual);
  return { canvas, player, locomotor, animation, target, controller,
    equip: (value: boolean) => { equipped = value; },
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
    if (reason === 'removed') vi.mocked(s.target.isValid).mockReturnValue(false);
    if (reason === 'unequipped') s.equip(false);
    if (reason === 'cancelled') s.controller.cancel();
    s.hit();
    expect(s.target.capture).not.toHaveBeenCalled();
  });
});

describe('original bugnet assets and Wilson action', () => {
  function useRealAssets() {
    vi.stubGlobal('fetch', async (url: string) => {
      const file = new URL(String(url), 'https://test.invalid').pathname.replace('/anim/', '');
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
    const assets = new GroundItemAssets('/anim');
    const ground = await createGroundItemSprite(assets, 'bugnet');
    const meshes: THREE.Mesh[] = [];
    ground.model.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
    expect(meshes).toHaveLength(1);
    expect(meshes[0].geometry.drawRange.count).toBeGreaterThan(0);
    expect((meshes[0].material as THREE.MeshBasicMaterial[])[0].name).toBe('ground:swap_bugnet');
    const equipment = await loadBugNetEquipment(assets, 'bugnet_frog');
    expect(equipment.builds.map(({ build }) => build.name)).toEqual(['bugnet_frog', 'swap_bugnet']);
    const player = await createWilsonPlayer('/anim');
    const controller = player.userData.animationController as WilsonAnimationController;
    await controller.setCarryItem('bugnet');
    const mesh = player.children[0].children[0] as THREE.Mesh;
    expect((mesh.material as THREE.MeshBasicMaterial[]).some(material => material.name === 'ground:swap_bugnet')).toBe(true);
    expect((mesh.material as THREE.MeshBasicMaterial[]).every(material => material.forceSinglePass)).toBe(true);
    ground.dispose();
  });

  it('plays pre then swing, performs NET at frame 10 once and cancels on unequip', async () => {
    useRealAssets();
    const player = await createWilsonPlayer('/anim');
    const controller = player.userData.animationController as WilsonAnimationController;
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
    const animation = player.userData.animationController as WilsonAnimationController;
    await animation.setCarryItem('bugnet');
    const body = new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(0.5), linearDamping: 0 }) as PlayerBody;
    body.position.y = 0.5;
    body.canJump = true;
    const physics = new CANNON.World();
    physics.addBody(body);
    const locomotor = new Locomotor(body);
    const camera = new THREE.PerspectiveCamera();
    const world = { player, camera, ground: new THREE.Group(), renderer: { domElement: new EventTarget() } } as unknown as WorldContext;
    const target: ButterflyCaptureTarget = { id: 'moving', model: new THREE.Group(),
      position: new THREE.Vector3(8, 0, 0), isValid: () => true, capture: vi.fn(() => true) };
    const capture = new BugNetCaptureController(world, animation, locomotor, () => true, () => [target]);
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
