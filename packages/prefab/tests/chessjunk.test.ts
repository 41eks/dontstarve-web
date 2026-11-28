import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Repairer } from '../../componets/src/repairer';
import { chessJunkPrefabs, CHESSJUNK_IDS, type ChessJunkId, ChessJunkInstance } from '../src/chessjunk';
import { PrefabEntityManager, type PrefabInstance } from '../src/prefabInstance';
import type { EntitySaveRecord } from '../src/saveRecord';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { createPickupInventory } from '../../../tests/fixtures/pickupFixture';
import { workTargets } from '../../../tests/fixtures/workTargets';

function setup(playerPosition = new THREE.Vector3()) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  const scene = new THREE.Scene(),
    scheduler = new GameTimeScheduler(),
    awake = createSignal(true);
  const displays = new PrefabDisplayGroup(scene),
    dropped: string[] = [],
    collapses: string[] = [];
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {
    tickingarea: () => createMemo(() => awake.get()),
    scheduler,
  });
  prefabs.register(
    chessJunkPrefabs({
      scheduler,
      fx: {
        spawn: () => {
          throw new Error('unexpected fx');
        },
        collapse: (size, _position, material) => {
          collapses.push(`${size}:${material}`);
        },
      },
      dropLoot: items => {
        for (const item of items) {
          dropped.push(item.itemId);
        }
      },
    }),
  );
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.chessJunk);
  const spawn = (id: ChessJunkId, record?: EntitySaveRecord) =>
    prefabs.spawnAs(ChessJunkInstance, id, new THREE.Vector3(...(record?.transform.position ?? [0, 0, 0])), record);
  const dispose = () => {
    registry.dispose();
    prefabs.dispose();
    displays.dispose();
    scheduler.dispose();
  };
  return { scheduler, prefabs, registry, spawn, dropped, collapses, dispose };
}
/** A gears stack's repairer. */
function gears(workrepairvalue: number) {
  const item = {
    addTag() {},
    removeTag() {},
    hasTag: () => false,
    getPosition: () => new THREE.Vector3(),
    consumed: 0,
  };
  return Object.assign(item, {
    components: {
      repairer: new Repairer(item as never, 'gears', workrepairvalue),
      stackable: {
        Consume: () => {
          item.consumed++;
          return true;
        },
      },
    },
  });
}
const clip = (pile: ChessJunkInstance) => pile.sprite.sprite.value.clip;
/** The source's PlayAnimation / PushAnimation calls; an undrawn sprite completes a one-shot at once. */
function animations(pile: ChessJunkInstance): string[] {
  const calls: string[] = [];
  vi.spyOn(pile.sprite, 'playOnce').mockImplementation(name => {
    calls.push(`play ${name}`);
  });
  vi.spyOn(pile.sprite, 'pushAnimation').mockImplementation((name, loop) => {
    calls.push(`push ${name}${loop ? ' loop' : ''}`);
  });
  vi.spyOn(pile.sprite, 'start').mockImplementation(name => {
    calls.push(`loop ${name}`);
  });
  return calls;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('hammers a pile: hit then idle each blow, then loot and a metal collapse', () => {
  const { spawn, dropped, collapses, dispose } = setup();
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  try {
    const pile = spawn('chessjunk2');
    expect(pile.listTags()).toEqual(expect.arrayContaining(['chess', 'mech', 'repairable_gears']));
    expect(clip(pile)).toMatchObject({ name: 'idle2', loop: false });
    const calls = animations(pile);
    const target = workTargets('HAMMER').find(entry => entry.id === String(pile.entityId))!;
    target.work();
    expect(calls).toEqual(['play hit2', 'push idle2']);
    target.work();
    target.work();
    expect(pile.isRemoved).toBe(true);
    // chess_junk's guaranteed trinket_6; every other chance fails at .99.
    expect(dropped).toEqual(['trinket_6']);
    expect(collapses).toEqual(['small:metal']);
  } finally {
    dispose();
  }
});

it('repairs a pile to full, saves the repairer and resurrects it after 0.7 s', () => {
  const { scheduler, prefabs, spawn, dropped, dispose } = setup();
  vi.spyOn(Math, 'random').mockReturnValue(0.99);
  try {
    const pile = spawn('chessjunk1');
    const doer = { prefab: 'wilson', userid: 'KU_test' };
    const small = gears(1),
      calls = animations(pile);
    expect(pile.components.repairable.Repair(doer, small)).toBe(true);
    expect(small.consumed).toBe(1);
    expect(pile.components.workable.GetWorkLeft()).toBe(4);
    expect(calls).toEqual(['play hit1', 'push idle1']);
    expect(pile.repaired).toBe(false);

    expect(pile.components.repairable.Repair(doer, gears(2))).toBe(true);
    expect(calls.slice(2)).toEqual(['loop hit1']);
    const [record] = prefabs.exportRecords().map(entry => entry.record);
    expect(record.components).toEqual({ chessJunk: { repaired: true, repairerid: 'KU_test', repairerchar: 'wilson' } });
    expect(
      PREFAB_DEFINITIONS.chessJunk.parseComponents(record.components, 'pile', { prefab: 'chessjunk1' } as never),
    ).toEqual(record.components);

    scheduler.advance(0.69);
    expect(pile.isRemoved).toBe(false);
    scheduler.advance(0.02);
    expect(pile.isRemoved).toBe(true);
    expect(dropped).toEqual(['trinket_6']);
  } finally {
    dispose();
  }
});

it('loads each style, and OnLoad replays a saved repair', () => {
  const { scheduler, prefabs, spawn, dispose } = setup();
  try {
    const piles = CHESSJUNK_IDS.map((id, index) =>
      spawn(id, {
        id: `source-${id}`,
        transform: { position: [index * 4, 0, 3], rotationY: 0 },
        components: index === 2 ? { chessJunk: { repaired: true, repairerid: 'u', repairerchar: 'wendy' } } : {},
      }),
    );
    expect(piles.map(clip)).toMatchObject([
      { name: 'idle1', loop: false },
      { name: 'idle2', loop: false },
      { name: 'hit3', loop: true },
    ]);
    expect(piles[2].components.workable.GetWorkLeft()).toBe(6);
    expect(prefabs.exportRecords().map(({ prefabId, record }) => [prefabId, record.components])).toEqual([
      ['chessjunk1', {}],
      ['chessjunk2', {}],
      ['chessjunk3', { chessJunk: { repaired: true, repairerid: 'u', repairerchar: 'wendy' } }],
    ]);
    scheduler.advance(0.7);
    expect(piles.map(pile => pile.isRemoved)).toEqual([false, false, true]);
  } finally {
    dispose();
  }
});

it('keeps a c_spawn pile and its repair through c_save and a reload', async () => {
  const first = setup(new THREE.Vector3(3, 0, -6)),
    second = setup(),
    inventory = createPickupInventory();
  try {
    expect(
      (await executeDebugCommand('c_spawn("chessjunk2")', inventory, prefab => first.registry.spawn(prefab))).ok,
    ).toBe(true);
    expect((await executeDebugCommand('c_give("chessjunk2")', inventory)).ok).toBe(false);
    const pile = [...first.prefabs.instances('chessjunk2')][0] as ChessJunkInstance;
    pile.components.repairable.Repair({ prefab: 'wilson', userid: 'KU_test' }, gears(3));
    const before = first.registry.exportRecords();
    let json = '';
    expect(
      (
        await executeDebugCommand('c_save()', inventory, undefined, () => {
          json = serializeSave(
            deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
            {
              entities: before,
              inventory: inventory.exportSaved(),
              elapsedSeconds: 1,
              playerTransform: { position: [3, 0, -6], rotationY: 0 },
            },
            SAVE_CATALOG,
          );
        })
      ).ok,
    ).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.chessjunk2!;
    expect(saved).toEqual(before.chessjunk2);
    expect(saved[0]).toMatchObject({
      transform: { position: [3, 0, -6] },
      components: { chessJunk: { repaired: true, repairerid: 'KU_test', repairerchar: 'wilson' } },
    });
    await second.registry.restoreAll({ chessjunk2: saved });
    const restored = second.prefabs.get(saved[0].id) as ChessJunkInstance;
    expect(clip(restored)).toMatchObject({ name: 'hit2', loop: true });
    expect(second.registry.exportRecords().chessjunk2).toEqual(saved);
  } finally {
    first.dispose();
    second.dispose();
    inventory.dispose();
  }
});
