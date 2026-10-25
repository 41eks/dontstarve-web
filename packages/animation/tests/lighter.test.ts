import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Burnable } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import { LighterActionController, type LighterTarget } from '../../stategraphs/src/lighter';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import { collectEquippedActions } from '../../stategraphs/src/componentactions';
import type { ActionAnimationController, ActionWorldContext } from '../../stategraphs/src/actionContext';
import { createSignal, type HandEquipment } from '../../signals/src';
import { ItemEntity } from '../../inventory/src';
import { configureTorchEntity } from '../../prefab/src/torch';
import { actionEntity } from '../../prefab/src/actionEntity';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { TREASURE_CHEST_DEFINITION } from '../../prefab/src/treasurechest';
import { COOK_POT_DEFINITION } from '../../prefab/src/cook_pot';
import type { WorldContext } from '../../prefab/src/worldContext';
import { createPickupInventory } from './pickupFixture';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import type { PlacementSaveRecord } from '../../prefab/src/saveRecord';
import type { SavedEntity } from '../../../src/save/types';
import { prefabInstance } from '../../prefab/src/prefabInstance';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function savedEntity(record: PlacementSaveRecord): SavedEntity {
  return { ...record, transform: { ...record.transform, position: [...record.transform.position] } };
}

it('spreads source heat to nearby combustible structures through smoldering before ignition', () => {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  const first = new THREE.Group(), second = new THREE.Group(); second.position.x = 2;
  const source = actionEntity(first, 'treasurechest'), target = actionEntity(second, 'cookpot');
  for (const inst of [source, target]) {
    inst.components.burnable = new Burnable(inst);
    inst.components.propagator = new Propagator(inst, 'small', () => [source, target]);
  }
  source.components.burnable!.Ignite();
  let smoldered = false;
  try {
    for (let step = 0; step < 80 && !target.components.burnable!.IsBurning(); step++) {
      source.components.propagator!.Update(.5);
      target.components.propagator!.Update(.5);
      smoldered ||= target.hasTag('smolder');
      target.components.burnable!.Update(.5);
    }
    expect(smoldered).toBe(true);
    expect(target.components.burnable!.IsBurning()).toBe(true);
    expect(target.hasTag('smolder')).toBe(false);
    source.components.burnable!.Extinguish();
    const before = target.components.propagator!.currentheat.peek();
    source.components.propagator!.Update(2); target.components.propagator!.Update(2);
    expect(target.components.propagator!.currentheat.peek()).toBeLessThan(before);
  } finally {
    for (const inst of [source, target]) { inst.components.burnable!.dispose(); inst.components.propagator!.dispose(); }
  }
});

it('walks to the foot, cancels on unequip and commits LIGHT once at frame 13 without spending extra torch fuel', () => {
  vi.stubGlobal('window', new EventTarget());
  const scene = new THREE.Scene(), model = new THREE.Group(), player = new THREE.Group();
  model.position.set(20, 8, 0); scene.add(model);
  model.userData.getGroundPosition = () => new THREE.Vector3(20, 0, 0);
  const target = Object.assign(actionEntity(model, 'treasurechest'), { model }) as LighterTarget;
  const burnable = new Burnable(actionEntity(model, 'treasurechest'));
  target.components.burnable = burnable;
  const torch = new ItemEntity({ itemId: 'torch', count: 1, remainingFuel: 30 });
  configureTorchEntity(torch);
  const equipment = { itemId: 'torch', EQUIPSLOTS: 'HANDS' as const, entity: torch };
  const hand = createSignal<HandEquipment | null>(equipment);
  const graph = new WilsonStateGraph({ playAnimation: () => 1, playSound() {}, setCasting() {}, onStateChanged() {} });
  const animation = { stategraph: graph, cancelEmote() {}, setFacing: vi.fn() } as unknown as ActionAnimationController;
  const locomotor = { destination: undefined, goToPoint: vi.fn(() => true), stop: vi.fn() };
  const world = { scene, player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(), cameraFacing: createSignal(8), cameraHeading: createSignal(45),
    renderer: { domElement: new EventTarget() } } as unknown as ActionWorldContext;
  const controller = new LighterActionController(world, animation, locomotor, hand);
  const started = vi.fn(); player.addEventListener('onstartedfire' as never, started);
  try {
    expect(collectEquippedActions(torch, target, false)).toEqual([]);
    expect(controller.request(target)).toBe(true); controller.update();
    expect(locomotor.goToPoint).toHaveBeenCalledWith(new THREE.Vector3(16.8, 0, 0));
    player.position.x = 17; controller.update();
    expect(graph.stateName).toBe('catchonfire'); expect(graph.hasStateTag('igniting')).toBe(true);
    graph.update(12 / 30); expect(burnable.IsBurning()).toBe(false);
    hand.set(null); graph.update(2);
    expect(burnable.IsBurning()).toBe(false); expect(started).not.toHaveBeenCalled();
    hand.set(equipment); controller.request(target); controller.update();
    graph.update(12 / 30); expect(burnable.IsBurning()).toBe(false);
    graph.update(1 / 30); expect(burnable.IsBurning()).toBe(true);
    graph.update(3); expect(started).toHaveBeenCalledTimes(1);
    expect(torch.components.fueled.remaining).toBe(30);
    expect(target.hasTag('fire')).toBe(true); expect(target.hasTag('canlight')).toBe(false);
    expect(controller.request(target)).toBe(false);
    burnable.Extinguish(); target.addTag('fueldepleted'); expect(controller.request(target)).toBe(false);
    target.addTag('burnableignorefuel'); expect(controller.request(target)).toBe(true);
    controller.cancel(); target.addTag('INLIMBO'); expect(controller.request(target)).toBe(false);
  } finally { controller.dispose(); burnable.dispose(); torch.destroy(); }
});

function structureFixture() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const inventory = createPickupInventory(), scene = new THREE.Scene(), dropLoot = vi.fn();
  const world: WorldContext = { scene, player: new THREE.Group(), camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(), cameraFacing: createSignal(8), cameraHeading: createSignal(45),
    renderer: { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer, dropLoot,
    registerContainer: (id, container, saved) => inventory.registerContainer(id, container, saved),
    unregisterContainer: (id, container) => inventory.unregisterContainer(id, container),
  };
  const placement = new AnimatedBuildingPlacement(world, { treasurechest: TREASURE_CHEST_DEFINITION, cookpot: COOK_POT_DEFINITION }, () => false);
  return { inventory, scene, placement, dropLoot };
}

it('keeps burning art through reskin, exports source burnt state, restores a chest and drops live contents once at its saved foot', async () => {
  const { inventory, scene, placement } = structureFixture();
  const restoredInventory = createPickupInventory();
  const restoredPlacement = new AnimatedBuildingPlacement({ scene: new THREE.Scene(), player: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(), cameraFacing: createSignal(8), cameraHeading: createSignal(45), renderer: { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer,
    registerContainer: (id, container, saved) => restoredInventory.registerContainer(id, container, saved),
    unregisterContainer: (id, container) => restoredInventory.unregisterContainer(id, container),
  } as WorldContext, { treasurechest: TREASURE_CHEST_DEFINITION }, () => false);
  const dropped: ItemEntity[] = [], stop = inventory.subscribeDropped(entity => dropped.push(entity));
  const stopRestored = restoredInventory.subscribeDropped(entity => dropped.push(entity));
  try {
    expect((await executeDebugCommand('c_give("torch");c_spawn("treasurechest")', inventory, async id => {
      if (id !== 'treasurechest') return false;
      await placement.spawnFromSave(id, { id: 'burning_chest', transform: { position: [3, 0, -6], rotationY: 0 }, components: {
        building: { state: 'closed' }, container: { slotCount: 9, slots: [{ slotKey: '0', item: {
          entityId: 'preserved_food', itemId: 'seeds', count: 3, freshnessPercent: .6,
        } }] },
      } }); return true;
    })).ok).toBe(true);
    const model = placement.renderEntities[0].object;
    const burnable = model.userData.components.burnable as Burnable;
    const burntSignal = model.userData.burntSignal;
    const burningSignal = model.userData.burningSignal;
    const notified = vi.fn(() => {
      expect(model.userData.components.container).toBeUndefined();
      expect(model.userData.animationController.currentAnimation).toBe('burnt');
    });
    const stopBurnt = burntSignal.subscribe(notified);
    expect(burntSignal.set).toBeUndefined(); expect(burningSignal.set).toBeUndefined();
    const item = inventory.getEntity({ containerId: 'world:treasurechest:burning_chest', slotKey: '0' })!;
    const before = item.snapshot();
    burnable.Ignite(); placement.update(3);
    expect(scene.children.filter(child => child.name === 'fire')).toHaveLength(1);
    const prepared = await placement.reskinTargets[0].prepareNextSkin();
    expect(prepared.apply()).toBe(true); prepared.dispose();
    expect(model.userData.components.burnable).toBe(burnable);
    expect(model.userData.burntSignal).toBe(burntSignal);
    expect(model.userData.burningSignal).toBe(burningSignal);
    expect(burningSignal.peek()).toBe(true); expect(notified).not.toHaveBeenCalled();
    expect(scene.children.filter(child => child.name === 'fire')).toHaveLength(1);
    const record = placement.exportRecords()[0].record;
    expect(record.components.building).toMatchObject({ burnt: true, skinId: 'treasurechest_ancient' });
    expect(record.transform.position).toEqual([3, 0, -6]);
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG), {
        entities: { treasurechest: [savedEntity(record)] }, inventory: inventory.exportState(), elapsedSeconds: 3,
        playerTransform: { position: [3, 0, -6], rotationY: 0 },
      }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG);
    // Complete this session before restoring a new session from the exported document.
    placement.update(7);
    expect(prefabInstance(model)!.listTags()).toContain('burnt');
    expect(model.userData.animationController.currentAnimation).toBe('burnt');
    expect(model.userData.components.container).toBeUndefined();
    expect(scene.children.some(child => child.name === 'fire')).toBe(false);
    expect(burntSignal.peek()).toBe(true); expect(burningSignal.peek()).toBe(false);
    expect(notified).toHaveBeenCalledExactlyOnceWith(true, false);
    stopBurnt();
    expect(dropped).toEqual([item]); expect(item.snapshot()).toEqual(before);
    expect(item.transform.position.toArray()).toEqual([3, 0, -6]);
    const restored = await restoredPlacement.spawnFromSave('treasurechest', saved.world.entities.treasurechest[0]);
    expect(restored.userData.instance?.entityId).toBe('burning_chest');
    expect(restored.userData.instance?.skinId).toBe(record.components.building!.skinId);
    expect(restored.userData.animationController.currentAnimation).toBe('burnt');
    expect(restored.userData.burntSignal.peek()).toBe(true);
    expect(restored.userData.components.burnable).toBeUndefined();
    expect(restored.userData.components.workable.GetWorkLeft()).toBe(1);
    expect(dropped).toHaveLength(2);
    expect(dropped[1].snapshot()).toEqual(before);
    expect(dropped[1].transform.position.toArray()).toEqual([3, 0, -6]);
    const burnt = restoredPlacement.exportRecords()[0].record;
    expect(burnt.components.container).toBeUndefined();
    expect(deserializeSave(serializeSave(saved, { entities: { treasurechest: [savedEntity(burnt)] }, inventory: restoredInventory.exportState(), elapsedSeconds: 10,
      playerTransform: { position: [3, 0, -6], rotationY: 0 } }, SAVE_CATALOG), SAVE_CATALOG).world.entities.treasurechest[0]).toEqual(burnt);
  } finally { stop(); stopRestored(); placement.dispose(); restoredPlacement.dispose(); inventory.dispose(); restoredInventory.dispose(); }
});

it('burns a cooking pot after 20 seconds, drops the product and disables cooking and container interactions', async () => {
  const { inventory, placement, dropLoot } = structureFixture();
  try {
    const model = await placement.spawnFromSave('cookpot', { id: 'burning_pot', transform: { position: [30, 0, 8], rotationY: 0 },
      components: { building: { state: 'closed', skinId: 'cookpot_cauldron' }, stewer: { product: 'meatballs', phase: 'cooking', remainingSeconds: 15 } } });
    model.userData.components.burnable.Ignite();
    placement.update(19.9);
    expect(prefabInstance(model)!.listTags()).not.toContain('burnt'); expect(dropLoot).not.toHaveBeenCalled();
    placement.update(.1);
    expect(model.userData.animationController.currentAnimation).toBe('burnt');
    expect(model.userData.components.stewer).toBeUndefined(); expect(model.userData.components.container).toBeUndefined();
    expect(placement.performContainerAction(model, 'COOK', {})).toBe(false);
    expect(dropLoot).toHaveBeenCalledExactlyOnceWith([{ itemId: 'meatballs', count: 1 }], new THREE.Vector3(30, 0, 8));
    placement.update(30); expect(dropLoot).toHaveBeenCalledTimes(1);
    const record = placement.exportRecords()[0].record;
    expect(record.components.building).toMatchObject({ burnt: true, skinId: 'cookpot_cauldron' });
    expect(record.components.stewer).toBeUndefined();
    placement.hammerTargets[0].playHit();
    expect(model.parent).toBeNull(); expect(placement.exportRecords()).toEqual([]);
  } finally { placement.dispose(); inventory.dispose(); }
});
