import { EventEmitter } from '@dontstarve-web/signals';
import type { WorldEvents } from '../../prefab/src/worldContext';
import * as THREE from 'three';
import { createTestArea, useTestTileMap } from './tileMapFixture';
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
import { ShovelActionController } from '../../stategraphs/src/shovel';
import { collectEquippedActions } from '../../stategraphs/src/componentactions';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';

useTestTileMap();
let area: ReturnType<typeof createTestArea>;
beforeEach(async () => { area = createTestArea(); await area.ready; });
afterEach(() => area.dispose());

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
    positions: [new THREE.Vector3(1, 0, 0)], entityIds: ['tree'],
  });
  scene.add(forest.group);
  forest.bindWorld({ camera, scene: new THREE.Scene(), worldEvents: new EventEmitter<WorldEvents>(), tickingarea: area.query, dropLoot });
  const world = { player, scene, camera, ground: new THREE.Group(), renderer: { domElement: new EventTarget() } } as unknown as ActionWorldContext;
  const locomotor = { goToPoint: vi.fn(() => true), stop: vi.fn(), destination: undefined };
  const controller = new PickaxeActionController(world, animation, locomotor, inventory.handEquipment, () => forest.chopTargets, undefined, 'CHOP');
  const advance = (frames: number) => { for (let i = 0; i < frames; i++) animation.update(1 / 30); };
  try {
    player.position.set(1, 0, 3);
    await area.visit(player.position, forest);
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
    player.position.set(500, 0, 0); await area.visit(player.position, forest);
    expect(forest.chopTargets).toEqual([]);
    player.position.set(1, 0, 3); await area.visit(player.position, forest);
    expect(forest.chopTargets[0].entity.components.workable!.GetWorkLeft()).toBe(15);

    // The last strike fells the tree away from the chopper and leaves a stump.
    vi.spyOn(Math, 'random').mockReturnValue(.9);
    const worker = { getPosition: () => new THREE.Vector3(1, 0, 3) };
    const tree = forest.chopTargets[0];
    for (let i = 0; i < 15; i++) expect(performToolWork('CHOP', tree.entity, worker, axe)).toBe(true);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/forest/treeFall', expect.any(THREE.Vector3));
    expect(dropLoot).toHaveBeenCalledOnce();
    // Four logs, two blossoms and the guaranteed moonbutterfly; the 50% second one stays away at random 0.9.
    expect(dropLoot.mock.calls[0][0]).toEqual([{ itemId: 'log', count: 4 }, { itemId: 'moon_tree_blossom', count: 2 },
      { itemId: 'moonbutterfly', count: 1 }]);
    expect(tree.model.userData.animationController.currentAnimation).toMatch(/^fall(left|right)_tall$/);
    expect(forest.chopTargets).toEqual([]);
    expect(tree.isValid()).toBe(false);
    expect(forest.digTargets).toHaveLength(1);
    expect(tree.entity.hasTag('CHOP_workable')).toBe(false);
    expect(tree.entity.hasTag('DIG_workable')).toBe(true);
    expect(tree.entity.hasTag('stump')).toBe(true);
    expect(performToolWork('CHOP', tree.entity, worker, axe)).toBe(false);
    expect(forest.exportState(forest.entities[0])).toEqual({ moonTree: { stump: true, size: 'tall' }, growable: { stage: 3 } });
    expect(axe.components.finiteuses.remaining).toBe(84);

    // The stump persists through unloading and a restored forest.
    player.position.set(500, 0, 0); await area.visit(player.position, forest);
    player.position.set(1, 0, 3); await area.visit(player.position, forest);
    const model = forest.entities[0].model!;
    expect(model.userData.animationController.currentAnimation).toBe('stump_tall');
    expect(forest.chopTargets).toEqual([]);
    const restored = await createMoonTreeForest('/dst/data/anim', {
      positions: [new THREE.Vector3(1, 0, 0)], entityIds: ['tree'],
    });
    try {
      restored.bindWorld({ camera, scene: new THREE.Scene(), worldEvents: new EventEmitter<WorldEvents>(), tickingarea: area.query, dropLoot });
      restored.restoreState('tree', { stump: true });
      await area.visit(player.position, restored);
      expect(restored.entities[0].model!.userData.animationController.currentAnimation).toBe('stump_tall');
      expect(restored.chopTargets).toEqual([]);
      expect(restored.exportState(restored.entities[0])).toEqual({ moonTree: { stump: true, size: 'tall' }, growable: { stage: 3 } });
    } finally { restored.dispose(); }
  } finally { controller.dispose(); forest.dispose(); inventory.dispose(); }
});

it('digs a restored moon tree stump at shovel frame 15 and permanently removes it, preserving other trees and cancelled work', async () => {
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = player.userData.animationController as WilsonAnimationController;
  await animation.setCarryItem('shovel');
  const inventory = createPickupInventory();
  inventory.add('shovel', 1);
  inventory.transfer(inventorySlotAddress(0), equipmentSlotAddress('hand'), 1);
  const shovel = inventory.getEntity(equipmentSlotAddress('hand'))!;
  const camera = new THREE.PerspectiveCamera(), scene = new THREE.Scene(), dropLoot = vi.fn();
  const forest = await createMoonTreeForest('/dst/data/anim', {
    positions: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(8, 0, 0)],
    entityIds: ['stump', 'standing'],
  });
  forest.bindWorld({ camera, scene: new THREE.Scene(), worldEvents: new EventEmitter<WorldEvents>(), tickingarea: area.query, dropLoot });
  forest.restoreState('stump', { stump: true });
  player.position.set(1, 0, 3);
  await area.visit(player.position, forest);
  const world = { player, scene, camera, ground: new THREE.Group(), renderer: { domElement: new EventTarget() } } as unknown as ActionWorldContext;
  const locomotor = { goToPoint: vi.fn(() => true), stop: vi.fn(), destination: undefined };
  const controller = new ShovelActionController(world, animation, locomotor, inventory.handEquipment, () => forest.digTargets);
  const advance = (frames: number) => { for (let i = 0; i < frames; i++) animation.update(1 / 30); };
  try {
    const target = forest.digTargets[0];
    expect(forest.chopTargets.map(target => target.id)).toEqual(['standing']);
    expect(target.entity!.components.workable!.GetWorkLeft()).toBe(1);
    expect(collectEquippedActions(shovel, target.entity!, false)).toEqual([]);
    expect(collectEquippedActions(shovel, target.entity!, true)).toEqual(['DIG']);
    expect(controller.request(target)).toBe(true); controller.update(0);
    controller.cancel(); advance(60);
    expect(target.isValid()).toBe(true);
    expect(forest.exportState(forest.entities[0])).toEqual({ moonTree: { stump: true, size: 'tall' }, growable: { stage: 3 } });
    expect(shovel.components.finiteuses.remaining).toBeUndefined();
    expect(dropLoot).not.toHaveBeenCalled();

    // Unloading a model invalidates its target, retaining logical stump work.
    player.position.set(500, 0, 0); await area.visit(player.position, forest);
    expect(target.isValid()).toBe(false);
    expect(target.dig()).toBe(false);
    player.position.set(1, 0, 3); await area.visit(player.position, forest);
    const reloaded = forest.digTargets[0], standing = forest.chopTargets[0];
    const geometryDispose = vi.spyOn((reloaded.model.children[0].children[0] as THREE.Mesh).geometry, 'dispose');
    expect(controller.request(reloaded)).toBe(true); controller.update(0);
    while (animation.stategraph.stateName === 'dig_start') animation.update(1 / 30);
    advance(14);
    expect(reloaded.isValid()).toBe(true);
    expect(dropLoot).not.toHaveBeenCalled();
    advance(1);
    expect(dropLoot).toHaveBeenCalledExactlyOnceWith([{ itemId: 'log', count: 2 }], reloaded.position);
    expect(shovel.components.finiteuses.remaining).toBe(24);
    expect(reloaded.entity!.isRemoved).toBe(true);
    expect(reloaded.isValid()).toBe(false);
    expect(reloaded.dig()).toBe(false);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(reloaded.model.parent).toBeNull();
    expect(forest.entities.map(entity => entity.saveId)).toEqual(['standing']);
    expect(forest.positions).toEqual([standing.position]);
    expect(forest.renderEntities.map(entity => entity.object)).toEqual([standing.model]);
    expect(forest.digTargets).toEqual([]);
    expect(forest.exportState(forest.entities[0])).toMatchObject({ moonTree: { size: 'tall' }, growable: { stage: 3 } });
    player.position.set(500, 0, 0); await area.visit(player.position, forest);
    player.position.set(1, 0, 3); await area.visit(player.position, forest);
    expect(forest.digTargets).toEqual([]);
    expect(forest.activeEntities.size).toBe(1);
    expect(forest.chopTargets[0].entity.components.workable!.GetWorkLeft()).toBe(16);
  } finally { controller.dispose(); forest.dispose(); inventory.dispose(); }
});
