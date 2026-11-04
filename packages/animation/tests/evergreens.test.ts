import type { Growable } from '../../componets/src/growable';
import { advancePlayer } from './playerVisual';
import { playerDoer } from './playerDoer';
import { collectEquippedItemActions } from '../../stategraphs/src/componentactions';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { findActionEntity } from '../../prefab/src/actionEntity';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { createTestArea, useTestTileMap } from './tileMapFixture';
import type * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { evergreenPrefabs } from '../../prefab/src/evergreens';
import { treeWorld } from './treeManagerFixture';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { PlaySound } from '../../prefab/src/sound';
import { createPickupInventory } from './pickupFixture';
import { equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { wilsonPlayerInstance, createWilsonPlayer, type WilsonAnimationController } from './playerVisual';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';
import { workTargets } from './workTargets';
import { drawn } from './worldContentFixture';
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
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup() {
  let spring = false;
  const world = treeWorld(area.query, world => evergreenPrefabs(world, () => .5), { growthDuration: (seconds: number) => seconds * (spring ? .75 : 1) });
  await area.visit(new THREE.Vector3());
  return { ...world, spring: () => { spring = true; } };
}

it('cycles all four source stages and split archives, resets chop work, removes old-tree shelter, and accelerates new spring timers', async () => {
  const s = await setup();
  try {
    const tree = s.prefabs.spawn('evergreen_tall', new THREE.Vector3(3, 0, 0));
    const model = tree.transform.model, work = workTargets('CHOP')[0].entity.components.workable!;
    const growable = (prefabInstance(model)!.components as { growable: Growable }).growable;
    await drawn(model);
    expect((model.children[0].children[0].children[0] as THREE.Mesh).geometry.drawRange.count).toBeGreaterThan(0);
    expect(work.GetWorkLeft()).toBe(15);
    expect(work.WorkedBy({})).toBe(true);
    const timer = growable.state.timer.peek(); s.scheduler.advance(100);
    expect(growable.state.timer.peek()).toBe(timer);
    s.spring(); s.scheduler.advance(1400);
    expect(s.records()[0].components.growable).toEqual({ stage: 4, time: 225 });
    expect(work.GetWorkLeft()).toBe(1);
    expect(workTargets('CHOP')[0].entity.hasTag('shelter')).toBe(false);
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('grow_tall_to_old');
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/forest/treeWilt', tree.position);
    s.scheduler.advance(225);
    expect(work.GetWorkLeft()).toBe(5);
    expect(workTargets('CHOP')[0].entity.hasTag('shelter')).toBe(true);
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('grow_old_to_short');
    s.scheduler.advance(337.5);
    expect(work.GetWorkLeft()).toBe(10);
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('grow_short_to_normal');
    s.scheduler.advance(1125);
    expect(work.GetWorkLeft()).toBe(15);
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('grow_normal_to_tall');
    // An old tree drops one pinecone when chopped, then one log when its stump is dug.
    s.scheduler.advance(1125);
    expect(performToolWork('CHOP', workTargets('CHOP')[0].entity, {})).toBe(true);
    expect(s.dropLoot.mock.calls.at(-1)![0]).toEqual([{ itemId: 'pinecone', count: 1 }]);
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('chop_old');
    expect(s.records()[0].components).toEqual({ evergreen: { stump: true }, growable: { stage: 4 } });
    await new Promise(resolve => setTimeout(resolve, 0)); expect(s.physics.bodies).toEqual([]);
    expect(workTargets('DIG')[0].work()).toBe(true);
    expect(s.dropLoot).toHaveBeenLastCalledWith([{ itemId: 'log', count: 1 }], tree.position);
  } finally { s.dispose(); }
});

it('shows growth settled while unloaded as its final stage without the transition animation', async () => {
  const s = await setup();
  try {
    const tree = s.prefabs.spawn('evergreen_short', new THREE.Vector3(3, 0, 0));
    const root = tree.transform.model, controller = prefabInstance(root)!.sprite, components = (findActionEntity(root)?.components ?? prefabInstance(root)!.components);
    await area.visit(new THREE.Vector3(1000, 0, 1000));
    // A sleeping tree keeps its root and state but leaves the scene graph until its tile wakes.
    expect(tree.transform.model).toBe(root); expect(root.parent).toBeNull();
    expect(lookupPrefabInstance(root)!.status.peek()).toBe('asleep');
    expect((findActionEntity(root)?.components ?? prefabInstance(root)!.components)).toBe(components); expect(controller.loaded).toBe(false);
    s.scheduler.advance(5000);
    await area.visit(new THREE.Vector3(3, 0, 0));
    await drawn(root);
    expect(root.parent).toBe(s.scene);
    expect(lookupPrefabInstance(root)!.status.peek()).toBe('active');
    expect(lookupPrefabInstance(root)!.position).toBe(root.position);
    expect(tree.transform.model).toBe(root); expect(prefabInstance(root)!.sprite).toBe(controller);
    expect((findActionEntity(root)?.components ?? prefabInstance(root)!.components)).toBe(components); expect(controller.loaded).toBe(true);
    expect((prefabInstance(tree.transform.model)!.components as { growable: Growable }).growable.GetStage()).toBeGreaterThan(1);
    expect(prefabInstance(tree.transform.model)!.sprite.currentAnimation).not.toMatch(/^grow_/);
  } finally { s.dispose(); }
});
it('commits source axe work, cancels before impact, preserves logical components while unloaded, and fells and digs a tall tree permanently', async () => {
  const s = await setup(), inventory = createPickupInventory();
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
  await animation.setCarryItem('axe'); inventory.add('axe', 1);
  inventory.transfer(inventorySlotAddress(0), equipmentSlotAddress('hand'), 1);
  const axe = inventory.getEntity(equipmentSlotAddress('hand'))!;
  const world = { player, camera: s.camera, scene: new THREE.Scene(), ground: new THREE.Group(), renderer: { domElement: new EventTarget() } } as unknown as ActionWorldContext;
  const controller = new PlayerController(world, animation.stategraph, new Locomotor({ position: player.position, velocity: new THREE.Vector3() } as unknown as CANNON.Body, { physicsRadius: .5 * WORLD_SCALE }), inventory.handEquipment, playerDoer(player));
  const chop = (target: { entity: object }) => controller.DoAction(controller.createAction({ action: 'CHOP', target: target.entity as never, invobject: axe })!);
  const advance = (frames: number) => { for (let i = 0; i < frames; i++) advancePlayer(animation, 1 / 30); };
  try {
    player.position.set(1, 0, 3);
    const tree = s.prefabs.spawn('evergreen_tall', new THREE.Vector3(1, 0, 0));
    const target = workTargets('CHOP')[0], work = target.entity.components.workable!;
    expect(collectEquippedItemActions(axe, undefined, target.entity, true)).toEqual(['CHOP']);
    expect(chop(target)).toBe(true); controller.cancel(); advance(60);
    expect(work.GetWorkLeft()).toBe(15); expect(axe.components.finiteuses.remaining).toBeUndefined();
    expect(chop(target)).toBe(true);
    while (animation.stategraph.stateName === 'chop_start') advancePlayer(animation, 1 / 30);
    advance(2); expect(work.GetWorkLeft()).toBe(14); expect(axe.components.finiteuses.remaining).toBe(99);
    expect(s.displays.renderEntities.some(entry => entry.object.name === 'pine_needles_chop')).toBe(true);
    await drawn(tree.transform.model);
    const geometry = (tree.transform.model.children[0].children[0].children[0] as THREE.Mesh).geometry;
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    await area.visit(new THREE.Vector3(500, 0, 0));
    expect(prefabInstance(target.model)!.status.peek()).toBe('asleep'); expect(geometryDispose).toHaveBeenCalledOnce();
    expect(s.physics.bodies).toHaveLength(1);
    s.scheduler.advance(10); await area.visit(player.position);
    expect(workTargets('CHOP')[0].entity.components.workable).toBe(work);
    expect(work.GetWorkLeft()).toBe(14);
    const current = workTargets('CHOP')[0];
    expect(work.WorkedBy({ getPosition: () => player.position }, 14)).toBe(true);
    expect(current.isValid()).toBe(false); expect(current.entity.hasTag('CHOP_workable')).toBe(false);
    expect(current.entity.hasTag('DIG_workable')).toBe(true);
    expect(s.dropLoot.mock.calls[0][0]).toEqual([{ itemId: 'log', count: 3 }, { itemId: 'pinecone', count: 2 }]);
    await new Promise(resolve => setTimeout(resolve, 0)); expect(s.physics.bodies).toEqual([]);
    const record = s.records()[0];
    const restored = await setup();
    try {
      const reloaded = restored.prefabs.spawn('evergreen', new THREE.Vector3(...record.transform.position), record);
      expect(restored.records()[0]).toEqual(record);
      expect(prefabInstance(reloaded.transform.model)!.sprite.currentAnimation).toBe('stump_tall');
      const stump = workTargets('DIG', reloaded.transform.model)[0];
      expect(stump.work()).toBe(true); expect(stump.work()).toBe(false);
      restored.scheduler.advance(5000); await area.visit(player.position);
      expect(stump.entity!.isRemoved).toBe(true);
      expect(restored.records()).toEqual([]);
    } finally { restored.dispose(); }
  } finally { controller.dispose(); s.dispose(); inventory.dispose(); }
});

it('preserves an imported decay timer across visual unloading and save/load, then removes the tree at its deadline', async () => {
  const s = await setup();
  try {
    s.prefabs.spawn('evergreen', new THREE.Vector3(), { id: 'imported-burnt',
      transform: { position: [0, 0, 0], rotationY: 0 }, components: { evergreen: { burnt: true },
        evergreenTimer: { timers: { decay: { timeleft: 100, initial_time: 200, paused: false } } } } });
    s.scheduler.advance(25);
    await area.visit(new THREE.Vector3(1000, 0, 1000));
    const [saved] = s.records();
    expect(saved.components.evergreenTimer?.timers.decay.timeleft).toBe(75);
    expect(saved.components.growable).toEqual({ stage: 2 });
    const restored = await setup();
    try {
      restored.prefabs.spawn('evergreen', new THREE.Vector3(), saved);
      restored.scheduler.advance(74);
      expect(restored.records()).toHaveLength(1);
      restored.scheduler.advance(1);
            expect(restored.records()).toEqual([]);
    } finally { restored.dispose(); restored.scheduler.dispose(); }
    s.dispose();
    s.scheduler.advance(100);
    expect(s.records()).toHaveLength(0);
  } finally { s.dispose(); s.scheduler.dispose(); }
});
