import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPickupInventory } from './pickupFixture';
import { equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { getAxeLifecycle } from '../../prefab/src/axe';
import { createMoonTreeForest } from '../../prefab/src/moontree';
import { PickaxeActionController } from '../../stategraphs/src/pickaxe';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { PlaySound } from '../../prefab/src/sound';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('wears axes by CHOP consumption, with golden and moonglass variants, and removes a depleted axe', () => {
  const hand = equipmentSlotAddress('hand');
  for (const [prefab, effectiveness, consumption] of [['axe', 1, 1], ['goldenaxe', 1, .25], ['moonglassaxe', 2.5, 1.25]] as const) {
    const inventory = createPickupInventory();
    try {
      expect(inventory.add(prefab, 1)).toBe(true);
      expect(inventory.transfer(inventorySlotAddress(0), hand, 1)).toBe(true);
      const entity = inventory.getEntity(hand)!;
      getAxeLifecycle(entity).onequip();
      expect(entity.hasTag('CHOP_tool')).toBe(true);
      expect(entity.components.tool!.GetEffectiveness('CHOP')).toBe(effectiveness);
      entity.components.finiteuses.useForAction('CHOP');
      expect(entity.components.finiteuses.remaining).toBe(100 - consumption);
      // A depleted axe is removed from its equipment slot.
      entity.components.finiteuses.use(100);
      expect(entity.isRemoved).toBe(true);
      expect(inventory.handEquipment.peek()).toBeNull();
    } finally { inventory.dispose(); }
  }
});

it('chops a moon tree into a stump with an axe, dropping loot, keeping progress while unloaded and saving the stump', async () => {
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = player.userData.animationController as WilsonAnimationController;
  await animation.setCarryItem('axe');
  const inventory = createPickupInventory();
  inventory.add('axe', 1);
  inventory.transfer(inventorySlotAddress(0), equipmentSlotAddress('hand'), 1);
  const axe = inventory.getEntity(equipmentSlotAddress('hand'))!;
  const camera = new THREE.PerspectiveCamera(), scene = new THREE.Scene();
  const dropLoot = vi.fn();
  const forest = await createMoonTreeForest('/dst/data/anim', {
    positions: [new THREE.Vector3(1, 0, 0)], entityIds: ['tree'], loadRadius: 20,
  });
  scene.add(forest.group);
  forest.bindWorld({ camera, dropLoot });
  const world = { player, scene, camera, ground: new THREE.Group(), renderer: { domElement: new EventTarget() } } as unknown as ActionWorldContext;
  const locomotor = { goToPoint: vi.fn(() => true), stop: vi.fn(), destination: undefined };
  const controller = new PickaxeActionController(world, animation, locomotor, inventory.handEquipment, () => forest.chopTargets, undefined, 'CHOP');
  const advance = (frames: number) => { for (let i = 0; i < frames; i++) animation.update(1 / 30); };
  try {
    player.position.set(1, 0, 3);
    forest.updateNearby(player.position);
    const [target] = forest.chopTargets;
    expect(target.entity.hasTag('CHOP_workable')).toBe(true);
    expect(target.entity.components.workable!.GetWorkLeft()).toBe(16);

    // chop_start → chop: the work lands on frame two of the chop loop and wears the axe.
    expect(controller.request(target)).toBe(true); controller.update(0);
    while (animation.stategraph.stateName === 'chop_start') animation.update(1 / 30);
    expect(animation.stategraph.stateName).toBe('chop');
    expect(axe.components.finiteuses.remaining).toBeUndefined();
    advance(2);
    expect(target.entity.components.workable!.GetWorkLeft()).toBe(15);
    expect(axe.components.finiteuses.remaining).toBe(99);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/use_axe_tree', expect.any(THREE.Vector3));
    expect(forest.renderEntities.length).toBe(2); // the tree and its petals
    advance(60);

    // Cancelling before the strike keeps both the tree and the axe untouched.
    expect(controller.request(forest.chopTargets[0])).toBe(true); controller.update(0);
    controller.cancel(); advance(60);
    expect(axe.components.finiteuses.remaining).toBe(99);

    // Work survives unloading the model.
    player.position.set(500, 0, 0); forest.updateNearby(player.position);
    expect(forest.chopTargets).toEqual([]);
    player.position.set(1, 0, 3); forest.updateNearby(player.position);
    expect(forest.chopTargets[0].entity.components.workable!.GetWorkLeft()).toBe(15);

    // The last strike fells the tree away from the chopper and leaves a stump.
    vi.spyOn(Math, 'random').mockReturnValue(.9);
    const worker = { getPosition: () => ({ x: 1, z: 3 }) };
    const tree = forest.chopTargets[0];
    for (let i = 0; i < 15; i++) expect(performToolWork('CHOP', tree.entity, worker, axe)).toBe(true);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/forest/treeFall', expect.any(THREE.Vector3));
    expect(dropLoot).toHaveBeenCalledOnce();
    // Four logs, two blossoms and the guaranteed moonbutterfly; the 50% second one stays away at random 0.9.
    expect(dropLoot.mock.calls[0][0]).toEqual([{ itemId: 'log', count: 4 }, { itemId: 'moon_tree_blossom', count: 2 },
      { itemId: 'moonbutterfly', count: 1 }]);
    expect(tree.model.userData.animationController.currentAnimation).toMatch(/^fall(left|right)_tall$/);
    expect(forest.chopTargets).toEqual([]);
    expect(tree.entity.hasTag('stump')).toBe(true);
    expect(performToolWork('CHOP', tree.entity, worker, axe)).toBe(false);
    expect(forest.exportState(forest.entities[0])).toEqual({ moonTree: { stump: true } });
    expect(axe.components.finiteuses.remaining).toBe(84);

    // The stump persists through unloading and a restored forest.
    player.position.set(500, 0, 0); forest.updateNearby(player.position);
    player.position.set(1, 0, 3); forest.updateNearby(player.position);
    const model = forest.entities[0].model!;
    expect(model.userData.animationController.currentAnimation).toBe('stump_tall');
    expect(forest.chopTargets).toEqual([]);
    const restored = await createMoonTreeForest('/dst/data/anim', {
      positions: [new THREE.Vector3(1, 0, 0)], entityIds: ['tree'], loadRadius: 20,
    });
    try {
      restored.bindWorld({ camera, dropLoot });
      restored.restoreState('tree', { stump: true });
      restored.updateNearby(player.position);
      expect(restored.entities[0].model!.userData.animationController.currentAnimation).toBe('stump_tall');
      expect(restored.chopTargets).toEqual([]);
      expect(restored.exportState(restored.entities[0])).toEqual({ moonTree: { stump: true } });
    } finally { restored.dispose(); }
  } finally { controller.dispose(); forest.dispose(); inventory.dispose(); }
});
