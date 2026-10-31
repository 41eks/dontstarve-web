import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pitchforkVisual, type PitchforkTool } from '../../prefab/src/pitchfork';
import { AnimState } from '../src/animState';
import { overrideArchives } from './animStateFixture';
import { PitchforkActionController } from '../../stategraphs/src/terraform';
import { TurfMap, WORLD_TILES } from '../../prefab/src/turfMap';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createGroundItemVisual } from './groundItemVisual';
import { wilsonPlayerInstance, createWilsonPlayer, type WilsonAnimationController } from './playerVisual';
import type { WorldContext } from '../../prefab/src/worldContext';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src/slots';
import { createEquipmentExistenceState } from '../../signals/src';
import { drawGround, layerGeometry, layerMeshes } from './groundDisplayFixture';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => {
    const path = String(url).slice('/dst/data/'.length);
    const bytes = await readFile(new URL(`../../../public/dst/data/${path}`, import.meta.url));
    return new Response(bytes);
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function advance(animation: WilsonAnimationController, frames: number) {
  for (let i = 0; i < frames; i++) animation.update(1 / 60);
}

describe('pitchfork source art and TERRAFORM timing', () => {
  it.each(['pitchfork'] as PitchforkTool[])('loads %s ground, held and skinned art and digs at frame 25 once', async (tool) => {
    expect(inventoryItemEquipmentKind(tool)).toBe('hand');
    expect(inventoryItemMaxStack(tool)).toBe(1);
    const assets = new GroundItemAssets();
    const ground = await createGroundItemVisual(assets, tool);
    const mesh = ground.model.children[0].children[0].children[0] as THREE.Mesh;
    expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
    expect((mesh.material as THREE.Material[]).some((material) => material.name === `ground:${tool}`)).toBe(true);
    for (const skin of Object.keys(GROUND_ITEM_DEFINITIONS[tool].skinArchives)) {
      const anim = new AnimState(() => {});
      pitchforkVisual({ id: tool, prefab: tool, skinId: skin }).onequip({ AnimState: anim, PushEvent() {} });
      expect(overrideArchives(anim, 'swap_object')).toEqual([GROUND_ITEM_DEFINITIONS[tool].skinArchives[skin], `swap_${tool}.zip`]);
      const skinned = await createGroundItemVisual(assets, tool, skin);
      skinned.dispose();
    }
    const player = await createWilsonPlayer('/dst/data/anim');
    const animation = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
    const dig = vi.fn();
    expect(animation.playDig(dig)).toBe(false);
    animation.setCarryItem(tool);
    const held = player.getObjectByProperty('isMesh', true) as THREE.Mesh;
    await vi.waitFor(() => expect((held.material as THREE.Material[]).some((material) => material.name === `ground:swap_${tool}`)).toBe(true));
    expect(animation.playDig(dig)).toBe(true);
    expect(animation.playDig(dig)).toBe(false);
    advance(animation, 49); // 24.5 source frames: shovel_pre + part of shovel_loop.
    expect(dig).not.toHaveBeenCalled();
    advance(animation, 1);
    expect(dig).toHaveBeenCalledOnce();
    advance(animation, 100);
    expect(dig).toHaveBeenCalledOnce();
    expect(animation.isDigging).toBe(false);
    expect(animation.playDig(dig)).toBe(true);
    advance(animation, 10);
    await animation.setCarryItem(null);
    advance(animation, 100);
    expect(dig).toHaveBeenCalledOnce();
    expect(animation.isDigging).toBe(false);
    ground.dispose();
  });

  it('changes only the selected tile, including woodfloor, and restores saved dirt geometry', async () => {
    const map = new TurfMap(1000);
    const point = { x: -1, z: 13 };
    map.setOriginalTile(point, WORLD_TILES.WOODFLOOR);
    expect(map.getTileAtWorld(point)).toBe(WORLD_TILES.WOODFLOOR);
    const display = await drawGround(map);
    expect(layerMeshes(display, 'DIRT')).toHaveLength(0);
    expect(map.dig(point)).toBe(true);
    expect(map.getTileAtWorld({ x: -12, z: 23.9 })).toBe(WORLD_TILES.DIRT);
    expect(map.getTileAtWorld({ x: 0, z: 13 })).toBe(WORLD_TILES.DECIDUOUS);
    expect(map.dig(point)).toBe(false);
    expect(map.dig({ x: 500, z: 0 })).toBe(false);
    expect(map.dig({ x: NaN, z: 0 })).toBe(false);
    expect(map.exportTiles()).toEqual([{ col: -1, row: 1, tileId: WORLD_TILES.DIRT }]);
    const restored = new TurfMap(1000, map.exportTiles());
    restored.setOriginalTile(point, WORLD_TILES.WOODFLOOR);
    expect(restored.canTerraform(point)).toBe(false);
    const restoredDisplay = await drawGround(restored);
    const dirt = layerGeometry(display, 'DIRT');
    expect(layerGeometry(restoredDisplay, 'DIRT').getAttribute('position').array).toEqual(dirt.getAttribute('position').array);
    // Like every turf layer, a lone dirt cell blends into its eight neighbours through skirt masks.
    expect(dirt.getIndex()!.count).toBe(9 * 6);
    const [mesh] = layerMeshes(display, 'DIRT');
    expect((mesh.material as THREE.MeshLambertMaterial).depthWrite).toBe(false);
    expect(mesh.renderOrder).toBeGreaterThan(-2);
    expect(mesh.renderOrder).toBeLessThan(0);
    dirt.computeBoundingBox();
    expect(dirt.boundingBox!.min.toArray()).toEqual([-24, 0, 0]);
    expect(dirt.boundingBox!.max.toArray()).toEqual([12, 0, 36]);
    display.dispose(); restoredDisplay.dispose();
  });
});

function setupAction() {
  const canvas = new EventTarget();
  const player = new THREE.Group();
  const world = { player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: canvas } } as unknown as WorldContext;
  const equipped = createEquipmentExistenceState('HANDS');
  equipped.set({ itemId: 'pitchfork', EQUIPSLOTS: 'HANDS' });
  let manual = false, onDig: (() => void) | undefined;
  const animation = { isDigging: false, isCasting: false, isNetting: false,
    cancelEmote: vi.fn(), cancelDig: vi.fn(), setFacing: vi.fn(),
    playDig: vi.fn((callback: () => void) => { onDig = callback; return true; }) };
  const locomotor = { goToPoint: vi.fn((_point: THREE.Vector3) => true), stop: vi.fn(), destination: undefined };
  const map = new TurfMap(1000);
  const controller = new PitchforkActionController(world, animation as unknown as WilsonAnimationController,
    locomotor, equipped, map, () => manual);
  return { controller, map, canvas, player, animation, locomotor,
    equip: (value: boolean) => equipped.set(value ? { itemId: 'pitchfork', EQUIPSLOTS: 'HANDS' } : null),
    move: () => { manual = true; }, hit: () => onDig?.() };
}

describe('pitchfork point action', () => {
  it('walks into reach of the tile centre and modifies the turf only on impact', () => {
    const s = setupAction();
    const point = new THREE.Vector3(12.1, 0, 0.1);
    s.equip(false);
    expect(s.controller.request(point)).toBe(false);
    s.equip(true);
    expect(s.controller.request(point)).toBe(true);
    s.controller.update(0.1);
    const destination = s.locomotor.goToPoint.mock.calls[0][0];
    expect(destination.distanceTo(new THREE.Vector3(18, 0, 6))).toBeCloseTo(3.2);
    expect(s.animation.playDig).not.toHaveBeenCalled();
    s.player.position.set(18, 0, 9);
    s.controller.update(0.1);
    expect(s.animation.playDig).toHaveBeenCalledOnce();
    expect(s.map.getTileAtWorld(point)).toBe(WORLD_TILES.DECIDUOUS);
    s.hit();
    expect(s.map.getTileAtWorld(point)).toBe(WORLD_TILES.DIRT);
    expect(s.controller.request(point)).toBe(false);
  });

  it.each(['escape', 'out of reach'] as const)('never changes terrain after %s cancels a pending impact', (reason) => {
    const s = setupAction();
    const point = new THREE.Vector3(6, 0, 6);
    s.player.position.set(6, 0, 9);
    s.controller.request(point);
    s.controller.update(0.1);
    if (reason === 'escape') window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Escape' }));
    if (reason === 'out of reach') s.player.position.x = 100;
    s.hit();
    expect(s.map.getTileAtWorld(point)).toBe(WORLD_TILES.DECIDUOUS);
    s.controller.dispose();
  });
});
