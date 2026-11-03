import { collectEquippedItemActions } from '../../stategraphs/src/componentactions';
import { findActionEntity } from '../../prefab/src/actionEntity';
import * as THREE from 'three';
import { withEntity } from './entityFixture';
import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Burnable } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import { Locomotor } from '../../prefab/src/locomotor';
import { WORLD_SCALE } from '../../prefab/src/tile';
import * as CANNON from 'cannon-es';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';
import { createSignal, EventEmitter, type HandEquipment } from '../../signals/src';
import { ItemEntity } from '../../inventory/src';
import { TORCH_FUEL, configureTorchEntity } from '../../prefab/src/torch';
import { actionEntity } from '../../prefab/src/actionEntity';
import { managedBuildings } from './managedBuildings';
import type { PlaceableBuildingInteractionChange } from '../../../src/placeableBuilding';
import type { WorldContext } from '../../prefab/src/worldContext';
import { createPickupInventory } from './pickupFixture';
import type { PlacementSaveRecord } from '../../prefab/src/saveRecord';
import type { SavedEntity } from '../../../src/save/types';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { workTargets } from './workTargets';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function savedEntity(record: PlacementSaveRecord): SavedEntity {
  return { ...record, transform: { ...record.transform, position: [...record.transform.position] } };
}

it('spreads source heat to nearby combustible structures through smoldering before ignition', () => {
  vi.spyOn(Math, 'random').mockReturnValue(.5);
  const first = withEntity(new THREE.Group(), 'treasurechest'), second = withEntity(new THREE.Group(), 'cookpot'); second.position.x = 2;
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
  const scene = new THREE.Scene(), model = withEntity(new THREE.Group(), 'treasurechest'), player = new THREE.Group();
  model.position.set(20, 0, 0); scene.add(model);
  const target = actionEntity(model, 'treasurechest');
  const burnable = new Burnable(actionEntity(model, 'treasurechest'));
  target.components.burnable = burnable;
  const torch = new ItemEntity({ itemId: 'torch', count: 1, remainingFuel: 30 });
  torch.configure({ maxFuel: TORCH_FUEL, configureEntity: configureTorchEntity });
  const equipment = { itemId: 'torch', EQUIPSLOTS: 'HANDS' as const, entity: torch };
  const hand = createSignal<HandEquipment | null>(equipment);
  const graph = new WilsonStateGraph({ playAnimation: () => 1, playSound() {}, onStateChanged() {} });
  const animation = { stategraph: graph };
  const locomotor = new Locomotor({ position: player.position, velocity: new THREE.Vector3() } as unknown as CANNON.Body,
    { physicsRadius: .5 * WORLD_SCALE });
  const world = { scene, player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(), cameraFacing: createSignal(8), cameraHeading: createSignal(45),
    renderer: { domElement: new EventTarget() } } as unknown as ActionWorldContext;
  // The player inst: LIGHT pushes onstartedfire on it.
  const playerEvents = new EventEmitter<Record<string, unknown>>();
  const doer = { hasTag: (tag: string) => tag === 'player', getPosition: () => player.position,
    PushEvent: (name: string, data: unknown) => playerEvents.emit(name, data) };
  const playerController = new PlayerController(world, animation.stategraph, locomotor, hand, doer as never, () => false);
  // EQUIPPED.lighter on the right button, then DoAction.
  const controller = {
    request: (inst: typeof target) => collectEquippedItemActions(torch, doer, inst, true).includes('LIGHT')
      && playerController.DoAction(playerController.createAction({ action: 'LIGHT', target: inst, invobject: torch })!),
    update: () => locomotor.update(16, 1 / 30),
    cancel: () => playerController.cancel(),
    dispose: () => playerController.dispose(),
  };
  const started = vi.fn(); playerEvents.on('onstartedfire', started);
  try {
    expect(collectEquippedItemActions(torch, undefined, target, false)).toEqual([]);
    expect(controller.request(target)).toBe(true); controller.update();
    expect(locomotor.bufferedAction).toBeDefined();
    player.position.x = 18.1; controller.update();
    expect(graph.stateName).toBe('catchonfire'); expect(graph.hasStateTag('igniting')).toBe(true);
    graph.update(12 / 30); expect(burnable.IsBurning()).toBe(false);
    hand.set(null); graph.update(2);
    expect(burnable.IsBurning()).toBe(false); expect(started).not.toHaveBeenCalled();
    hand.set(equipment); controller.request(target); controller.update();
    graph.update(12 / 30); expect(burnable.IsBurning()).toBe(false);
    graph.update(1 / 30); expect(burnable.IsBurning()).toBe(true);
    graph.update(3); expect(started).toHaveBeenCalledTimes(1);
    expect(torch.components.fueled!.currentfuel).toBe(30);
    expect(target.hasTag('fire')).toBe(true); expect(target.hasTag('canlight')).toBe(false);
    expect(controller.request(target)).toBe(false);
    burnable.Extinguish(); target.addTag('fueldepleted'); expect(controller.request(target)).toBe(false);
    target.addTag('burnableignorefuel'); expect(controller.request(target)).toBe(true);
    controller.cancel(); target.addTag('INLIMBO'); expect(controller.request(target)).toBe(false);
  } finally { controller.dispose(); burnable.dispose(); torch.destroy(); }
});

function structureFixture(onInteraction?: (change: PlaceableBuildingInteractionChange) => void) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const inventory = createPickupInventory(), scene = new THREE.Scene(), dropLoot = vi.fn();
  const world: WorldContext = { scene, player: new THREE.Group(), camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(), cameraFacing: createSignal(8), cameraHeading: createSignal(45),
    renderer: { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer, dropLoot,
    registerContainer: (id, container) => inventory.registerContainer(id, container),
    unregisterContainer: (id, container) => inventory.unregisterContainer(id, container),
  };
  const placement = managedBuildings(world, { consume: () => false, onInteraction });
  return { inventory, scene, placement, dropLoot };
}

it('burns a cooking pot after 20 seconds, drops the product and disables cooking and container interactions', async () => {
  const { inventory, placement, dropLoot } = structureFixture();
  try {
    const model = await placement.spawnFromSave('cookpot', { id: 'burning_pot', transform: { position: [30, 0, 8], rotationY: 0 },
      components: { building: { skinId: 'cookpot_cauldron' }, stewer: { product: 'meatballs', phase: 'cooking', remainingSeconds: 15 } } });
    (findActionEntity(model)?.components ?? prefabInstance(model)!.components).burnable.Ignite();
    placement.update(19.9);
    expect(prefabInstance(model)!.listTags()).not.toContain('burnt'); expect(dropLoot).not.toHaveBeenCalled();
    placement.update(.1);
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('burnt');
    expect((findActionEntity(model)?.components ?? prefabInstance(model)!.components).stewer).toBeUndefined(); expect((findActionEntity(model)?.components ?? prefabInstance(model)!.components).container).toBeUndefined();
    expect(placement.performContainerAction(model, 'COOK', {})).toBe(false);
    expect(dropLoot).toHaveBeenCalledExactlyOnceWith([{ itemId: 'meatballs', count: 1 }], new THREE.Vector3(30, 0, 8));
    placement.update(30); expect(dropLoot).toHaveBeenCalledTimes(1);
    const record = placement.exportRecords()[0].record;
    expect(record.components.building).toMatchObject({ burnt: true, skinId: 'cookpot_cauldron' });
    expect(record.components.stewer).toBeUndefined();
    workTargets('HAMMER')[0].work();
    expect(model.parent).toBeNull(); expect(placement.exportRecords()).toEqual([]);
  } finally { placement.dispose(); inventory.dispose(); }
});

it('burns an open chest through DefaultBurntStructureFn, drops its contents at its foot and reloads burnt', async () => {
  const changes = vi.fn();
  const { inventory, placement } = structureFixture(changes);
  const dropped: ItemEntity[] = [], stop = inventory.subscribeDropped(entity => dropped.push(entity));
  try {
    const model = await placement.spawnFromSave('treasurechest', { id: 'open_chest', transform: { position: [3, 0, -6], rotationY: 0 }, components: {
      building: {}, container: { slotCount: 9, slots: [{ slotKey: '0', item: { entityId: 'chest_seeds', itemId: 'seeds', count: 3 } }] },
    } });
    const instance = prefabInstance(model)!, burntup = vi.fn();
    instance.ListenForEvent('burntup', burntup);
    instance.components.container!.Open({});
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'treasurechest', isOpen: true, model });
    instance.components.burnable!.Ignite();
    placement.update(10);
    expect(instance.hasTag('burnt')).toBe(true);
    expect(burntup).toHaveBeenCalledOnce();
    expect(instance.sprite.currentAnimation).toBe('burnt');
    expect(changes).toHaveBeenLastCalledWith({ buildId: 'treasurechest', isOpen: false, model });
    expect(instance.components.container).toBeUndefined();
    expect(instance.components.burnable).toBeUndefined();
    expect(inventory.getContainer('world:treasurechest:open_chest')).toBeUndefined();
    expect(dropped.map(item => item.snapshot().entityId)).toEqual(['chest_seeds']);
    expect(dropped[0].transform.position.toArray()).toEqual([3, 0, -6]);
    const { record } = placement.exportRecords()[0];
    expect(record.components.building).toMatchObject({ burnt: true });
    const restored = prefabInstance(await structureFixture().placement.spawnFromSave('treasurechest', record))!;
    expect(restored.hasTag('burnt')).toBe(true);
    expect(restored.sprite.currentAnimation).toBe('burnt');
    expect(restored.components.container).toBeUndefined();
  } finally { stop(); placement.dispose(); }
});
