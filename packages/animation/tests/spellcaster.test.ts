import { wilsonPlayer } from './wilsonPlayer';
import { testPlayer } from './testPlayer';
import { addComponent } from '../../prefab/src/components';
import { Sanity } from '../../componets/src/sanity';
import { PrefabInstance } from '../../prefab/src/prefabInstance';
import { SpriteState } from '@dontstarve-web/display';

import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InventorySlot, HandSlot, inventorySlotAddress, equipmentSlotAddress } from '../../inventory/src';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import { collectPointActions } from '../../stategraphs/src/componentactions';
import { Locomotor } from '../../prefab/src/locomotor';
import { LIGHT_STAFF_USES, LIGHT_STAFF_CAST_SOUND, type LightStaffId } from '../../prefab/src/staff';
import { PlaySound } from '../../prefab/src/sound';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';
import { EventEmitter } from '../../signals/src/EventEmitter';
import type { PlayerActionEvents } from '../../stategraphs/src/actionEvents';
import { testInventoryStore } from './testInventory';
import { configureEquipmentEntity } from '../../prefab/src/handEquipment';

/** staff_castinglight, which is not ported: an fx entity whose SetUp the castspell state calls. */
class CastingLight extends PrefabInstance {
  readonly SetUp = vi.fn((_colour: readonly [number, number, number], _duration: number, _delay: number) => {});
}

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop() {} })),
}));
beforeEach(() => vi.stubGlobal('window', new EventTarget()));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function fixture(itemId: LightStaffId, remainingUses?: number) {
  const hand = equipmentSlotAddress('hand');
  const store = testInventoryStore(
    [
      { address: hand, slot: new HandSlot() },
      ...[0, 1].map(index => ({ address: inventorySlotAddress(index), slot: new InventorySlot() })),
    ],
    Object.fromEntries(
      Object.entries(LIGHT_STAFF_USES).map(([id, maxUses]) => [
        id,
        {
          name: id,
          icon: `${id}.tex`,
          maxStack: 1,
          maxUses,
          equippable: 'hand',
          configureEntity: configureEquipmentEntity,
        },
      ]),
    ),
  );
  let blocked = false;
  const map = {
    isAboveGroundAtPoint: vi.fn(() => true),
    isOceanAtPoint: () => false,
    isGroundTargetBlocked: () => blocked,
  };
  const spawn = vi.fn(),
    worldServices = { map, spawnPrefab: spawn };
  store.entities.bindEquipmentWorld({ lightStaffWorld: worldServices });
  store.add(itemId, 1, undefined, undefined, remainingUses);
  store.transfer(inventorySlotAddress(0), hand, 1);
  const entity = store.getEntity(hand)!;
  // SpawnPrefab("staff_castinglight") on the player inst; the castspell state sets it up.
  const castingLight = new CastingLight('staff_castinglight', new SpriteState({ name: '' }));
  vi.spyOn(castingLight, 'remove');
  const casting = vi.fn((_prefab: string, _position: THREE.Vector3) => castingLight);
  const inst = wilsonPlayer(
    name => (name === 'staff_pre' ? 15 : name === 'staff' ? 65 : 30) / 30,
    inst => {
      inst.SpawnPrefab = casting;
    },
  );
  const sound = inst.SoundEmitter.PlaySound;
  const graph = inst.sg,
    player = inst.transform.model;
  const world = {
    scene: new THREE.Scene(),
    player,
    camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(),
    actionEvents: new EventEmitter<PlayerActionEvents>(),
    renderer: { domElement: new EventTarget() },
  } as unknown as ActionWorldContext;
  const locomotor = new Locomotor({ position: player.position, velocity: new THREE.Vector3() });
  // The player inst as act.doer: spellcaster.lua reads its position, tags and sanity.
  const playerDoer = testPlayer({ model: player, inventory: store });
  const doDelta = vi.spyOn(addComponent(playerDoer, 'sanity', Sanity, 200), 'DoDelta');
  const controller = new PlayerController(world, graph, locomotor, store.handEquipment, playerDoer, () => false);
  const input = {
    // GetPointActions(position, equipitem) on the right button, then DoAction.
    request: (point: THREE.Vector3) =>
      collectPointActions(entity, playerDoer, point, true).includes('CASTSPELL') &&
      controller.DoAction(controller.createAction({ action: 'CASTSPELL', invobject: entity, pos: point.clone() })!),
    dispose: () => controller.dispose(),
  };
  return {
    store,
    hand,
    entity,
    world,
    worldServices,
    graph,
    input,
    spawn,
    doDelta,
    sound,
    casting,
    castingLight,
    locomotor,
    player,
    setBlocked: (value: boolean) => {
      blocked = value;
    },
    dispose: () => {
      input.dispose();
      store.dispose();
    },
  };
}

it('uses source capabilities and the real invobject, approaches distant points, and commits the opal spell at frame 53', async () => {
  const s = fixture('opalstaff');
  const point = new THREE.Vector3(90, 0, 0);
  try {
    expect(s.entity.hasTag('castonpoint')).toBe(true);
    expect(s.entity.hasTag('castonpointwater')).toBe(true);
    s.setBlocked(true);
    expect(s.input.request(point)).toBe(false);
    s.setBlocked(false);
    expect(s.input.request(point)).toBe(true);
    expect(s.locomotor.bufferedAction).toBeDefined();
    expect(s.graph.stateName).toBe('idle');
    // CASTSPELL distance 20 (60 world units) is the arrive distance.
    s.player.position.set(31, 0, 0);
    s.locomotor.update(16, 1 / 30);
    expect(s.graph.getBufferedAction()?.invobject).toBe(s.entity);
    point.set(-50, 0, 0); // Pointer movement cannot change the buffered point.
    s.graph.update(13 / 30);
    expect(s.sound).toHaveBeenCalledWith(LIGHT_STAFF_CAST_SOUND);
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
  } finally {
    s.dispose();
  }
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
    expect(s.casting).toHaveBeenCalledExactlyOnceWith('staff_castinglight', expect.anything());
    expect(s.castingLight.SetUp).toHaveBeenCalledOnce();
    expect(s.castingLight.remove).not.toHaveBeenCalled(); // Source releases FX ownership before the final-use unequip.
  } finally {
    s.dispose();
  }
});
