import { createEmptyEntity } from '../../prefab/src/prefabInstance';

import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { inventorySlotAddress } from '../../inventory/src';

import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { Bookstation, BOOKSTATION_DEFINITION } from '../../prefab/src/bookstation';
import { createBuildingContainer } from '../../prefab/src/containers';
import type { WorldContext } from '../../prefab/src/worldContext';
import { createPickupInventory } from './pickupFixture';
import { executeDebugCommand } from '../../../src/debugCommands';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const held = inventorySlotAddress(0), shelf = (slot: number) => ({ containerId: 'world:bookstation:shelf', slotKey: String(slot) });

function createStation(tags: string[] = [], playerAt = new THREE.Vector3(0, 0, 0)) {
  const inventory = createPickupInventory(), scheduler = new GameTimeScheduler();
  const container = createBuildingContainer('bookstation', {});
  inventory.registerContainer(shelf(0).containerId, container);
  const hidden = new Set<string>();
  const { instance, display } = createEmptyEntity('bookstation');
  const model = display.model;
  vi.spyOn(instance.sprite, 'showLayer').mockImplementation(layer => { hidden.delete(layer); });
  vi.spyOn(instance.sprite, 'hideLayer').mockImplementation(layer => { hidden.add(layer); });
  const burn = () => { instance.addTag('burnt'); instance.PushEvent('burntup', undefined); };
  const player = new THREE.Object3D();
  player.position.copy(playerAt);
  player.userData.tags = tags;
  const station = new Bookstation({ model, container, world: { scheduler, player } as unknown as WorldContext });
  const dispose = station.dispose.bind(station);
  station.dispose = () => { dispose(); instance.remove(); display.dispose(); };
  return { inventory, scheduler, container, station, hidden, burn, uses: (slot: number) => container.GetItemInSlot(slot + 1)!.components.finiteuses };
}

it('accepts only bookcabinet items, declares shelf layers synchronously by fill level and restores book uses over time', () => {
  const { inventory, scheduler, container, station, hidden, uses } = createStation();
  try {
    expect([...hidden].sort()).toEqual(["empty", "full", "mid"]); // an empty cabinet hides every layer
    inventory.add('cutgrass', 1);
    expect(inventory.transfer(held, shelf(0), 1)).toBe(false);
    expect(container.IsEmpty()).toBe(true);

    inventory.add('book_rain', 1);
    const second = inventorySlotAddress(1);
    inventory.getEntity(second)!.components.finiteuses.use(2);
    expect(inventory.transfer(second, shelf(0), 1)).toBe(true);
    expect(hidden.has('empty')).toBe(false);
    expect(hidden.has('mid')).toBe(true);
    expect(station.restore.peek().status).toBe('scheduled');

    scheduler.advance(29.9);
    expect(uses(0).remaining).toBe(3);
    scheduler.advance(.2);
    expect(uses(0).remaining).toBeCloseTo(3.05);
    // The period repeats and survives the saved fractional uses.
    scheduler.advance(30 * 39);
    expect(uses(0).remaining).toBe(5);
    expect(container.OnSave().items['1'].remainingUses).toBe(5);

    expect(inventory.transfer(shelf(0), second, 1)).toBe(true);
    expect(station.restore.peek().status).toBe('stopped');
    scheduler.advance(300);
    expect(inventory.getEntity(second)!.components.finiteuses.remaining).toBe(5);
    expect(hidden.has('empty')).toBe(true);
  } finally { station.dispose(); inventory.dispose(); }
});

it('doubles the restore for a nearby bookbuilder and stops when the station burns down', async () => {
  const near = createStation(['bookbuilder']), far = createStation(['bookbuilder'], new THREE.Vector3(500, 0, 0));
  try {
    for (const { inventory } of [near, far]) {
      inventory.add('book_rain', 1);
      inventory.getEntity(held)!.components.finiteuses.use(2);
      inventory.transfer(held, shelf(0), 1);
    }
    near.scheduler.advance(30); far.scheduler.advance(30);
    expect(near.uses(0).remaining).toBeCloseTo(3.1);
    expect(far.uses(0).remaining).toBeCloseTo(3.05);

    near.burn();
    await Promise.resolve(); // createEffect runs queued effects on the microtask queue
    expect(near.station.restore.peek().status).toBe('stopped');
    near.scheduler.advance(300);
    expect(near.uses(0).remaining).toBeCloseTo(3.1);
  } finally {
    for (const { station, inventory } of [near, far]) { station.dispose(); inventory.dispose(); }
  }
});

it('spawns a skinned bookstation through c_spawn and keeps books with fractional uses through c_save and reload', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const library = (slot: number) => ({ containerId: 'world:bookstation:library', slotKey: String(slot) });
  const inventory = createPickupInventory(), restored = createPickupInventory(), scheduler = new GameTimeScheduler();
  const world = { scene: new THREE.Scene(), player: new THREE.Group(), camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() }, scheduler,
    registerContainer: (...args: Parameters<typeof inventory.registerContainer>) => inventory.registerContainer(...args),
    unregisterContainer: (...args: Parameters<typeof inventory.unregisterContainer>) => inventory.unregisterContainer(...args),
  } as unknown as WorldContext;
  const placement = new AnimatedBuildingPlacement(world, { bookstation: BOOKSTATION_DEFINITION }, () => false);
  try {
    const spawn = async (id: string) => {
      if (id !== 'bookstation') return false;
      await placement.spawnFromSave('bookstation', { id: 'library', transform: { position: [3, 0, -6], rotationY: 0 },
        components: { building: { state: 'idle', skinId: 'bookstation_house' } } });
      return true;
    };
    expect((await executeDebugCommand('c_spawn("bookstation"); c_give("book_rain"); c_give("papyrus", 3)', inventory, spawn)).ok).toBe(true);
    const book = inventory.getEntity(held)!;
    book.components.finiteuses.use(2);
    inventory.transfer(held, library(0), 1);
    inventory.transfer(inventorySlotAddress(1), { ...library(0), slotKey: '1' }, 3);
    scheduler.advance(30);
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
      json = serializeSave(template, { entities: { bookstation: placement.exportRecords().map(({ record }) => ({ ...record,
        transform: { ...record.transform, position: [...record.transform.position] } })) },
        inventory: inventory.exportState(), elapsedSeconds: 0, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const save = deserializeSave(json, SAVE_CATALOG), record = save.world.entities.bookstation[0];
    expect(record.components.building?.skinId).toBe('bookstation_house');
    expect(record.components.container?.slots).toHaveLength(2);
    restored.registerContainer(library(0).containerId, createBuildingContainer('bookstation', {}));
    restored.replaceState(inventoryStateFromSave(save), SAVE_CATALOG.recipes);
    expect(restored.getEntity(library(0))!.snapshot()).toEqual(book.snapshot());
    expect(restored.getEntity(library(0))!.snapshot().remainingUses).toBeCloseTo(3.05);
    expect(restored.getEntity({ ...library(0), slotKey: '1' })).toMatchObject({ prefab: 'papyrus' });
  } finally { placement.dispose(); inventory.dispose(); restored.dispose(); scheduler.dispose(); }
});

it('moves a partly used 3-use book between slots and restores it in 0.03 steps', () => {
  const { inventory, scheduler, station, uses } = createStation();
  try {
    inventory.add('book_moon', 1);
    inventory.getEntity(held)!.components.finiteuses.use(1);
    const second = inventorySlotAddress(1);
    expect(inventory.transfer(held, second, 1)).toBe(true);
    expect(inventory.transfer(second, shelf(0), 1)).toBe(true);
    scheduler.advance(30);
    expect(uses(0).remaining).toBeCloseTo(2.03);
    expect(inventory.transfer(shelf(0), held, 1)).toBe(true);
  } finally { station.dispose(); inventory.dispose(); }
});
