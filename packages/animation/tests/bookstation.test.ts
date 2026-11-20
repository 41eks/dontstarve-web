import { withEntity } from './entityFixture';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { inventorySlotAddress } from '../../inventory/src';

import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { BookstationInstance } from '../../prefab/src/bookstation';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import type { WorldContext } from '../../prefab/src/worldContext';
import { smallHash } from '../src/animationAssets';
import { createPickupInventory } from './pickupFixture';
import { managedBuildings } from './managedBuildings';
import { executeDebugCommand } from '../../../src/debugCommands';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';

import { testItem, testRestoreItem } from './testInventory';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const held = inventorySlotAddress(0),
  shelf = (slot: number) => ({ containerId: 'world:bookstation:shelf', slotKey: String(slot) });

function stubArt() {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', {
    createElement: () => ({ setAttribute: vi.fn(), style: {} }),
    body: { appendChild: vi.fn() },
  });
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
}

/** The world a bookstation is spawned in: the shared manager, the inventory its shelf registers with, and the player. */
function stationWorld(scheduler = new GameTimeScheduler(), tags: string[] = [], playerAt = new THREE.Vector3()) {
  const inventory = createPickupInventory(),
    player = withEntity(new THREE.Group(), 'wilson', tags);
  player.position.copy(playerAt);
  const world = {
    scene: new THREE.Scene(),
    player,
    camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() },
    scheduler,
    registerContainer: (...args: Parameters<typeof inventory.registerContainer>) =>
      inventory.registerContainer(...args),
    unregisterContainer: (...args: Parameters<typeof inventory.unregisterContainer>) =>
      inventory.unregisterContainer(...args),
    spawnItem: testItem,
    restoreItem: testRestoreItem,
  } as unknown as WorldContext;
  return { inventory, scheduler, buildings: managedBuildings(world) };
}

function createStation(tags: string[] = [], playerAt = new THREE.Vector3(0, 0, 0)) {
  stubArt();
  const { inventory, scheduler, buildings } = stationWorld(undefined, tags, playerAt);
  const model = buildings.spawnFromSave('bookstation', {
    id: 'shelf',
    transform: { position: [0, 0, 0], rotationY: 0 },
    components: { building: {} },
  });
  const inst = prefabInstance(model) as BookstationInstance;
  const container = inst.components.container!;
  /** UpdateBookAesthetics: the book layers inst.AnimState hides. */
  const hidden = () =>
    new Set(['empty', 'mid', 'full'].filter(layer => inst.AnimState.json.peek().hiddenLayers.has(smallHash(layer))));
  const dispose = () => {
    buildings.dispose();
    inventory.dispose();
    scheduler.dispose();
  };
  return {
    inventory,
    scheduler,
    inst,
    container,
    hidden,
    dispose,
    uses: (slot: number) => container.GetItemInSlot(slot + 1)!.components.finiteuses,
  };
}

it('accepts only bookcabinet items, shows shelf layers by fill level and restores book uses over time', async () => {
  const { inventory, scheduler, inst, container, hidden, uses, dispose } = createStation();
  try {
    expect([...hidden()].sort()).toEqual(['empty', 'full', 'mid']); // an empty cabinet hides every layer
    inventory.add('cutgrass', 1);
    expect(inventory.transfer(held, shelf(0), 1)).toBe(false);
    expect(container.IsEmpty()).toBe(true);

    inventory.add('book_rain', 1);
    const second = inventorySlotAddress(1);
    inventory.getEntity(second)!.components.finiteuses.use(2);
    expect(inventory.transfer(second, shelf(0), 1)).toBe(true);
    await Promise.resolve(); // ItemGet runs from the container's slots as a queued effect
    expect(hidden().has('empty')).toBe(false);
    expect(hidden().has('mid')).toBe(true);
    expect(inst.RestoreTask).toBeDefined();

    scheduler.advance(29.9);
    expect(uses(0).remaining).toBe(3);
    scheduler.advance(0.2);
    expect(uses(0).remaining).toBeCloseTo(3.05);
    // The period repeats and survives the saved fractional uses.
    scheduler.advance(30 * 39);
    expect(uses(0).remaining).toBe(5);
    expect(container.OnSave().items[1].components.finiteuses?.uses).toBe(5);

    expect(inventory.transfer(shelf(0), second, 1)).toBe(true);
    await Promise.resolve();
    expect(inst.RestoreTask).toBeUndefined();
    scheduler.advance(300);
    expect(inventory.getEntity(second)!.components.finiteuses.remaining).toBe(5);
    expect(hidden().has('empty')).toBe(true);
  } finally {
    dispose();
  }
});

it('doubles the restore for a nearby bookbuilder and stops when the station burns down', async () => {
  const near = createStation(['bookbuilder']),
    far = createStation(['bookbuilder'], new THREE.Vector3(500, 0, 0));
  try {
    for (const { inventory } of [near, far]) {
      inventory.add('book_rain', 1);
      inventory.getEntity(held)!.components.finiteuses.use(2);
      inventory.transfer(held, shelf(0), 1);
    }
    await Promise.resolve();
    near.scheduler.advance(30);
    far.scheduler.advance(30);
    expect(near.uses(0).remaining).toBeCloseTo(3.1);
    expect(far.uses(0).remaining).toBeCloseTo(3.05);

    // DefaultBurntStructureFn drops the books, and ItemLose cancels the task.
    near.inst.components.burnable!.onburnt!(near.inst);
    await Promise.resolve();
    expect(near.inst.hasTag('burnt')).toBe(true);
    expect(near.inst.components.container).toBeUndefined();
    expect(near.inst.RestoreTask).toBeUndefined();
  } finally {
    near.dispose();
    far.dispose();
  }
});

it('spawns a skinned bookstation through c_spawn and keeps books with fractional uses through c_save and reload', async () => {
  stubArt();
  const library = (slot: number) => ({ containerId: 'world:bookstation:library', slotKey: String(slot) });
  const scheduler = new GameTimeScheduler();
  const { inventory, buildings } = stationWorld(scheduler);
  const { inventory: restored, buildings: restoredBuildings } = stationWorld(scheduler);
  try {
    const spawn = async (id: string) => {
      if (id !== 'bookstation') {
        return false;
      }
      buildings.spawnFromSave('bookstation', {
        id: 'library',
        transform: { position: [3, 0, -6], rotationY: 0 },
        components: { building: { skinId: 'bookstation_house' } },
      });
      return true;
    };
    expect(
      (await executeDebugCommand('c_spawn("bookstation"); c_give("book_rain"); c_give("papyrus", 3)', inventory, spawn))
        .ok,
    ).toBe(true);
    const book = inventory.getEntity(held)!;
    book.components.finiteuses.use(2);
    inventory.transfer(held, library(0), 1);
    inventory.transfer(inventorySlotAddress(1), { ...library(0), slotKey: '1' }, 3);
    await Promise.resolve();
    scheduler.advance(30);
    let json = '';
    expect(
      (
        await executeDebugCommand('c_save()', inventory, undefined, () => {
          const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
          const records = buildings.exportRecords().filter(({ prefabId }) => prefabId === 'bookstation');
          json = serializeSave(
            template,
            {
              entities: {
                bookstation: records.map(({ record }) => ({
                  ...record,
                  transform: { ...record.transform, position: [...record.transform.position] },
                })),
              },
              inventory: inventory.exportSaved(),
              elapsedSeconds: 0,
              playerTransform: { position: [0, 0, 0], rotationY: 0 },
            },
            SAVE_CATALOG,
          );
        })
      ).ok,
    ).toBe(true);
    const save = deserializeSave(json, SAVE_CATALOG),
      record = save.world.entities.bookstation[0];
    expect(record.components.building?.skinId).toBe('bookstation_house');
    expect(Object.keys(record.components.container?.items ?? {})).toHaveLength(2);
    restoredBuildings.spawnFromSave('bookstation', record);
    expect(restored.getEntity(library(0))!.snapshot()).toEqual(book.snapshot());
    expect(restored.getEntity(library(0))!.snapshot().remainingUses).toBeCloseTo(3.05);
    expect(restored.getEntity({ ...library(0), slotKey: '1' })).toMatchObject({ prefab: 'papyrus' });
  } finally {
    buildings.dispose();
    restoredBuildings.dispose();
    inventory.dispose();
    restored.dispose();
    scheduler.dispose();
  }
});

it('moves a partly used 3-use book between slots and restores it in 0.03 steps', async () => {
  const { inventory, scheduler, uses, dispose } = createStation();
  try {
    inventory.add('book_moon', 1);
    inventory.getEntity(held)!.components.finiteuses.use(1);
    const second = inventorySlotAddress(1);
    expect(inventory.transfer(held, second, 1)).toBe(true);
    expect(inventory.transfer(second, shelf(0), 1)).toBe(true);
    await Promise.resolve();
    scheduler.advance(30);
    expect(uses(0).remaining).toBeCloseTo(2.03);
    expect(inventory.transfer(shelf(0), held, 1)).toBe(true);
  } finally {
    dispose();
  }
});
