import { createPlayerEquipper } from './playerEquipFixture';
import { advancePlayer } from './playerVisual';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bugnetVisual } from '../../prefab/src/bugnet';
import { AnimState } from '../src/animState';
import { overrideArchives } from './animStateFixture';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createGroundItemVisual } from './groundItemVisual';
import { wilsonPlayerInstance, createWilsonPlayer, type WilsonAnimationController } from './playerVisual';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src/slots';
import { BufferedAction } from '../../stategraphs/src/bufferedaction';

vi.mock('../../../src/InputManager', () => ({ input: { isPressed: () => false, isManualMovement: () => false, isActionInterrupting: () => false } }));

beforeEach(() => vi.stubGlobal('window', new EventTarget()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });



describe('original bugnet assets and Wilson action', () => {
  function useRealAssets() {
    vi.stubGlobal('fetch', async (url: string) => {
      const file = new URL(String(url), 'https://test.invalid').pathname.split('/anim/').at(-1)!;
      const bytes = await readFile(new URL(`../../../public/dst/data/anim/${file}`, import.meta.url));
      return new Response(bytes);
    });
  }

  function advance(controller: WilsonAnimationController, frames: number) {
    for (let i = 0; i < frames; i++) advancePlayer(controller, 1 / 60);
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
    const controllerEquipper = createPlayerEquipper(controller);
    controllerEquipper.equip('bugnet');
    // SGwilson's equip handler plays item_out (16 frames) from idle; the held art shows by its end.
    advance(controller, 20);
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
    const controllerEquipper = createPlayerEquipper(controller);
    const capture = vi.fn();
    const net = { prefab: 'bugnet', hasTag: (tag: string) => tag === 'NET_tool' };
    const swing = () => controller.stategraph.pushBufferedAction(new BufferedAction('NET', capture, undefined, { invobject: net }));
    const netting = () => controller.stategraph.isPerformingAction('NET');
    await controllerEquipper.equip('bugnet');
    expect(swing()).toBe(true);
    expect(netting()).toBe(true);
    expect(swing()).toBe(false);
    advance(controller, 35); // Before pre's 8 frames + swing's 10 frames (0.6 s).
    expect(capture).not.toHaveBeenCalled();
    advance(controller, 3);
    expect(capture).toHaveBeenCalledOnce();
    advance(controller, 60);
    expect(capture).toHaveBeenCalledOnce();
    expect(netting()).toBe(false);
    expect(swing()).toBe(true);
    advance(controller, 10);
    await controllerEquipper.equip(null);
    advance(controller, 100);
    expect(netting()).toBe(false);
    expect(capture).toHaveBeenCalledOnce();
  });

});

