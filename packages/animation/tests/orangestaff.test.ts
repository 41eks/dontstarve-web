import { prefabWorldMap } from './prefabWorldMapFixture';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GameTimeScheduler } from '../../signals/src/gameTimeScheduler';
import { HandSlot, InventorySlot, equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { addComponent } from '../../prefab/src/components';
import { CANE_DAMAGE, ORANGESTAFF_USES } from '../../prefab/src/staff';
import { GetSpeedMultiplier } from '../../prefab/src/player_common';
import { Sanity } from '../../componets/src/sanity';
import { createBufferedAction } from '../../stategraphs/src/actionfns';
import { collectPointActions } from '../../stategraphs/src/componentactions';
import { INVENTORY_ITEM_SPECS } from '../../../src/inventoryItems';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { ItemWorldFixture, itemEntities } from './itemWorldFixture';
import { createInventoryStore, testInventoryStore } from './testInventory';
import { testPlayer } from './testPlayer';
import { wilsonPlayer, played } from './wilsonPlayer';

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop() {} })),
}));
beforeEach(() => vi.stubGlobal('window', new EventTarget()));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const FRAMES = 1 / 30;

/** An orangestaff in the player's hand; land is x < 80 and a blocker stands at (40, 0, 40). */
function fixture(remainingUses?: number) {
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
    map: prefabWorldMap({
      isLandTileAtPoint: point => point.x < 80,
      isPassableAtPoint: point => point.x < 80,
      isGroundTargetBlocked: point => point.distanceTo(new THREE.Vector3(40, 0, 40)) < 1,
    }),
    spawnFx: vi.fn(),
  };
  const scheduler = new GameTimeScheduler();
  const player = wilsonPlayer(name => (name === 'atk_pre' ? 8 : name === 'atk' ? 14 : 30) / 30);
  player.BindScheduler(scheduler);
  const doer = testPlayer({ model: player.transform.model, inventory: store });
  const sanity = vi.spyOn(addComponent(doer, 'sanity', Sanity, 200), 'DoDelta');
  store.add('orangestaff', 1, undefined, undefined, remainingUses);
  store.transfer(bag, hand, 1);
  const staff = store.getEntity(hand)!;
  staff.BindWorld({ map: world.map, spawnPrefab: world.spawnFx });
  const blink = (point: THREE.Vector3) =>
    player.sg.pushBufferedAction(createBufferedAction('BLINK', { doer, invobject: staff, pos: point }));
  return { store, staff, world, player, doer, sanity, scheduler, blink, hand };
}

it('is a cane that speeds its wearer up, hits for cane damage without wearing out, and offers BLINK on open land', () => {
  const s = fixture();
  try {
    expect(['weapon', 'shadowlevel'].map(tag => s.staff.hasTag(tag))).toEqual([true, true]);
    expect(s.staff.components.weapon!.GetDamage()).toBe(CANE_DAMAGE);
    expect(GetSpeedMultiplier(s.player)).toBe(1.25);
    // A cane's combat durability loss is ignored: only blinking spends uses.
    s.staff.components.weapon!.OnAttack(s.doer as never, s.doer as never);
    expect(s.staff.components.finiteuses.remaining).toBeUndefined();
    expect(collectPointActions(s.staff, s.doer as never, new THREE.Vector3(30, 0, 0), true)).toEqual(['BLINK']);
    expect(collectPointActions(s.staff, s.doer as never, new THREE.Vector3(30, 0, 0), false)).toEqual([]);
    expect(collectPointActions(s.staff, s.doer as never, new THREE.Vector3(90, 0, 0), true)).toEqual([]);
    expect(collectPointActions(s.staff, s.doer as never, new THREE.Vector3(40, 0, 40), true)).toEqual([]);
    s.store.transfer(s.hand, inventorySlotAddress(0), 1);
    expect(GetSpeedMultiplier(s.player)).toBe(1);
  } finally {
    s.store.dispose();
  }
});

it('blinks on quicktele frame 8 and reappears at the point a quarter second later', () => {
  const s = fixture();
  try {
    expect(s.blink(new THREE.Vector3(30, 0, -6))).toBe(true);
    expect(s.player.sg.stateName).toBe('quicktele');
    s.player.sg.update(7 * FRAMES);
    expect(s.world.spawnFx).not.toHaveBeenCalled();
    s.player.sg.update(FRAMES);
    // Blink: puffs at the start, the presound, the caster hidden, sanity and one use.
    expect(s.world.spawnFx).toHaveBeenNthCalledWith(1, 'sand_puff_large_back', new THREE.Vector3(0, -0.1, 0));
    expect(s.world.spawnFx).toHaveBeenNthCalledWith(2, 'sand_puff_large_front', new THREE.Vector3(0, 0, 0));
    expect(played(s.player)).toEqual(['dontstarve/wilson/attack_weapon', 'dontstarve/common/staff_blink']);
    expect([s.player.IsVisible(), s.player.sg.hasStateTag('noattack')]).toEqual([false, true]);
    expect(s.sanity).toHaveBeenCalledExactlyOnceWith(-15);
    expect(s.staff.components.finiteuses.remaining).toBe(ORANGESTAFF_USES - 1);
    // Frame 18 keeps busy while hidden; OnBlinked ends it.
    s.player.sg.update(10 * FRAMES);
    expect(s.player.sg.hasStateTag('busy')).toBe(true);
    s.scheduler.advance(0.24);
    expect(s.player.position.x).toBe(0);
    s.scheduler.advance(0.01);
    expect([s.player.position.x, s.player.position.z, s.player.IsVisible()]).toEqual([30, -6, true]);
    expect(s.player.sg.hasStateTag('busy')).toBe(false);
    expect(s.world.spawnFx).toHaveBeenLastCalledWith('sand_puff_large_front', new THREE.Vector3(30, 0, -6));
    expect(played(s.player).at(-1)).toBe('dontstarve/common/staff_blink');
  } finally {
    s.store.dispose();
  }
});

it('refuses an impassable point and shows the player again when quicktele is interrupted', () => {
  const s = fixture(1);
  try {
    s.blink(new THREE.Vector3(90, 0, 0));
    s.player.sg.update(8 * FRAMES);
    expect([s.world.spawnFx, s.sanity].map(fn => vi.mocked(fn).mock.calls.length)).toEqual([0, 0]);
    expect(s.staff.components.finiteuses.remaining).toBe(1);
    s.player.sg.update(30 * FRAMES);

    // The last use: the staff breaks as the blink starts; an interruption reveals the hidden player.
    s.blink(new THREE.Vector3(10, 0, 0));
    s.player.sg.update(8 * FRAMES);
    expect(s.staff.isRemoved).toBe(true);
    expect(s.player.IsVisible()).toBe(false);
    s.player.sg.GoToState('wakeup');
    expect(s.player.IsVisible()).toBe(true);
  } finally {
    s.store.dispose();
  }
});

it('is given by c_give, spawned by c_spawn, and keeps its uses through c_save', async () => {
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
    expect((await executeDebugCommand('c_spawn("orangestaff")', inventory, id => registry.spawn(id))).ok).toBe(true);
    expect(Object.keys(itemEntities(ground.exportEntities()))).toEqual(['orangestaff']);
    expect((await executeDebugCommand('c_give("orangestaff")', inventory)).ok).toBe(true);
    const staff = inventory.FindItem(item => item.prefab === 'orangestaff')!;
    expect(staff.components.finiteuses.use(3)).toBe(true);
    const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
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
    expect(JSON.stringify(saved.players.local)).toMatch(/"prefab":"orangestaff".*"finiteuses":\{"uses":17\}/);
  } finally {
    registry.dispose();
    inventory.dispose();
  }
});
