import { collectEquippedItemActions } from '../../stategraphs/src/componentactions';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import { EventEmitter } from '@dontstarve-web/signals';
import type { WorldEvents } from '../../prefab/src/worldContext';
import * as THREE from 'three';
import { createTestArea, useTestTileMap } from './tileMapFixture';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPickupInventory } from './pickupFixture';
import { equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { getAxeLifecycle } from '../../prefab/src/axe';
import { createMoonTreeManager } from '../../prefab/src/moontree';
import { wilsonPlayerInstance, createWilsonPlayer, type WilsonAnimationController } from './playerVisual';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { PlaySound } from '../../prefab/src/sound';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';
import { workTargets } from './workTargets';
import * as CANNON from 'cannon-es';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import { Locomotor } from '../../prefab/src/locomotor';
import { WORLD_SCALE } from '../../prefab/src/tile';

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
  const animation = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
  await animation.setCarryItem('axe');
  const inventory = createPickupInventory();
  inventory.add('axe', 1);
  inventory.transfer(inventorySlotAddress(0), equipmentSlotAddress('hand'), 1);
  const axe = inventory.getEntity(equipmentSlotAddress('hand'))!;
  const camera = new THREE.PerspectiveCamera(), scene = new THREE.Scene();
  const dropLoot = vi.fn();
  const forest = await createMoonTreeManager('/dst/data/anim', { camera, scene, worldEvents: new EventEmitter<WorldEvents>(), tickingarea: area.query, dropLoot });
  forest.spawn('moon_tree', new THREE.Vector3(1, 0, 0), { id: 'tree', transform: { position: [1, 0, 0], rotationY: 0 }, components: {} });
  const world = { player, scene, camera, ground: new THREE.Group(), renderer: { domElement: new EventTarget() } } as unknown as ActionWorldContext;
  const controller = new PlayerController(world, animation, new Locomotor({ position: player.position, velocity: new THREE.Vector3() } as unknown as CANNON.Body, { physicsRadius: .5 * WORLD_SCALE }), inventory.handEquipment);
  const chop = (target: { entity: object }) => controller.DoAction(controller.createAction({ action: 'CHOP', target: target.entity as never, invobject: axe })!);
  const advance = (frames: number) => { for (let i = 0; i < frames; i++) animation.update(1 / 30); };
  try {
    player.position.set(1, 0, 3);
    await area.visit(player.position);
    const [target] = workTargets('CHOP');
    expect(target.entity.hasTag('CHOP_workable')).toBe(true);
    expect(target.entity.components.workable!.GetWorkLeft()).toBe(16);

    // chop_start → chop: the work lands on frame two of the chop loop and wears the axe.
    expect(chop(target)).toBe(true);
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
    expect(chop(workTargets('CHOP')[0])).toBe(true);
    controller.cancel(); advance(60);
    expect(axe.components.finiteuses.remaining).toBe(99);

    // Work, its action projection and the root survive visual unloading.
    const originalModel = target.model, originalInst = target.entity, originalWork = target.entity.components.workable;
    player.position.set(500, 0, 0); await area.visit(player.position);
    expect(prefabInstance(target.model)!.status.peek()).toBe('asleep');
    expect(forest.entities[0].model).toBe(originalModel);
    expect(prefabInstance(originalModel)!.sprite.loaded).toBe(false);
    player.position.set(1, 0, 3); await area.visit(player.position);
    expect(workTargets('CHOP')[0].entity).toBe(originalInst);
    expect(originalInst.components.workable).toBe(originalWork);
    expect(workTargets('CHOP')[0].entity.components.workable!.GetWorkLeft()).toBe(15);

    // The last strike fells the tree away from the chopper and leaves a stump.
    vi.spyOn(Math, 'random').mockReturnValue(.9);
    const worker = { getPosition: () => new THREE.Vector3(1, 0, 3) };
    const tree = workTargets('CHOP')[0];
    for (let i = 0; i < 15; i++) expect(performToolWork('CHOP', tree.entity, worker, axe)).toBe(true);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/forest/treeFall', expect.any(THREE.Vector3));
    expect(dropLoot).toHaveBeenCalledOnce();
    // Four logs, two blossoms and the guaranteed moonbutterfly; the 50% second one stays away at random 0.9.
    expect(dropLoot.mock.calls[0][0]).toEqual([{ itemId: 'log', count: 4 }, { itemId: 'moon_tree_blossom', count: 2 },
      { itemId: 'moonbutterfly', count: 1 }]);
    expect(prefabInstance(tree.model)!.sprite.currentAnimation).toMatch(/^fall(left|right)_tall$/);
    expect(workTargets('CHOP')).toEqual([]);
    expect(tree.isValid()).toBe(false);
    expect(workTargets('DIG')).toHaveLength(1);
    expect(tree.entity.hasTag('CHOP_workable')).toBe(false);
    expect(tree.entity.hasTag('DIG_workable')).toBe(true);
    expect(tree.entity.hasTag('stump')).toBe(true);
    expect(performToolWork('CHOP', tree.entity, worker, axe)).toBe(false);
    expect(forest.exportState(forest.entities[0])).toMatchObject({ moonTree: { stump: true, size: 'tall' }, growable: { stage: 3 } });
    expect(axe.components.finiteuses.remaining).toBe(84);

    // The stump persists through unloading and a restored forest.
    player.position.set(500, 0, 0); await area.visit(player.position);
    player.position.set(1, 0, 3); await area.visit(player.position);
    const model = forest.entities[0].model!;
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('stump_tall');
    expect(workTargets('CHOP')).toEqual([]);
    const restored = await createMoonTreeManager('/dst/data/anim', { camera, scene: new THREE.Scene(), worldEvents: new EventEmitter<WorldEvents>(), tickingarea: area.query, dropLoot });
    try {
      restored.spawn('moon_tree_tall', new THREE.Vector3(1, 0, 0), { id: 'tree', transform: { position: [1, 0, 0], rotationY: 0 }, components: { moonTree: { stump: true } } });
      await area.visit(player.position);
      expect(prefabInstance(restored.entities[0].model!)!.sprite.currentAnimation).toBe('stump_tall');
      expect(workTargets('CHOP')).toEqual([]);
      expect(restored.exportState(restored.entities[0])).toMatchObject({ moonTree: { stump: true, size: 'tall' }, growable: { stage: 3 } });
    } finally { restored.dispose(); }
  } finally { controller.dispose(); forest.dispose(); inventory.dispose(); }
});

it('digs a restored moon tree stump at shovel frame 15 and permanently removes it, preserving other trees and cancelled work', async () => {
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
  await animation.setCarryItem('shovel');
  const inventory = createPickupInventory();
  inventory.add('shovel', 1);
  inventory.transfer(inventorySlotAddress(0), equipmentSlotAddress('hand'), 1);
  const shovel = inventory.getEntity(equipmentSlotAddress('hand'))!;
  const camera = new THREE.PerspectiveCamera(), scene = new THREE.Scene(), dropLoot = vi.fn();
  const forest = await createMoonTreeManager('/dst/data/anim', { camera, scene, worldEvents: new EventEmitter<WorldEvents>(), tickingarea: area.query, dropLoot });
  forest.spawn('moon_tree_tall', new THREE.Vector3(1, 0, 0), { id: 'stump', transform: { position: [1, 0, 0], rotationY: 0 }, components: { moonTree: { stump: true } } });
  forest.spawn('moon_tree_tall', new THREE.Vector3(8, 0, 0), { id: 'standing', transform: { position: [8, 0, 0], rotationY: 0 }, components: {} });
  player.position.set(1, 0, 3);
  await area.visit(player.position);
  const world = { player, scene, camera, ground: new THREE.Group(), renderer: { domElement: new EventTarget() } } as unknown as ActionWorldContext;
  const controller = new PlayerController(world, animation, new Locomotor({ position: player.position, velocity: new THREE.Vector3() } as unknown as CANNON.Body, { physicsRadius: .5 * WORLD_SCALE }), inventory.handEquipment);
  const dig = (target: { entity: object }) => controller.DoAction(controller.createAction({ action: 'DIG', target: target.entity as never, invobject: shovel })!);
  const advance = (frames: number) => { for (let i = 0; i < frames; i++) animation.update(1 / 30); };
  try {
    const target = workTargets('DIG')[0];
    expect(workTargets('CHOP').map(target => target.id)).toEqual(['standing']);
    expect(target.entity!.components.workable!.GetWorkLeft()).toBe(1);
    expect(collectEquippedItemActions(shovel, undefined, target.entity!, false)).toEqual([]);
    expect(collectEquippedItemActions(shovel, undefined, target.entity!, true)).toEqual(['DIG']);
    expect(dig(target)).toBe(true);
    controller.cancel(); advance(60);
    expect(target.isValid()).toBe(true);
    expect(forest.exportState(forest.entities[0])).toMatchObject({ moonTree: { stump: true, size: 'tall' }, growable: { stage: 3 } });
    expect(shovel.components.finiteuses.remaining).toBeUndefined();
    expect(dropLoot).not.toHaveBeenCalled();

    // Unloading a model invalidates its target, retaining logical stump work.
    player.position.set(500, 0, 0); await area.visit(player.position);
    expect(prefabInstance(target.model)!.status.peek()).toBe('asleep');
    expect(target.entity.components.workable!.GetWorkLeft()).toBe(1);
    player.position.set(1, 0, 3); await area.visit(player.position);
    const reloaded = workTargets('DIG')[0], standing = workTargets('CHOP')[0];
    const geometryDispose = vi.spyOn((reloaded.model.children[0].children[0].children[0] as THREE.Mesh).geometry, 'dispose');
    expect(dig(reloaded)).toBe(true);
    while (animation.stategraph.stateName === 'dig_start') animation.update(1 / 30);
    advance(14);
    expect(reloaded.isValid()).toBe(true);
    expect(dropLoot).not.toHaveBeenCalled();
    advance(1);
    expect(dropLoot).toHaveBeenCalledExactlyOnceWith([{ itemId: 'log', count: 2 }], reloaded.position);
    expect(shovel.components.finiteuses.remaining).toBe(24);
    expect(reloaded.entity!.isRemoved).toBe(true);
    expect(reloaded.isValid()).toBe(false);
    expect(reloaded.work()).toBe(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(reloaded.model.parent).toBeNull();
    expect(forest.entities.map(entity => entity.saveId)).toEqual(['standing']);
    expect(forest.entities.map(entity => entity.position)).toEqual([standing.position]);
    expect(forest.renderEntities.map(entity => entity.object)).toEqual([standing.model]);
    expect(workTargets('DIG')).toEqual([]);
    expect(forest.exportState(forest.entities[0])).toMatchObject({ moonTree: { size: 'tall' }, growable: { stage: 3 } });
    player.position.set(500, 0, 0); await area.visit(player.position);
    player.position.set(1, 0, 3); await area.visit(player.position);
    expect(workTargets('DIG')).toEqual([]);
    expect(forest.renderEntities.filter(entry => lookupPrefabInstance(entry.object)?.prefab === 'moon_tree')).toHaveLength(1);
    expect(workTargets('CHOP')[0].entity.components.workable!.GetWorkLeft()).toBe(16);
  } finally { controller.dispose(); forest.dispose(); inventory.dispose(); }
});
