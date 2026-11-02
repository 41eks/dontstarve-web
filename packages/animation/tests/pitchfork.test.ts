import { advancePlayer } from './playerVisual';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pitchforkVisual, type PitchforkTool } from '../../prefab/src/pitchfork';
import { AnimState } from '../src/animState';
import { overrideArchives } from './animStateFixture';
import { TurfMap, WORLD_TILES } from '../../prefab/src/turfMap';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createGroundItemVisual } from './groundItemVisual';
import { wilsonPlayerInstance, createWilsonPlayer, type WilsonAnimationController } from './playerVisual';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src/slots';
import { drawGround, layerGeometry, layerMeshes } from './groundDisplayFixture';
import { BufferedAction } from '../../stategraphs/src/bufferedaction';

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
  for (let i = 0; i < frames; i++) advancePlayer(animation, 1 / 60);
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
    const push = () => animation.stategraph.pushBufferedAction(new BufferedAction('TERRAFORM', dig));
    const digging = () => animation.stategraph.isPerformingAction('TERRAFORM');
    animation.setCarryItem(tool);
    const held = player.getObjectByProperty('isMesh', true) as THREE.Mesh;
    await vi.waitFor(() => expect((held.material as THREE.Material[]).some((material) => material.name === `ground:swap_${tool}`)).toBe(true));
    expect(push()).toBe(true);
    expect(push()).toBe(false);
    advance(animation, 49); // 24.5 source frames: shovel_pre + part of shovel_loop.
    expect(dig).not.toHaveBeenCalled();
    advance(animation, 1);
    expect(dig).toHaveBeenCalledOnce();
    advance(animation, 100);
    expect(dig).toHaveBeenCalledOnce();
    expect(digging()).toBe(false);
    expect(push()).toBe(true);
    advance(animation, 10);
    await animation.setCarryItem(null);
    advance(animation, 100);
    expect(dig).toHaveBeenCalledOnce();
    expect(digging()).toBe(false);
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
