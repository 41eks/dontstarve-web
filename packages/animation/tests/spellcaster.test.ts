import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InventoryStore, InventorySlot, HandSlot, inventorySlotAddress, equipmentSlotAddress } from '../../inventory/src';
import { SpellCastActionController, type SpellCastDoer } from '../../stategraphs/src/spellcaster';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import { getLightStaffController, LIGHT_STAFF_USES, LIGHT_STAFF_CAST_SOUND, type LightStaffId } from '../../prefab/src/yellowstaff';
import { PlaySound } from '../../prefab/src/sound';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';
import { EventEmitter } from '../../signals/src/EventEmitter';
import type { PlayerActionEvents } from '../../stategraphs/src/actionEvents';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => vi.stubGlobal('window', new EventTarget()));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

function fixture(itemId: LightStaffId, remainingUses?: number, prepare = async () => {}) {
  const hand = equipmentSlotAddress('hand');
  const store = new InventoryStore([
    { address: hand, slot: new HandSlot() },
    ...[0, 1].map(index => ({ address: inventorySlotAddress(index), slot: new InventorySlot() })),
  ], Object.fromEntries(Object.entries(LIGHT_STAFF_USES).map(([id, maxUses]) => [id, {
    name: id, icon: `${id}.tex`, maxStack: 1, maxUses, equippable: 'hand',
  }])));
  store.add(itemId, 1, undefined, undefined, remainingUses);
  store.transfer(inventorySlotAddress(0), hand, 1);
  const entity = store.getEntity(hand)!;
  let blocked = false;
  const map = { isAboveGroundAtPoint: vi.fn(() => true), isOceanAtPoint: () => false, isGroundTargetBlocked: () => blocked };
  const spawn = vi.fn(), worldServices = { map, preparePrefab: vi.fn(prepare), spawnPrefab: spawn };
  const staff = getLightStaffController(entity, worldServices);
  staff.onequip(store.handEquipmentExistenceState);
  const sound = vi.fn(), casting = vi.fn();
  const graph = new WilsonStateGraph({
    playAnimation: clip => (clip.key === 'staff_pre' ? 15 : clip.key === 'staff' ? 65 : 30) / 30,
    playSound: sound, setCasting: casting, onStateChanged() {},
  });
  const player = new THREE.Group();
  const world = { scene: new THREE.Scene(), player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    actionEvents: new EventEmitter<PlayerActionEvents>(),
    renderer: { domElement: new EventTarget() } } as unknown as ActionWorldContext;
  const doDelta = vi.fn();
  const doer: SpellCastDoer = { position: player.position, hasTag: () => false, components: { sanity: { doDelta } } };
  const locomotor = { destination: undefined, goToPoint: vi.fn(() => true), stop: vi.fn() };
  const input = new SpellCastActionController(world, { stategraph: graph, cancelEmote() {}, setFacing() {} }, locomotor,
    store.handEquipment, doer);
  return { store, hand, entity, staff, world, worldServices, graph, input, spawn, doDelta, sound, casting, locomotor, player,
    setBlocked: (value: boolean) => { blocked = value; },
    dispose: () => { input.dispose(); store.dispose(); } };
}

it('uses source capabilities and the real invobject, approaches distant points, and commits the opal spell at frame 53', async () => {
  const s = fixture('opalstaff');
  const point = new THREE.Vector3(90, 0, 0);
  try {
    expect(s.entity.hasTag('castonpoint')).toBe(true);
    expect(s.entity.hasTag('castonpointwater')).toBe(true);
    s.setBlocked(true);
    expect(s.input.request(point)).toBe(false);
    expect(s.worldServices.preparePrefab).not.toHaveBeenCalled();
    s.setBlocked(false);
    expect(s.input.request(point)).toBe(true);
    await vi.waitFor(() => expect(s.locomotor.goToPoint).toHaveBeenCalled());
    expect(s.graph.stateName).toBe('idle');
    s.player.position.set(31, 0, 0);
    s.input.update();
    expect(s.graph.getBufferedAction()?.invobject).toBe(s.entity);
    point.set(-50, 0, 0); // Pointer movement cannot change the buffered point.
    s.graph.update(13 / 30);
    expect(s.sound).toHaveBeenCalledWith('cast', LIGHT_STAFF_CAST_SOUND);
    s.graph.update(39 / 30);
    expect(s.spawn).not.toHaveBeenCalled();
    expect(s.entity.components.finiteuses.remaining).toBeUndefined();
    s.graph.update(1 / 30);
    expect(s.spawn).toHaveBeenCalledExactlyOnceWith('staffcoldlight', new THREE.Vector3(90, 0, 0));
    expect(s.entity.components.finiteuses.remaining).toBe(49);
    expect(s.doDelta).toHaveBeenCalledExactlyOnceWith(-20);
    s.graph.update(16 / 30);
    expect(s.graph.hasStateTag('busy')).toBe(false);
    expect(s.worldServices.map.isAboveGroundAtPoint).toHaveBeenCalledWith(new THREE.Vector3(90, 0, 0), true);
  } finally { s.dispose(); }
});

it('consumes the last yellow use through the store, clears only its equipment and preserves committed effects', async () => {
  const s = fixture('yellowstaff', 1);
  try {
    expect(s.input.request(new THREE.Vector3(3, 0, 0))).toBe(true);
    await vi.waitFor(() => expect(s.graph.stateName).toBe('castspell'));
    s.graph.update(53 / 30);
    expect(s.spawn).toHaveBeenCalledOnce();
    expect(s.store.get(s.hand)).toBeNull();
    expect(s.store.handEquipment.peek()).toBeNull();
    expect(s.entity.isRemoved).toBe(true);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/common/gem_shatter', s.player.position);
    expect(s.doDelta).toHaveBeenCalledExactlyOnceWith(-20);
    expect(s.casting).toHaveBeenCalledTimes(1); // Source releases FX ownership before the final-use unequip.
  } finally { s.dispose(); }
});

it('invalidates preparation on a new action or same-prefab replacement and preserves the replacement action', async () => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const s = fixture('yellowstaff', 7, () => ready);
  try {
    expect(s.input.request(new THREE.Vector3(3, 0, 0))).toBe(true);
    s.world.actionEvents!.emit('action:begin', { owner: {}, action: 'PICK' });
    expect(s.input.request(new THREE.Vector3(3, 0, 0))).toBe(true);
    s.store.add('yellowstaff', 1);
    const replacement = s.store.getEntity(inventorySlotAddress(0))!;
    const replacementStaff = getLightStaffController(replacement, s.worldServices);
    s.store.swap(s.hand, inventorySlotAddress(0));
    s.staff.onunequip();
    replacementStaff.onequip(s.store.handEquipmentExistenceState);
    release();
    await ready; await Promise.resolve(); await Promise.resolve();
    expect(s.graph.stateName).toBe('idle');
    expect(s.spawn).not.toHaveBeenCalled();
    expect(s.doDelta).not.toHaveBeenCalled();
    expect(s.entity.components.finiteuses.remaining).toBe(7);
    expect(s.input.request(new THREE.Vector3(6, 0, 0))).toBe(true);
    await vi.waitFor(() => expect(s.graph.stateName).toBe('castspell'));
    s.staff.dispose();
    expect(s.store.handEquipment.peek()?.entity).toBe(replacement);
    s.graph.update(53 / 30);
    expect(s.spawn).toHaveBeenCalledOnce();
    expect(replacement.components.finiteuses.remaining).toBe(19);
  } finally { release(); s.dispose(); }
});
