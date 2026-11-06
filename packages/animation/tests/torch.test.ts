import { getHandEquipmentDefinition } from '../../prefab/src/handEquipment';
import { SpriteResources } from '../../display/src';
import { findActionEntity } from '../../prefab/src/actionEntity';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import { createPickupDoer, performPickupAction } from '../../stategraphs/src/pickup';
import { configureEquipmentEntity } from '../../prefab/src/handEquipment';
import { ItemEntity, InventoryStore, InventorySlot, HandSlot, inventorySlotAddress, equipmentSlotAddress } from '@dontstarve-web/inventory';
import { GroundItemManager } from '../../prefab/src/groundItemManager';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createEquipmentExistenceState } from '@dontstarve-web/signals';
import { OnItemRanOut } from '../../prefab/src/player_common';
import { TORCH_FUEL, TURNON_FUELED_CONSUMPTION, TURNON_FULL_FUELED_CONSUMPTION, onattack,
  getTorchController, createTorchGroundFactory } from '../../prefab/src/torch';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { PlaySound } from '../../prefab/src/sound';
import { TORCH_FIRE_OFFSET_Y } from '../../prefab/src/torchfire';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindWorldContent, createSignal } from '@dontstarve-web/signals';
import { createTestWorldSources } from './worldContentFixture';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { createPerishWorld } from './perishWorldFixture';
import { reskinEntity } from '../../prefab/src/reskin_tool';

/** The inst.Light an entity's model declares. */
const declaredLight = (model: THREE.Object3D) => prefabInstance(model)?.light.peek();

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn() })),
}));
let handEquipmentExistenceState: ReturnType<typeof createEquipmentExistenceState>;
beforeEach(() => { handEquipmentExistenceState = createEquipmentExistenceState('HANDS'); });
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** torch.lua's prefab fn adds fueled before the saved fuel loads. */
// torch.lua fn, including the equippable's onequip/onunequip.
const torchSpec = { maxFuel: TORCH_FUEL, configureEntity: configureEquipmentEntity };
const specs = { torch: { name: 'torch', icon: 'torch.tex', maxStack: 1, equippable: 'hand' as const, ...torchSpec } };
/** SetFirstPeriod(TURNON_FUELED_CONSUMPTION, TURNON_FULL_FUELED_CONSUMPTION), charged on the next update. */
const FULL_FIRST_PERIOD = TURNON_FULL_FUELED_CONSUMPTION, FIRST_PERIOD = TURNON_FUELED_CONSUMPTION;

function fixture(initialFuel = TORCH_FUEL) {
  const entity = new ItemEntity({ itemId: 'torch', count: 1, remainingFuel: initialFuel });
  entity.configure(torchSpec);
  // The item's world: fueled consumes on its game time.
  const world = createPerishWorld();
  entity.BindPerishWorld(world);
  const fuel = () => entity.isRemoved ? null : entity.components.fueled!.currentfuel;
  const remove = vi.spyOn(entity, 'remove');
  const onBurningChange = vi.fn();
  const torch = getTorchController(entity);
  torch.burning.subscribe((burning) => onBurningChange(burning));
  return { entity, torch, fuel, remove, onBurningChange, world };
}

describe('torch prefab burning lifecycle', () => {
  it('consumes fuel on its game-time period while burning and settles the elapsed part on unequip', () => {
    const { entity, torch, fuel, remove, world } = fixture();
    const settled = vi.fn();
    entity.ListenForEvent('percentusedchange', settled);
    torch.onequip();
    world.advance(0.6);
    // Only the full torch's first period is charged before fueled.lua's DoPeriodicTask(1) runs.
    expect(fuel()).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD, 9);
    world.advance(0.6);
    expect(fuel()).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD - 1, 9);
    expect(settled).toHaveBeenCalledTimes(2);
    world.advance(0.3);
    torch.onunequip();
    expect(fuel()).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD - 1.5, 9);
    world.advance(60);
    expect(fuel()).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD - 1.5, 9);
    // Relighting a partly used torch charges the regular first period.
    torch.onequip();
    world.advance(0.5);
    entity.flush();
    expect(fuel()).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD - 2.5, 9);
    torch.dispose();
    const left = fuel();
    world.advance(5);
    expect(fuel()).toBe(left);
    expect(remove).not.toHaveBeenCalled();
  });

  it('starts consuming once a torch lit before its world was bound joins that world', () => {
    const entity = new ItemEntity({ itemId: 'torch', count: 1 });
    entity.configure(torchSpec);
    const torch = getTorchController(entity);
    // A restored inventory equips before the scene binds its world.
    torch.onequip();
    expect(torch.isBurning).toBe(true);
    const world = createPerishWorld();
    entity.BindPerishWorld(world);
    world.advance(2);
    expect(entity.components.fueled!.currentfuel).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD - 2, 9);
    torch.dispose(); entity.destroy();
  });

  it('ignites once per equip, keeps fuel while unlit and burns independently of other torches', () => {
    const { torch, fuel, onBurningChange, world } = fixture(60);
    const spare = fixture(60);
    world.advance(10);
    expect(fuel()).toBe(60);
    torch.onequip(); torch.onequip();
    expect(PlaySound).toHaveBeenCalledExactlyOnceWith('dontstarve/wilson/torch_swing', undefined);
    world.advance(10); spare.world.advance(10);
    expect(fuel()).toBeCloseTo(60 - FIRST_PERIOD - 10, 9);
    expect(spare.fuel()).toBe(60);
    torch.onunequip();
    world.advance(0);
    expect(PlaySound).toHaveBeenLastCalledWith('dontstarve/common/fireOut', undefined);
    world.advance(20);
    expect(torch.isBurning).toBe(false);
    expect(fuel()).toBeCloseTo(60 - FIRST_PERIOD - 10, 9);
    // A saved fuel value restores an unlit torch; equip starts its lifecycle.
    const restored = fixture(fuel()!);
    expect(restored.entity.snapshot().remainingFuel).toBe(fuel());
    torch.dispose(); torch.onequip();
    expect(torch.isBurning).toBe(false);
    expect(onBurningChange.mock.calls).toEqual([[true], [false]]);
  });

  it('removes an exhausted torch and extinguishes once', () => {
    const { torch, fuel, remove, onBurningChange, world } = fixture(0.125);
    torch.onequip();
    expect(torch.isBurning).toBe(true);
    // The first period exceeds what is left, so the torch burns out on the next update.
    world.advance(0.01);
    expect(torch.isBurning).toBe(false);
    expect(fuel()).toBeNull();
    expect(remove).toHaveBeenCalledOnce();
    world.advance(1); torch.onequip(); torch.dispose();
    expect(remove).toHaveBeenCalledOnce();
    expect(onBurningChange.mock.calls).toEqual([[true], [false]]);
  });

  it('removes the depleted item through its inventory owner, then pushes itemranout so the next torch is equipped', async () => {
    const hand = equipmentSlotAddress('hand'), bag = inventorySlotAddress(0), bag2 = inventorySlotAddress(1);
    const store = new InventoryStore([{ address: bag, slot: new InventorySlot() }, { address: bag2, slot: new InventorySlot() },
      { address: hand, slot: new HandSlot() }], specs, {});
    const world = createPerishWorld();
    store.entities.bindPerishWorld(world);
    const pushed: unknown[] = [];
    const owner = { PushEvent: (name: string, data?: unknown) => {
      pushed.push({ name, slotEmpty: store.getEntity(hand) == null });
      if (name === 'itemranout') OnItemRanOut(store, data);
    } };
    store.bindActor({ ...owner, hasTag: () => false, GetPosition: () => ({ x: 0, y: 0, z: 0 }) });
    try {
      store.add('torch', 2);
      store.applySlotChanges([{ slot: bag, itemId: 'torch', delta: -1 }, { slot: hand, itemId: 'torch', delta: 1 }]);
      const first = store.getEntity(hand)!, second = store.getEntity(bag) ?? store.getEntity(bag2)!;
      expect(getTorchController(first).isBurning).toBe(true);
      expect(store.setRemainingFuel(hand, 1)).toBe(true);
      world.advance(1);
      expect(first.isRemoved).toBe(true);
      // The depleted torch unequips as its owner removes it, then itemranout equips the next one.
      expect(pushed).toEqual([{ name: 'equip', slotEmpty: false }, { name: 'unequip', slotEmpty: true },
        { name: 'itemranout', slotEmpty: true }, { name: 'equip', slotEmpty: false }]);
      expect(store.getEntity(hand)).toBe(second);
      expect(getTorchController(second).isBurning).toBe(true);
    } finally { store.entities.dispose(); }
  });

  it('keeps one entity and controller through equip, asynchronous drop, reskin, pickup and save restoration', async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
    const slot = inventorySlotAddress(0), hand = equipmentSlotAddress('hand');
    const store = new InventoryStore([{ address: slot, slot: new InventorySlot() }, { address: hand, slot: new HandSlot() }], specs,
      { torch_barber: { itemId: 'torch', name: 'torch', icon: 'torch_barber.tex', atlas: 'images/inventoryimages.xml' } });
    const world = createPerishWorld();
    store.entities.bindPerishWorld(world);
    store.add('torch', 1);
    const entity = store.getEntity(slot)!;
    const controller = getTorchController(entity);
    const equip = vi.spyOn(controller, 'onequip');
    const scene = new THREE.Scene(), player = new THREE.Group();
    const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
    const manager = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
      { domElement: canvas } as unknown as THREE.WebGLRenderer, '', store,
      '/dst/data/anim', player, undefined, undefined, undefined, store.entities);
    try {
      store.applySlotChanges([{ slot, itemId: 'torch', delta: -1 }, { slot: hand, itemId: 'torch', delta: 1 }]);
      expect(equip).toHaveBeenCalledOnce();
      world.advance(0.5);
      const definition = { ...GROUND_ITEM_DEFINITIONS.torch, itemId: 'torch', count: 1 };
      expect(await manager.drop(definition, new THREE.Vector3(), () => {
        world.advance(0.25);
        return store.extract(hand, 1, entity) ?? false;
      })).toBe(true);
      let model = scene.children[0] as THREE.Group;
      expect(lookupPrefabInstance(model)?.entityId).toBe(entity.id);
      expect(prefabInstance(model)).toBe(entity);
      expect(controller.isBurning).toBe(false);
      expect(entity.components.fueled!.currentfuel).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD - .75, 9);
      expect(entity.components.inventoryitem.owner).toBeNull();
      controller.IgniteTossed();
      expect(controller.isBurning).toBe(true);
      expect(entity.skinId).toBeUndefined();
      world.advance(0.375);
      expect(reskinEntity(manager.reskinTargets[0])).toBe(true);
      model = scene.children[0] as THREE.Group;
      expect(entity.skinId).toBe('torch_barber');
      expect(prefabInstance(model)).toBe(entity);
      expect(controller.isBurning).toBe(true);
      const [record] = manager.exportRecords();
      expect(record.id).toBe(entity.id);
      // Relit on the ground, the partly used torch charges its first period.
      expect(record.components.stack?.remainingFuel).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD - .75 - FIRST_PERIOD - .375, 9);
      expect(record.components.torch).toEqual({ lit: true });
      vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([{ object: model } as unknown as THREE.Intersection]);
      world.advance(0.125);
      performPickupAction(findActionEntity(model)!.pickupTarget, createPickupDoer(player, store));
      expect(manager.exportRecords()).toEqual([]);
      expect(store.getEntity(hand)).toBe(entity);
      expect(getTorchController(entity)).toBe(controller);
      expect(controller.isBurning).toBe(true);
      expect(entity.components.fueled!.currentfuel).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD - .75 - FIRST_PERIOD - .5, 9);
      const saved = store.exportState();
      store.replaceState(saved, {});
      const restored = store.getEntity(hand)!;
      expect(restored).not.toBe(entity);
      expect(restored.id).toBe(entity.id);
      expect(restored.snapshot()).toEqual(entity.snapshot());
      expect(getTorchController(restored)).not.toBe(controller);
      expect(getTorchController(restored).isBurning).toBe(true);
    } finally { manager.dispose(); store.entities.dispose(); }
  });

  it('restores a lit ground torch silently, extinguishes through its event and picks it up without affecting held equipment', async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
    const assets = new GroundItemAssets();
    const owner = new THREE.Vector3(12, 0, 0);
    const factory = createTorchGroundFactory({ scene: new THREE.Scene(), assets, sprites: new SpriteResources(undefined, undefined, assets), animationBaseUrl: '/dst/data/anim', inventoryOwnerPosition: owner,
      bernieWorld: { getSanityPercent: () => 1 }, butterflyWorld: { getThreatPositions: () => [], getFlowers: () => [] },
      firefliesWorld: {} });
    const definition = { ...GROUND_ITEM_DEFINITIONS.torch, itemId: 'torch', count: 1, remainingFuel: 20, torchLit: true };
    const entity = new ItemEntity({ itemId: 'torch', count: 1, remainingFuel: 18 });
    entity.configure(torchSpec);
    const world = createPerishWorld();
    entity.BindPerishWorld(world);
    entity.transform.setPosition(4, 0, 6);
    const visual = factory.create(definition, entity);
    try {
      const held = { itemId: 'hammer', EQUIPSLOTS: 'HANDS' as const };
      handEquipmentExistenceState.set(held);
      visual.model.position.copy(entity.transform.position);
      // Prepared visual receives the actual state committed after an asynchronous drop.
      visual.setDefinition?.({ ...definition, remainingFuel: 18, entity });
      prefabInstance(visual.model)!.PushEvent('onload');
      const controller = getTorchController(entity);
      expect(visual.model.userData).not.toHaveProperty('torch');
      expect(controller.isBurning).toBe(true);
      expect(PlaySound).not.toHaveBeenCalled();
      expect(declaredLight(visual.model)).toBeDefined();
      // IgniteTossed: torchfire follows the inst's own swap_torch.
      expect([...entity.sprite.sprite.peek().followers!.values()].map(({ symbol, y }) => [symbol, y])).toEqual([['swap_torch', TORCH_FIRE_OFFSET_Y]]);
      // A lit ground torch keeps consuming on its world's game time.
      world.advance(0.5);
      expect(visual.getDefinition?.()).toEqual({ remainingFuel: 18 - FIRST_PERIOD - .5, torchLit: true });
      const launches: unknown[] = [];
      entity.ListenForEvent('launch', launch => launches.push(launch));
      entity.components.burnable!.Extinguish();
      expect(controller.isBurning).toBe(false);
      expect(declaredLight(visual.model)).toBeUndefined();
      expect(entity.sprite.sprite.peek().followers!.size).toBe(0);
      expect(handEquipmentExistenceState.peek()).toBe(held);
      expect(PlaySound).toHaveBeenLastCalledWith('dontstarve/common/fireOut', visual.model.position);
      // OnExtinguish hops the item: the ground manager flies the launch, keeping its foot on the ground.
      expect(launches).toEqual([expect.objectContaining({ height: .1, speed: { min: 0, range: 1 }, ySpeed: { min: 8, range: 1 } })]);
      controller.IgniteTossed();
      prefabInstance(visual.model)!.PushEvent('onputininventory');
      world.advance(0); // PlayExtinguishSound's DoTaskInTime(0).
      expect(PlaySound).toHaveBeenLastCalledWith('dontstarve/common/fireOut', owner);
      expect(controller.isBurning).toBe(false);
      // Pocketed before the next update, the relit torch's first period is cancelled uncharged.
      expect(visual.getDefinition?.()).toEqual({ remainingFuel: 18 - FIRST_PERIOD - .5, torchLit: false });
      expect(handEquipmentExistenceState.peek()).toBe(held);
      const calls = vi.mocked(PlaySound).mock.calls.length;
      prefabInstance(visual.model)!.PushEvent('onputininventory');
      controller.OnExtinguish();
      world.advance(0);
      expect(PlaySound).toHaveBeenCalledTimes(calls);
    } finally { visual.dispose(); entity.destroy(); assets.dispose(); }
  });

  it('registers the source callbacks on burnable: tags, fuel and hand sounds that cancel each other', () => {
    const { entity, torch, world } = fixture();
    expect(entity.components.burnable!.canlight).toBe(false);
    expect(entity.hasTag('nolight')).toBe(true);
    torch.onequip();
    expect(entity.components.burnable!.IsBurning()).toBe(true);
    expect(entity.hasTag('fire')).toBe(true);
    vi.mocked(PlaySound).mockClear();
    // Swapping back in the same step: the pending extinguish is cancelled and the ignite swallowed, so neither plays.
    torch.onunequip();
    expect(entity.components.burnable!.IsBurning()).toBe(false);
    torch.onequip();
    world.advance(0);
    expect(PlaySound).not.toHaveBeenCalled();
    torch.onunequip();
    world.advance(0);
    expect(PlaySound).toHaveBeenCalledExactlyOnceWith('dontstarve/common/fireOut', undefined);
  });

  it('removes a pending sound with the inst', () => {
    const { entity, torch, world } = fixture();
    torch.onequip();
    vi.mocked(PlaySound).mockClear();
    torch.onunequip();
    entity.remove();
    world.advance(0);
    expect(PlaySound).not.toHaveBeenCalled();
  });

  it('burns out on the ground through the fires branch: fire out, unsaved, NOCLICK, then removed by depletion', () => {
    const { entity, torch, world } = fixture();
    entity.components.burnable!.Ignite();
    entity.sprite.bind({ createFollower: () => new THREE.Object3D() } as never);
    const position = new THREE.Vector3(1, 0, 2);
    vi.spyOn(entity, 'position', 'get').mockReturnValue(position);
    torch.OnDropped();
    torch.IgniteTossed();
    vi.mocked(PlaySound).mockClear();
    world.advance(TORCH_FUEL + 2);
    expect(PlaySound).toHaveBeenCalledExactlyOnceWith('dontstarve/common/fireOut', position);
    expect(entity.persists).toBe(false);
    expect(entity.hasTag('NOCLICK')).toBe(true);
    expect(entity.isRemoved).toBe(true);
  });

  it('consumes faster in rain by the precipitation rate and SetFuelRateMult, and returns to the multiplier when dry', () => {
    const scheduler = new GameTimeScheduler();
    const preciptype = createSignal<'none' | 'rain' | 'snow'>('none'), precipitationRate = createSignal(0);
    const unbind = bindWorldContent({ ...createTestWorldSources(scheduler), preciptype, precipitationRate });
    try {
      const { entity, torch } = fixture();
      torch.onequip();
      const fueled = entity.components.fueled!;
      expect(fueled.rate).toBe(1);
      precipitationRate.set(.5); preciptype.set('rain');
      expect(fueled.rate).toBe(1 + 1.5 * .5);
      torch.SetFuelRateMult(2);
      expect(fueled.rate).toBe((1 + 1.5 * .5) * 2);
      precipitationRate.set(1);
      fueled.DoUpdate(0); // fueled's update fn re-reads the rate each period.
      expect(fueled.rate).toBe((1 + 1.5) * 2);
      preciptype.set('none');
      expect(fueled.rate).toBe(2);
      torch.SetFuelRateMult(1);
      expect(fueled.rate).toBe(1);
    } finally { unbind(); }
  });

  it('ignites what it hits by the target flammability', () => {
    const attacker = {}, ignite = vi.fn(), target = { isRemoved: false, components: { burnable: { flammability: .5, Ignite: ignite } } };
    const random = vi.spyOn(Math, 'random').mockReturnValue(.6);
    onattack({}, attacker, target);
    expect(ignite).not.toHaveBeenCalled();
    random.mockReturnValue(.4);
    onattack({}, attacker, { ...target, isRemoved: true });
    expect(ignite).not.toHaveBeenCalled();
    onattack({}, attacker, target);
    expect(ignite).toHaveBeenCalledExactlyOnceWith(undefined, attacker);
    onattack({}, attacker, {});
    random.mockRestore();
    expect(getHandEquipmentDefinition('torch')!.definition.weapon!.onattack).toBe(onattack);
  });
});
