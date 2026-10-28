import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import { EventEmitter } from '@dontstarve-web/signals';
import type { WorldEvents } from '../../prefab/src/worldContext';
import * as THREE from 'three';
import { createTestArea, useTestTileMap } from './tileMapFixture';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEvergreenForest } from '../../prefab/src/evergreens';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork, collectEquippedActions } from '../../stategraphs/src/componentactions';
import { PlaySound } from '../../prefab/src/sound';
import { createPickupInventory } from './pickupFixture';
import { equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { PickaxeActionController } from '../../stategraphs/src/pickaxe';
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
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup() {
  const scheduler = new GameTimeScheduler(), camera = new THREE.PerspectiveCamera(), physics = new CANNON.World();
  const dropLoot = vi.fn(); let spring = false;
  const forest = await createEvergreenForest('/dst/data/anim', { camera, scene: new THREE.Scene(), physics, scheduler, dropLoot, worldEvents: new EventEmitter<WorldEvents>(), tickingarea: area.query,
    growthDuration: seconds => seconds * (spring ? .75 : 1) }, () => .5);
  await area.visit(new THREE.Vector3());
  return { forest, scheduler, camera, physics, dropLoot, spring: () => { spring = true; } };
}

it('cycles all four source stages and split archives, resets chop work, removes old-tree shelter, and accelerates new spring timers', async () => {
  const s = await setup();
  try {
    const tree = s.forest.spawn('evergreen_tall', new THREE.Vector3(3, 0, 0));
    const model = tree.model!, work = s.forest.chopTargets[0].entity.components.workable!;
    const growable = model.userData.components.growable;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect((model.children[0].children[0].children[0] as THREE.Mesh).geometry.drawRange.count).toBeGreaterThan(0);
    expect(work.GetWorkLeft()).toBe(15);
    expect(work.WorkedBy({})).toBe(true);
    const timer = growable.state.timer.peek(); s.scheduler.advance(100);
    expect(growable.state.timer.peek()).toBe(timer);
    s.spring(); s.scheduler.advance(1400);
    expect(s.forest.exportRecords()[0].components.growable).toEqual({ stage: 4, time: 225 });
    expect(work.GetWorkLeft()).toBe(1);
    expect(s.forest.chopTargets[0].entity.hasTag('shelter')).toBe(false);
    expect(model.userData.animationController.currentAnimation).toBe('grow_tall_to_old');
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/forest/treeWilt', tree.position);
    s.scheduler.advance(225);
    expect(work.GetWorkLeft()).toBe(5);
    expect(s.forest.chopTargets[0].entity.hasTag('shelter')).toBe(true);
    expect(model.userData.animationController.currentAnimation).toBe('grow_old_to_short');
    s.scheduler.advance(337.5);
    expect(work.GetWorkLeft()).toBe(10);
    expect(model.userData.animationController.currentAnimation).toBe('grow_short_to_normal');
    s.scheduler.advance(1125);
    expect(work.GetWorkLeft()).toBe(15);
    expect(model.userData.animationController.currentAnimation).toBe('grow_normal_to_tall');
    // An old tree drops one pinecone when chopped, then one log when its stump is dug.
    s.scheduler.advance(1125);
    expect(performToolWork('CHOP', s.forest.chopTargets[0].entity, {})).toBe(true);
    expect(s.dropLoot.mock.calls.at(-1)![0]).toEqual([{ itemId: 'pinecone', count: 1 }]);
    expect(model.userData.animationController.currentAnimation).toBe('chop_old');
    expect(s.forest.exportRecords()[0].components).toEqual({ evergreen: { stump: true }, growable: { stage: 4 } });
    await new Promise(resolve => setTimeout(resolve, 0)); expect(s.physics.bodies).toEqual([]);
    expect(s.forest.digTargets[0].dig()).toBe(true);
    expect(s.dropLoot).toHaveBeenLastCalledWith([{ itemId: 'log', count: 1 }], tree.position);
  } finally { s.forest.dispose(); }
});

it('shows growth settled while unloaded as its final stage without the transition animation', async () => {
  const s = await setup();
  try {
    const tree = s.forest.spawn('evergreen_short', new THREE.Vector3(3, 0, 0));
    const root = tree.model, controller = root.userData.animationController, components = root.userData.components;
    await area.visit(new THREE.Vector3(1000, 0, 1000));
    // A sleeping tree keeps its root and state but leaves the scene graph until its tile wakes.
    expect(tree.model).toBe(root); expect(root.parent).toBeNull();
    expect(lookupPrefabInstance(root)!.status.peek()).toBe('asleep');
    expect(root.userData.components).toBe(components); expect(controller.loaded).toBe(false);
    expect(root.userData.removed).not.toBe(true);
    s.scheduler.advance(5000);
    await area.visit(new THREE.Vector3(3, 0, 0));
    expect(root.parent).toBe(s.forest.group);
    expect(lookupPrefabInstance(root)!.status.peek()).toBe('active');
    expect(lookupPrefabInstance(root)!.position).toBe(root.position);
    expect(tree.model).toBe(root); expect(root.userData.animationController).toBe(controller);
    expect(root.userData.components).toBe(components); expect(controller.loaded).toBe(true);
    expect(tree.model!.userData.components.growable.GetStage()).toBeGreaterThan(1);
    expect(tree.model!.userData.animationController.currentAnimation).not.toMatch(/^grow_/);
  } finally { s.forest.dispose(); }
});
it('commits source axe work, cancels before impact, preserves logical components while unloaded, and fells and digs a tall tree permanently', async () => {
  const s = await setup(), inventory = createPickupInventory();
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = player.userData.animationController as WilsonAnimationController;
  await animation.setCarryItem('axe'); inventory.add('axe', 1);
  inventory.transfer(inventorySlotAddress(0), equipmentSlotAddress('hand'), 1);
  const axe = inventory.getEntity(equipmentSlotAddress('hand'))!;
  const world = { player, camera: s.camera, scene: new THREE.Scene(), ground: new THREE.Group(), renderer: { domElement: new EventTarget() } } as unknown as ActionWorldContext;
  const controller = new PickaxeActionController(world, animation, { goToPoint: vi.fn(() => true), stop: vi.fn(), destination: undefined },
    inventory.handEquipment, () => s.forest.chopTargets, undefined, 'CHOP');
  const advance = (frames: number) => { for (let i = 0; i < frames; i++) animation.update(1 / 30); };
  try {
    player.position.set(1, 0, 3);
    const tree = s.forest.spawn('evergreen_tall', new THREE.Vector3(1, 0, 0));
    const target = s.forest.chopTargets[0], work = target.entity.components.workable!;
    expect(collectEquippedActions(axe, target.entity, true)).toEqual(['CHOP']);
    expect(controller.request(target)).toBe(true); controller.update(0); controller.cancel(); advance(60);
    expect(work.GetWorkLeft()).toBe(15); expect(axe.components.finiteuses.remaining).toBeUndefined();
    expect(controller.request(target)).toBe(true); controller.update(0);
    while (animation.stategraph.stateName === 'chop_start') animation.update(1 / 30);
    advance(2); expect(work.GetWorkLeft()).toBe(14); expect(axe.components.finiteuses.remaining).toBe(99);
    expect(s.forest.renderEntities.some(entry => entry.object.name === 'pine_needles_chop')).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    const geometry = (tree.model!.children[0].children[0].children[0] as THREE.Mesh).geometry;
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    await area.visit(new THREE.Vector3(500, 0, 0));
    expect(target.isValid()).toBe(false); expect(geometryDispose).toHaveBeenCalledOnce();
    expect(s.physics.bodies).toHaveLength(1);
    s.scheduler.advance(10); await area.visit(player.position);
    expect(s.forest.chopTargets[0].entity.components.workable).toBe(work);
    expect(work.GetWorkLeft()).toBe(14);
    const current = s.forest.chopTargets[0];
    expect(work.WorkedBy({ getPosition: () => player.position }, 14)).toBe(true);
    expect(current.isValid()).toBe(false); expect(current.entity.hasTag('CHOP_workable')).toBe(false);
    expect(current.entity.hasTag('DIG_workable')).toBe(true);
    expect(s.dropLoot.mock.calls[0][0]).toEqual([{ itemId: 'log', count: 3 }, { itemId: 'pinecone', count: 2 }]);
    await new Promise(resolve => setTimeout(resolve, 0)); expect(s.physics.bodies).toEqual([]);
    const record = s.forest.exportRecords()[0];
    const restored = await setup();
    try {
      const reloaded = restored.forest.spawn('evergreen', new THREE.Vector3(...record.transform.position), record);
      expect(restored.forest.exportRecords()[0]).toEqual(record);
      expect(reloaded.model!.userData.animationController.currentAnimation).toBe('stump_tall');
      const stump = restored.forest.digTargets[0];
      expect(stump.dig()).toBe(true); expect(stump.dig()).toBe(false);
      restored.scheduler.advance(5000); await area.visit(player.position);
      expect(restored.forest.entities).toEqual([]); expect(stump.entity!.isRemoved).toBe(true);
      expect(restored.forest.exportRecords()).toEqual([]);
    } finally { restored.forest.dispose(); }
  } finally { controller.dispose(); s.forest.dispose(); inventory.dispose(); }
});

it('preserves an imported decay timer across visual unloading and save/load, then removes the tree at its deadline', async () => {
  const s = await setup();
  try {
    s.forest.spawn('evergreen', new THREE.Vector3(), { id: 'imported-burnt',
      transform: { position: [0, 0, 0], rotationY: 0 }, components: { evergreen: { burnt: true },
        evergreenTimer: { timers: { decay: { timeleft: 100, initial_time: 200, paused: false } } } } });
    s.scheduler.advance(25);
    await area.visit(new THREE.Vector3(1000, 0, 1000));
    const [saved] = s.forest.exportRecords();
    expect(saved.components.evergreenTimer?.timers.decay.timeleft).toBe(75);
    expect(saved.components.growable).toEqual({ stage: 2 });
    const restored = await setup();
    try {
      restored.forest.spawn('evergreen', new THREE.Vector3(), saved);
      restored.scheduler.advance(74);
      expect(restored.forest.entities).toHaveLength(1);
      restored.scheduler.advance(1);
      expect(restored.forest.entities).toHaveLength(0);
      expect(restored.forest.exportRecords()).toEqual([]);
    } finally { restored.forest.dispose(); restored.scheduler.dispose(); }
    s.forest.dispose();
    s.scheduler.advance(100);
    expect(s.forest.entities).toHaveLength(0);
  } finally { s.forest.dispose(); s.scheduler.dispose(); }
});
