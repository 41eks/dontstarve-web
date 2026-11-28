import { prefabWorldMap } from '../../../tests/fixtures/prefabWorldMapFixture';
import type { WorldEvents } from '../src/worldContext';
import { EventEmitter } from '../../signals/src/EventEmitter';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SpriteState } from '@dontstarve-web/display';
import { GameTimeScheduler } from '../../signals/src/gameTimeScheduler';
import { HandSlot, InventorySlot, equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { addComponent } from '../src/components';
import { PrefabInstance } from '../src/prefabInstance';
import { TELESTAFF_SOUND, TELESTAFF_USES } from '../src/staff';
import { PlaySound } from '../src/sound';
import { Sanity } from '../../componets/src/sanity';
import { LocoMotor } from '../../componets/src/locomotor';
import { createBufferedAction } from '../../stategraphs/src/actionfns';
import { collectEquippedItemActions, collectInventoryActions } from '../../stategraphs/src/componentactions';
import { INVENTORY_ITEM_SPECS } from '../../../src/inventoryItems';
import { createInventoryStore, testInventoryStore } from '../../../tests/fixtures/testInventory';
import { readFile } from 'node:fs/promises';
import { ItemWorldFixture, itemEntities } from '../../../tests/fixtures/itemWorldFixture';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { testPlayer } from '../../../tests/fixtures/testPlayer';
import { wilsonPlayer, played } from '../../../tests/fixtures/wilsonPlayer';

/** A creature with a motor, as the prefabs that add locomotor are. */
class Creature extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { locomotor?: LocoMotor };
  motorSpeed = 0;
  setMotorSpeed(speed: number): void {
    this.motorSpeed = speed;
  }
}

vi.mock('../src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop() {} })),
}));
beforeEach(() => vi.stubGlobal('window', new EventTarget()));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/**
 * A telestaff in the player's first inventory slot. TheWorld's topology has one passable node at (30, 0, 0), a
 * separated room at (60, 0, 0) and a node over the void at (90, 0, 0): only the first is a destination.
 */
function fixture({ isCave = false, remainingUses }: { isCave?: boolean; remainingUses?: number } = {}) {
  const hand = equipmentSlotAddress('hand'),
    bag = inventorySlotAddress(0);
  const store = testInventoryStore(
    [
      { address: hand, slot: new HandSlot() },
      { address: bag, slot: new InventorySlot() },
    ],
    INVENTORY_ITEM_SPECS,
  );
  const world = {
    isCave,
    topologyNodes: [
      { x: 30, z: 0, type: 0 },
      { x: 60, z: 0, type: 7 },
      { x: 90, z: 0, type: 0 },
    ],
    sendLightningStrike: vi.fn(),
    deltaMoisture: vi.fn(),
  };
  store.add('telestaff', 1, undefined, undefined, remainingUses);
  const staff = store.getEntity(bag)!;
  const worldEvents = new EventEmitter<WorldEvents>();
  worldEvents.on('ms_sendlightningstrike', world.sendLightningStrike);
  worldEvents.on('ms_deltamoisture', world.deltaMoisture);
  staff.BindWorld({
    map: prefabWorldMap({ isPassableAtPoint: point => point.x < 80 }),
    topology: { nodes: world.topologyNodes },
    isCave,
    worldEvents,
  });
  const scheduler = new GameTimeScheduler();
  const lengths = (name: string) => (name === 'staff_pre' ? 15 : name === 'staff' ? 65 : 30) / 30;
  const player = wilsonPlayer(lengths, inst => {
    inst.SpawnPrefab = () => undefined;
    inst.ScreenFade = vi.fn();
    inst.SnapCamera = vi.fn();
  });
  player.BindScheduler(scheduler);
  // The caster is the player inst that owns the store, as the application's act.doer is.
  const doer = testPlayer({ model: player.transform.model, inventory: store });
  const sanity = vi.spyOn(addComponent(doer, 'sanity', Sanity, 200), 'DoDelta');
  const advance = (seconds: number) => {
    player.sg.update(seconds);
    scheduler.advance(seconds);
  };
  return { store, staff, world, player, doer, sanity, scheduler, advance, bag };
}

it('teleports its holder from the inventory to a random topology node after the source delays', () => {
  const s = fixture();
  try {
    // purple(): castfrominventory and castonlocomotorspvp, not castontargets.
    expect(
      ['castfrominventory', 'castonlocomotorspvp', 'castontargets', 'nopunch', 'shadowlevel'].map(tag =>
        s.staff.hasTag(tag),
      ),
    ).toEqual([true, true, false, true, true]);
    expect(collectInventoryActions(s.staff, s.doer, true)).toEqual(['CASTSPELL']);
    // inventory.lua UseItemFromInvTile: the action has neither a target nor a point.
    expect(
      s.player.sg.pushBufferedAction(createBufferedAction('CASTSPELL', { doer: s.doer, invobject: s.staff })),
    ).toBe(true);
    expect(s.player.sg.stateName).toBe('castspell');
    s.player.sg.update(53 / 30);
    // teleport_start: one use, the departure strike, the caster's sanity and the world's moisture, then forcetele.
    expect(s.player.sg.stateName).toBe('forcetele');
    expect(s.staff.components.finiteuses.remaining).toBe(TELESTAFF_USES - 1);
    expect(s.world.sendLightningStrike).toHaveBeenCalledExactlyOnceWith(new THREE.Vector3(0, 0, 0));
    expect(s.sanity).toHaveBeenCalledExactlyOnceWith(-50);
    expect(s.world.deltaMoisture).toHaveBeenCalledExactlyOnceWith(500);
    expect([s.player.IsVisible(), s.player.controllerEnabled]).toEqual([false, false]);
    expect(s.player.ScreenFade).toHaveBeenCalledExactlyOnceWith(false, 2);
    // teleport_continue three seconds later; teleport_end one second after that.
    s.advance(2.9);
    expect(s.player.position.x).toBe(0);
    s.advance(0.1);
    expect([s.player.position.x, s.player.position.z]).toEqual([30, 0]);
    expect(s.player.SnapCamera).toHaveBeenCalledOnce();
    expect(s.player.ScreenFade).toHaveBeenLastCalledWith(true, 1);
    expect(s.player.sg.stateName).toBe('forcetele');
    s.advance(1);
    expect(s.player.sg.stateName).toBe('wakeup');
    expect(s.world.sendLightningStrike).toHaveBeenLastCalledWith(new THREE.Vector3(30, 0, 0));
    expect(played(s.player)).toContain(TELESTAFF_SOUND);
    expect([s.player.IsVisible(), s.player.controllerEnabled]).toEqual([true, false]);
    // The staff keeps its uses in its save record.
    expect(s.staff.components.finiteuses.OnSave()).toEqual({ uses: TELESTAFF_USES - 1 });
  } finally {
    s.store.dispose();
  }
});

it('stays put when forcetele is interrupted, and only spends the use in a cave; the last use shatters the gem', () => {
  const s = fixture();
  try {
    s.player.sg.pushBufferedAction(createBufferedAction('CASTSPELL', { doer: s.doer, invobject: s.staff }));
    s.player.sg.update(53 / 30);
    // forcetele's onexit cancels the pending teleport_task and fades back in.
    s.player.sg.GoToState('wakeup');
    expect(s.player.ScreenFade).toHaveBeenLastCalledWith(true, 0.5);
    s.advance(5);
    expect(s.player.position.x).toBe(0);
    expect(s.player.IsVisible()).toBe(true);
  } finally {
    s.store.dispose();
  }

  const cave = fixture({ isCave: true, remainingUses: 1 });
  try {
    cave.player.sg.pushBufferedAction(createBufferedAction('CASTSPELL', { doer: cave.doer, invobject: cave.staff }));
    cave.player.sg.update(53 / 30);
    expect(cave.player.sg.stateName).toBe('castspell');
    expect(cave.world.sendLightningStrike).not.toHaveBeenCalled();
    expect(cave.sanity).not.toHaveBeenCalled();
    expect(cave.staff.isRemoved).toBe(true);
    expect(cave.store.get(cave.bag)).toBeNull();
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/common/gem_shatter', expect.anything());
  } finally {
    cave.store.dispose();
  }
});

it('moves a locomotor target at once, but never another player without PvP', () => {
  const s = fixture();
  try {
    const creature = new Creature('rabbit', new SpriteState({ name: 'idle' }));
    creature.setPosition(-10, 0, 5);
    addComponent(creature, 'locomotor', LocoMotor);
    const teleported = vi.fn();
    creature.ListenForEvent('teleported', teleported);
    expect(creature.hasTag('locomotor')).toBe(true);
    expect(collectEquippedItemActions(s.staff, s.doer, creature, true)).toEqual(['CASTSPELL']);
    const other = testPlayer();
    other.addTag('locomotor');
    expect(collectEquippedItemActions(s.staff, s.doer, other, true)).toEqual([]);

    const action = createBufferedAction('CASTSPELL', { doer: s.doer, target: creature, invobject: s.staff });
    expect(action.do()).toBe(true);
    expect([creature.position.x, creature.position.z, creature.IsVisible()]).toEqual([30, 0, true]);
    expect(teleported).toHaveBeenCalledOnce();
    expect(s.world.sendLightningStrike).toHaveBeenNthCalledWith(1, new THREE.Vector3(-10, 0, 5));
    expect(s.world.sendLightningStrike).toHaveBeenNthCalledWith(2, new THREE.Vector3(30, 0, 0));
    expect(s.player.sg.stateName).not.toBe('forcetele');

    // A noteleport target is targetable, but only the use, strike and costs happen.
    creature.addTag('noteleport');
    creature.setPosition(-10, 0, 5);
    expect(createBufferedAction('CASTSPELL', { doer: s.doer, target: creature, invobject: s.staff }).do()).toBe(true);
    expect(creature.position.x).toBe(-10);
    expect(s.staff.components.finiteuses.remaining).toBe(TELESTAFF_USES - 2);
  } finally {
    s.store.dispose();
  }
});

it('is given by c_give, spawned by c_spawn, and keeps its uses and the world topology through c_save', async () => {
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  const inventory = createInventoryStore([]),
    scene = new THREE.Scene(),
    player = new THREE.Group();
  const ground = new ItemWorldFixture(
    scene,
    new THREE.PerspectiveCamera(),
    { domElement: new EventTarget() } as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip',
    inventory,
    '/dst/data/anim',
    player,
  );
  const registry = new EntityRegistry();
  registry.register(
    PREFAB_DEFINITIONS.groundItems,
    ground.registration(
      () => player.position,
      id => `dug:${id}`,
    ),
  );
  try {
    expect((await executeDebugCommand('c_spawn("telestaff")', inventory, id => registry.spawn(id))).ok).toBe(true);
    expect(Object.keys(itemEntities(ground.exportEntities()))).toEqual(['telestaff']);
    expect((await executeDebugCommand('c_give("telestaff")', inventory)).ok).toBe(true);
    const staff = inventory.FindItem(item => item.prefab === 'telestaff')!;
    expect(staff.components.finiteuses.use(1)).toBe(true);
    const nodes = [
      { x: 30, z: -12, type: 0 },
      { x: 60, z: 0, type: 7 },
    ];
    const template = deserializeSave(
      JSON.stringify({
        ...initialWorld,
        world: { ...initialWorld.world, map: { ...initialWorld.world.map, topology: { nodes } } },
      }),
      SAVE_CATALOG,
    );
    const saved = deserializeSave(
      serializeSave(
        template,
        {
          entities: {},
          inventory: inventory.exportSaved(),
          elapsedSeconds: 0,
          playerTransform: { position: [0, 0, 0], rotationY: 0 },
        },
        SAVE_CATALOG,
      ),
      SAVE_CATALOG,
    );
    expect(saved.world.map.topology).toEqual({ nodes });
    expect(JSON.stringify(saved.players.local)).toMatch(/"prefab":"telestaff".*"finiteuses":\{"uses":4\}/);
  } finally {
    registry.dispose();
    inventory.dispose();
  }
});
