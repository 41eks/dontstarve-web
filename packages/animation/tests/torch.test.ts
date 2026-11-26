import { onSignalChange } from '../../signals/tests/signalChanges';
import { withEntity } from './entityFixture';
import { testPlayer } from './testPlayer';
import { pickupDoer } from './playerDoer';
import { getHandEquipmentDefinition } from '../../prefab/src/handEquipment';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import { performPickupAction } from '../../stategraphs/src/pickup';
import { configureEquipmentEntity } from '../../prefab/src/handEquipment';
import {
  ItemEntity,
  InventorySlot,
  HandSlot,
  inventorySlotAddress,
  equipmentSlotAddress,
} from '@dontstarve-web/inventory';
import { ItemWorldFixture, itemAt } from './itemWorldFixture';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createEquipmentExistenceState } from '@dontstarve-web/signals';
import { OnItemRanOut } from '../../prefab/src/player_common';
import {
  TORCH_FUEL,
  TURNON_FUELED_CONSUMPTION,
  TURNON_FULL_FUELED_CONSUMPTION,
  onattack,
  createTorchHandLifecycle,
  IgniteTossed,
  TorchEntity,
} from '../../prefab/src/torch';
import { GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createPickupInventory } from './pickupFixture';
import { PlaySound } from '../../prefab/src/sound';
import { TORCH_FIRE_OFFSET_Y } from '../../prefab/src/torchfire';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindWorldContent, createSignal } from '@dontstarve-web/signals';
import { createTestWorldSources } from './worldContentFixture';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { createPerishWorld } from './perishWorldFixture';
import { reskinEntity } from '../../prefab/src/reskin_tool';
import { testInventoryStore, testItem } from './testInventory';

/** burnable:IsBurning() on the torch inst. */
const burning = (entity: ItemEntity) => entity.components.burnable!.IsBurning();

/** The inst.Light an entity's model declares. */
const declaredLight = (model: THREE.Object3D) => prefabInstance(model)?.light.peek();

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop: vi.fn() })),
}));
let handEquipmentExistenceState: ReturnType<typeof createEquipmentExistenceState>;
beforeEach(() => {
  handEquipmentExistenceState = createEquipmentExistenceState('HANDS');
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** torch.lua's prefab fn adds fueled before the saved fuel loads. */
// torch.lua fn, including the equippable's onequip/onunequip.
const torchSpec = { maxFuel: TORCH_FUEL, configureEntity: configureEquipmentEntity };
const specs = { torch: { name: 'torch', icon: 'torch.tex', maxStack: 1, equippable: 'hand' as const, ...torchSpec } };
/** SetFirstPeriod(TURNON_FUELED_CONSUMPTION, TURNON_FULL_FUELED_CONSUMPTION), charged on the next update. */
const FULL_FIRST_PERIOD = TURNON_FULL_FUELED_CONSUMPTION,
  FIRST_PERIOD = TURNON_FUELED_CONSUMPTION;

/** Every torch the inventory constructs is the torch prefab's own entity. */
function asTorch(entity: ItemEntity | null | undefined): TorchEntity {
  if (!(entity instanceof TorchEntity)) {
    throw new Error('expected a torch entity');
  }
  return entity;
}

function fixture(initialFuel = TORCH_FUEL) {
  const entity = asTorch(testItem({ itemId: 'torch', count: 1, remainingFuel: initialFuel }));
  entity.configure(torchSpec);
  // The item's world: fueled consumes on its game time.
  const world = createPerishWorld();
  entity.BindPerishWorld(world);
  const fuel = () => (entity.isRemoved ? null : entity.components.fueled!.currentfuel);
  const remove = vi.spyOn(entity, 'remove');
  const onBurningChange = vi.fn();
  // equippable onequip / onunequip without an animated holder.
  const torch = createTorchHandLifecycle(entity, {});
  onSignalChange(entity.components.burnable!.burning, burning => onBurningChange(burning));
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
    torch.onunequip();
    const left = fuel();
    world.advance(5);
    expect(fuel()).toBe(left);
    expect(remove).not.toHaveBeenCalled();
  });

  it('starts consuming once a torch lit before its world was bound joins that world', () => {
    const entity = testItem({ itemId: 'torch', count: 1 });
    entity.configure(torchSpec);
    const torch = createTorchHandLifecycle(entity, {});
    // A restored inventory equips before the scene binds its world.
    torch.onequip();
    expect(burning(entity)).toBe(true);
    const world = createPerishWorld();
    entity.BindPerishWorld(world);
    world.advance(2);
    expect(entity.components.fueled!.currentfuel).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD - 2, 9);
    entity.remove();
    entity.destroy();
  });

  it('ignites on equip, keeps fuel while unlit and burns independently of other torches', () => {
    const { entity, torch, fuel, onBurningChange, world } = fixture(60);
    const spare = fixture(60);
    world.advance(10);
    expect(fuel()).toBe(60);
    torch.onequip();
    expect(PlaySound).toHaveBeenCalledExactlyOnceWith('dontstarve/wilson/torch_swing', undefined);
    world.advance(10);
    spare.world.advance(10);
    expect(fuel()).toBeCloseTo(60 - FIRST_PERIOD - 10, 9);
    expect(spare.fuel()).toBe(60);
    torch.onunequip();
    world.advance(0);
    expect(PlaySound).toHaveBeenLastCalledWith('dontstarve/common/fireOut', undefined);
    world.advance(20);
    expect(burning(entity)).toBe(false);
    expect(fuel()).toBeCloseTo(60 - FIRST_PERIOD - 10, 9);
    // A saved fuel value restores an unlit torch; equip starts its lifecycle.
    const restored = fixture(fuel()!);
    expect(restored.entity.snapshot().remainingFuel).toBe(fuel());
    entity.remove();
    torch.onequip();
    expect(onBurningChange.mock.calls).toEqual([[true], [false]]);
  });

  it('removes an exhausted torch and extinguishes once', () => {
    const { entity, torch, fuel, remove, onBurningChange, world } = fixture(0.125);
    torch.onequip();
    expect(burning(entity)).toBe(true);
    // The first period exceeds what is left, so the torch burns out on the next update.
    world.advance(0.01);
    expect(burning(entity)).toBe(false);
    expect(fuel()).toBeNull();
    expect(remove).toHaveBeenCalledOnce();
    world.advance(1);
    torch.onequip();
    expect(remove).toHaveBeenCalledOnce();
    expect(onBurningChange.mock.calls).toEqual([[true], [false]]);
  });

  it('removes the depleted item through its inventory owner, then pushes itemranout so the next torch is equipped', async () => {
    const hand = equipmentSlotAddress('hand'),
      bag = inventorySlotAddress(0),
      bag2 = inventorySlotAddress(1);
    const store = testInventoryStore(
      [
        { address: bag, slot: new InventorySlot() },
        { address: bag2, slot: new InventorySlot() },
        { address: hand, slot: new HandSlot() },
      ],
      specs,
      {},
    );
    const world = createPerishWorld();
    store.entities.bindPerishWorld(world);
    const pushed: unknown[] = [];
    // The player inst owns the store; player_common.lua listens for itemranout on it.
    const player = testPlayer({ inventory: store });
    for (const name of ['equip', 'unequip', 'itemranout']) {
      player.ListenForEvent(name, (_inst, data) => {
        pushed.push({ name, slotEmpty: store.getEntity(hand) == null });
        if (name === 'itemranout') {
          OnItemRanOut(store, data);
        }
      });
    }
    try {
      store.add('torch', 2);
      store.applySlotChanges([
        { slot: bag, itemId: 'torch', delta: -1 },
        { slot: hand, itemId: 'torch', delta: 1 },
      ]);
      const first = store.getEntity(hand)!,
        second = store.getEntity(bag) ?? store.getEntity(bag2)!;
      expect(burning(first)).toBe(true);
      expect(store.setRemainingFuel(hand, 1)).toBe(true);
      world.advance(1);
      expect(first.isRemoved).toBe(true);
      // The depleted torch unequips as its owner removes it, then itemranout equips the next one.
      expect(pushed).toEqual([
        { name: 'equip', slotEmpty: false },
        { name: 'unequip', slotEmpty: true },
        { name: 'itemranout', slotEmpty: true },
        { name: 'equip', slotEmpty: false },
      ]);
      expect(store.getEntity(hand)).toBe(second);
      expect(burning(second)).toBe(true);
    } finally {
      store.entities.dispose();
    }
  });

  it('keeps one entity through equip, asynchronous drop, reskin, pickup and save restoration', async () => {
    vi.stubGlobal(
      'fetch',
      async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
    );
    const slot = inventorySlotAddress(0),
      hand = equipmentSlotAddress('hand');
    const store = testInventoryStore(
      [
        { address: slot, slot: new InventorySlot() },
        { address: hand, slot: new HandSlot() },
      ],
      specs,
      {
        torch_barber: { itemId: 'torch', name: 'torch', icon: 'torch_barber.tex', atlas: 'images/inventoryimages.xml' },
      },
    );
    const world = createPerishWorld();
    store.entities.bindPerishWorld(world);
    const scene = new THREE.Scene(),
      player = withEntity(new THREE.Group(), 'wilson');
    const canvas = Object.assign(new EventTarget(), {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    });
    // The world's SpawnPrefab is bound before any item exists, as in the scene.
    const manager = new ItemWorldFixture(
      scene,
      new THREE.PerspectiveCamera(),
      { domElement: canvas } as unknown as THREE.WebGLRenderer,
      '',
      store,
      '/dst/data/anim',
      player,
      undefined,
      undefined,
      undefined,
      store.entities,
    );
    store.add('torch', 1);
    const entity = asTorch(store.getEntity(slot));
    const equip = vi.spyOn(entity.components.equippable!, 'Equip');
    try {
      store.applySlotChanges([
        { slot, itemId: 'torch', delta: -1 },
        { slot: hand, itemId: 'torch', delta: 1 },
      ]);
      expect(equip).toHaveBeenCalledOnce();
      world.advance(0.5);
      const definition = { ...GROUND_ITEM_DEFINITIONS.torch, itemId: 'torch', count: 1 };
      expect(
        await manager.drop(definition, new THREE.Vector3(), () => {
          world.advance(0.25);
          return store.extract(hand, 1, entity) ?? false;
        }),
      ).toBe(true);
      let model = scene.children[0] as THREE.Group;
      expect(lookupPrefabInstance(model)?.entityId).toBe(entity.id);
      expect(prefabInstance(model)).toBe(entity);
      expect(burning(entity)).toBe(false);
      expect(entity.components.fueled!.currentfuel).toBeCloseTo(TORCH_FUEL - FULL_FIRST_PERIOD - 0.75, 9);
      expect(entity.components.inventoryitem.owner).toBeNull();
      IgniteTossed(entity);
      expect(burning(entity)).toBe(true);
      expect(entity.skinId).toBeUndefined();
      world.advance(0.375);
      expect(reskinEntity(manager.reskinTargets[0])).toBe(true);
      model = scene.children[0] as THREE.Group;
      expect(entity.skinId).toBe('torch_barber');
      expect(prefabInstance(model)).toBe(entity);
      expect(burning(entity)).toBe(true);
      const [record] = manager.exportRecords();
      expect(record.id).toBe(entity.id);
      // Relit on the ground, the partly used torch charges its first period.
      expect(record.components.fueled?.fuel).toBeCloseTo(
        TORCH_FUEL - FULL_FIRST_PERIOD - 0.75 - FIRST_PERIOD - 0.375,
        9,
      );
      expect(record.components.torch).toEqual({ lit: true });
      vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([
        { object: model } as unknown as THREE.Intersection,
      ]);
      world.advance(0.125);
      performPickupAction(itemAt(model), pickupDoer(player, store));
      expect(manager.exportRecords()).toEqual([]);
      expect(store.getEntity(hand)).toBe(entity);
      expect(burning(entity)).toBe(true);
      expect(entity.components.fueled!.currentfuel).toBeCloseTo(
        TORCH_FUEL - FULL_FIRST_PERIOD - 0.75 - FIRST_PERIOD - 0.5,
        9,
      );
      const saved = store.exportState();
      store.replaceState(saved, {});
      const restored = store.getEntity(hand)!;
      expect(restored).not.toBe(entity);
      expect(restored.id).toBe(entity.id);
      expect(restored.snapshot()).toEqual(entity.snapshot());
      expect(burning(restored)).toBe(true);
    } finally {
      manager.dispose();
      store.entities.dispose();
    }
  });

  it('restores a lit ground torch silently, extinguishes through its event and picks it up without affecting held equipment', async () => {
    vi.stubGlobal(
      'fetch',
      async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
    );
    const inventory = createPickupInventory(),
      world = createPerishWorld(),
      player = withEntity(new THREE.Group(), 'wilson');
    inventory.entities.bindPerishWorld(world);
    player.position.set(12, 0, 0);
    const owner = player.position;
    const items = new ItemWorldFixture(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      undefined,
      '',
      inventory,
      '/dst/data/anim',
      player,
    );
    try {
      const held = { itemId: 'hammer', EQUIPSLOTS: 'HANDS' as const };
      handEquipmentExistenceState.set(held);
      // SpawnSaveRecord of a torch saved burning on the ground: its OnLoad lands it and relights it, silently.
      const model = items.spawnFromSave(
        'torch-lit',
        { ...GROUND_ITEM_DEFINITIONS.torch, itemId: 'torch', count: 1, remainingFuel: 18, torchLit: true },
        new THREE.Vector3(4, 0, 6),
      );
      const entity = asTorch(itemAt(model));
      // inventoryitem:OnPutInInventory(owner): the owner's SoundEmitter is at the player.
      const doer = testPlayer({ model: player, inventory });
      const saved = () => {
        const { components } = items.exportRecords().find(record => record.id === 'torch-lit')!;
        // fueled.lua OnSave omits a full torch.
        return { remainingFuel: components.fueled?.fuel ?? TORCH_FUEL, torchLit: components.torch?.lit ?? false };
      };
      expect(model.userData).not.toHaveProperty('torch');
      expect(burning(entity)).toBe(true);
      expect(PlaySound).not.toHaveBeenCalled();
      expect(declaredLight(model)).toBeDefined();
      // IgniteTossed: torchfire follows the inst's own swap_torch.
      expect([...entity.sprite.sprite.value.followers!.values()].map(({ symbol, y }) => [symbol, y])).toEqual([
        ['swap_torch', TORCH_FIRE_OFFSET_Y],
      ]);
      // A lit ground torch keeps consuming on its world's game time.
      world.advance(0.5);
      expect(saved()).toEqual({ remainingFuel: 18 - FIRST_PERIOD - 0.5, torchLit: true });
      const launch = vi.spyOn(entity.components.inventoryphysics!, 'Launch');
      entity.components.burnable!.Extinguish();
      expect(burning(entity)).toBe(false);
      expect(declaredLight(model)).toBeUndefined();
      expect(entity.sprite.sprite.value.followers!.size).toBe(0);
      expect(handEquipmentExistenceState.value).toBe(held);
      expect(PlaySound).toHaveBeenLastCalledWith('dontstarve/common/fireOut', model.position);
      // OnExtinguish hops the item: its inventoryphysics flies the launch, keeping its foot on the ground.
      expect(launch).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ height: 0.1, speed: { min: 0, range: 1 }, ySpeed: { min: 8, range: 1 } }),
      );
      IgniteTossed(entity);
      entity.components.inventoryitem.OnPutInInventory(doer);
      world.advance(0); // PlayExtinguishSound's DoTaskInTime(0).
      expect(PlaySound).toHaveBeenLastCalledWith('dontstarve/common/fireOut', owner);
      expect(burning(entity)).toBe(false);
      // Pocketed before the next update, the relit torch's first period is cancelled uncharged.
      expect(saved()).toEqual({ remainingFuel: 18 - FIRST_PERIOD - 0.5, torchLit: false });
      expect(handEquipmentExistenceState.value).toBe(held);
      const calls = vi.mocked(PlaySound).mock.calls.length;
      entity.components.inventoryitem.OnPutInInventory(doer);
      entity.components.burnable!.Extinguish();
      world.advance(0);
      expect(PlaySound).toHaveBeenCalledTimes(calls);
    } finally {
      items.dispose();
      inventory.dispose();
    }
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
    const { entity, world } = fixture();
    entity.components.burnable!.Ignite();
    entity.sprite.bind({ createFollower: () => new THREE.Object3D() } as never);
    const position = new THREE.Vector3(1, 0, 2);
    vi.spyOn(entity, 'position', 'get').mockReturnValue(position);
    IgniteTossed(entity);
    vi.mocked(PlaySound).mockClear();
    world.advance(TORCH_FUEL + 2);
    expect(PlaySound).toHaveBeenCalledExactlyOnceWith('dontstarve/common/fireOut', position);
    expect(entity.persists).toBe(false);
    expect(entity.hasTag('NOCLICK')).toBe(true);
    expect(entity.isRemoved).toBe(true);
  });

  it('consumes faster in rain by the precipitation rate and SetFuelRateMult, and returns to the multiplier when dry', () => {
    const scheduler = new GameTimeScheduler();
    const preciptype = createSignal<'none' | 'rain' | 'snow'>('none'),
      precipitationRate = createSignal(0);
    const unbind = bindWorldContent({ ...createTestWorldSources(scheduler), preciptype, precipitationRate });
    try {
      const { entity, torch } = fixture();
      torch.onequip();
      const fueled = entity.components.fueled!;
      expect(fueled.rate).toBe(1);
      precipitationRate.set(0.5);
      preciptype.set('rain');
      expect(fueled.rate).toBe(1 + 1.5 * 0.5);
      entity.SetFuelRateMult!(2);
      expect(fueled.rate).toBe((1 + 1.5 * 0.5) * 2);
      precipitationRate.set(1);
      fueled.DoUpdate(0); // fueled's update fn re-reads the rate each period.
      expect(fueled.rate).toBe((1 + 1.5) * 2);
      preciptype.set('none');
      expect(fueled.rate).toBe(2);
      entity.SetFuelRateMult!(1);
      expect(fueled.rate).toBe(1);
    } finally {
      unbind();
    }
  });

  it('ignites what it hits by the target flammability', () => {
    const attacker = testPlayer(),
      ignite = vi.fn(),
      target = { isRemoved: false, components: { burnable: { flammability: 0.5, Ignite: ignite } } };
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.6);
    onattack({}, attacker, target);
    expect(ignite).not.toHaveBeenCalled();
    random.mockReturnValue(0.4);
    onattack({}, attacker, { ...target, isRemoved: true });
    expect(ignite).not.toHaveBeenCalled();
    onattack({}, attacker, target);
    expect(ignite).toHaveBeenCalledExactlyOnceWith(undefined, attacker);
    onattack({}, attacker, {});
    random.mockRestore();
    expect(getHandEquipmentDefinition('torch')!.definition.weapon!.onattack).toBe(onattack);
  });
});
