import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import { Burnable } from '../../componets/src/burnable';
import { Combat, type CombatActor } from '../../componets/src/combat';
import { ComponentUpdates } from '../../componets/src/componentUpdates';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { FREEZE_COLOUR } from '../../componets/src/freezable';
import { ICE_PROJECTILE_ID, staffProjectilePrefabs, type StaffProjectileInstance } from '../src/staff_projectile';
import { PrefabEntityManager, type PrefabInstance } from '../src/prefabInstance';
import { beehivePrefabs, BEEHIVE_ID, BeehiveInstance } from '../src/beehive';
import { PlaySound } from '../src/sound';
import { inventorySlotAddress } from '../../inventory/src';
import { collectEquippedItemActions } from '../../stategraphs/src/componentactions';
import { getActionString } from '../../stategraphs/src/actions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { createInventoryStore } from '../../../tests/fixtures/testInventory';

vi.mock('../src/sound', async importOriginal => ({
  ...(await importOriginal<object>()),
  PlaySound: vi.fn(() => ({ stop: vi.fn(), isPlaying: () => false })),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The player's combat with an ice staff from its inventory, and a real beehive as the target. */
function setup() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  const inventory = createInventoryStore([{ slot_index: 0, id: 'icestaff', num: 1 }]);
  const scheduler = new GameTimeScheduler(),
    componentUpdates = new ComponentUpdates();
  const fx = { spawn: vi.fn(), shatter: vi.fn() };
  const displays = new PrefabDisplayGroup(new THREE.Scene());
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(
    displays,
    '/dst/data/anim',
    { scheduler },
    {
      ...staffProjectilePrefabs({ fx, componentUpdates }),
      ...beehivePrefabs({ scheduler, fx }),
    },
  );
  const staff = inventory.getEntity(inventorySlotAddress(0))!;
  const sanity = vi.fn();
  const attacker: CombatActor = {
    getPosition: () => new THREE.Vector3(0, 0, 0),
    getPhysicsRadius: () => 0.5,
    hasTag: tag => tag === 'player',
    components: { sanity: { DoDelta: sanity } },
  };
  const combat = new Combat(
    attacker,
    () => scheduler.now,
    () => staff.components.weapon,
  );
  combat.SetRange(2);
  attacker.components.combat = combat;
  staff.BindWorld({ spawnPrefab: (prefab, position) => prefabs.spawn(prefab, position) });
  const hive = prefabs.spawnAs(BeehiveInstance, BEEHIVE_ID, new THREE.Vector3(12, 0, 0));
  const fly = (seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      componentUpdates.update(1 / 60);
    }
  };
  /** One left-click attack: combat:DoAttack launches the projectile, which hits the hive in flight. */
  const shoot = () => {
    expect(combat.DoAttack(hive as never)).toBe(true);
    fly(1);
  };
  const tint = () => hive.sprite.sprite.value.tint?.add;
  const override = () => hive.sprite.sprite.value.appearance.get('archive-symbol:swap_frozen');
  return {
    inventory,
    staff,
    combat,
    attacker,
    sanity,
    hive,
    prefabs,
    fx,
    scheduler,
    shoot,
    tint,
    override,
    dispose: () => {
      prefabs.dispose();
      displays.dispose();
      componentUpdates.dispose();
      scheduler.dispose();
      inventory.dispose();
    },
  };
}

it('is a ranged extinguisher weapon whose ice projectile freezes a beehive on its second hit, which thaws and shatters', () => {
  const s = setup();
  try {
    expect(
      ['icestaff', 'weapon', 'rangedweapon', 'extinguisher', 'shadowlevel'].every(tag => s.staff.hasTag(tag)),
    ).toBe(true);
    expect([s.staff.components.weapon!.GetDamage(), s.staff.icestaff_coldness]).toEqual([0, 1]);
    // EQUIPPED weapon: the left button attacks a combat target; the right button does nothing to it.
    expect(collectEquippedItemActions(s.staff, s.attacker as never, s.hive as never, false)).toEqual(['ATTACK']);
    expect(collectEquippedItemActions(s.staff, s.attacker as never, s.hive as never, true)).toEqual([]);
    const freezable = s.hive.components.freezable;
    expect([freezable.resistance, freezable.fxlevel]).toEqual([2, 3]);

    s.shoot();
    const [projectile] = s.prefabs.instances(ICE_PROJECTILE_ID) as Iterable<StaffProjectileInstance>;
    expect(projectile).toBeUndefined();
    // One coldness of two: half the freeze tint, one sanity point and one use.
    expect(freezable.coldness.value).toBe(1);
    expect(s.tint()).toEqual(FREEZE_COLOUR.slice(0, 3).map(value => value * 0.5));
    expect([s.sanity.mock.calls, s.staff.components.finiteuses.remaining]).toEqual([[[-1]], 19]);
    // onattack_blue's SpawnShatterFX plays the hive's level 3 shatter at the hive.
    expect(s.fx.shatter).toHaveBeenLastCalledWith(new THREE.Vector3(12, 0, 0), 3);

    s.shoot();
    expect([freezable.state.value, s.hive.sprite.sprite.value.clip?.name]).toEqual(['FROZEN', 'frozen']);
    expect(s.override()).toMatchObject({ archive: 'frozen.zip', sourceSymbol: 'frozen' });
    expect(s.tint()).toEqual(FREEZE_COLOUR.slice(0, 3));
    expect(vi.mocked(PlaySound).mock.calls.map(([path]) => path)).toContain('dontstarve/common/freezecreature');

    // freezable: thaw after wearofftime, unfreeze after the same again; Unfreeze shatters and clears the tint.
    s.fx.shatter.mockClear();
    s.scheduler.advance(10);
    expect([freezable.state.value, s.hive.sprite.sprite.value.clip?.name]).toEqual(['THAWING', 'frozen_loop_pst']);
    s.scheduler.advance(10);
    expect([freezable.state.value, s.hive.sprite.sprite.value.clip?.name]).toEqual(['NORMAL', 'cocoon_small']);
    expect(s.override()).toMatchObject({ archive: undefined });
    expect(s.tint()).toEqual([0, 0, 0]);
    expect(s.fx.shatter).toHaveBeenCalledExactlyOnceWith(new THREE.Vector3(12, 0, 0), 3);
  } finally {
    s.dispose();
  }
});

it('breaks the ice on any attack, wears coldness off point by point, and extinguishes a burning target on either button', () => {
  const s = setup();
  try {
    const freezable = s.hive.components.freezable;
    freezable.AddColdness(1);
    s.scheduler.advance(10);
    expect([freezable.coldness.value, s.tint()]).toEqual([0, [0, 0, 0]]);
    freezable.AddColdness(2);
    expect(freezable.IsFrozen()).toBe(true);
    // damagetobreak is 0: an attacked event with no damage still breaks it.
    s.hive.PushEvent('attacked', { attacker: s.attacker as never, damage: 0 });
    expect([freezable.state.value, s.hive.sprite.sprite.value.clip?.name]).toEqual(['NORMAL', 'cocoon_small']);

    // A burning hive is an extinguish target (RANGEDSMOTHER) on either button; the hit puts it out.
    const burnable = s.hive.components.burnable as Burnable;
    burnable.Ignite();
    for (const right of [false, true]) {
      expect(collectEquippedItemActions(s.staff, s.attacker as never, s.hive as never, right)).toEqual(['ATTACK']);
    }
    expect(
      getActionString({ action: 'ATTACK', doer: s.attacker as never, target: s.hive as never, invobject: s.staff }),
    ).toBe('扑灭');
    s.shoot();
    expect(burnable.IsBurning()).toBe(false);
  } finally {
    s.dispose();
  }
});

it('is given by c_give and spawned by c_spawn, and keeps its uses through c_save', async () => {
  const inventory = createInventoryStore([]);
  try {
    expect((await executeDebugCommand('c_give("icestaff")', inventory)).ok).toBe(true);
    const staff = inventory.FindItem(item => item.prefab === 'icestaff')!;
    expect(staff.components.finiteuses.use(5)).toBe(true);
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
    expect(JSON.stringify(saved.players.local)).toMatch(/"prefab":"icestaff".*"finiteuses":\{"uses":15\}/);
  } finally {
    inventory.dispose();
  }
});
