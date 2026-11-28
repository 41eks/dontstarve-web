import * as THREE from 'three';
import { testPlayer } from '../../../tests/fixtures/testPlayer';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { inventorySlotAddress, cursorSlotAddress } from '../../inventory/src';
import { ItemWorldFixture } from '../../../tests/fixtures/itemWorldFixture';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { loadSavedInventory } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { BUTTERFLY_PERISH_TIME } from '../src/butterfly';
import { createPerishWorld } from '../../../tests/fixtures/perishWorldFixture';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { createInventoryStore } from '../../../tests/fixtures/testInventory';

vi.mock('../src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop() {} })),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('settles captured butterflies every ten seconds and preserves freshness through cursor transfer and save/load', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  const world = createPerishWorld(),
    restoredWorld = createPerishWorld();
  const inventory = createInventoryStore([]),
    restored = createInventoryStore([]);
  inventory.entities.bindPerishWorld(world);
  restored.entities.bindPerishWorld(restoredWorld);
  const scene = new THREE.Scene(),
    player = new THREE.Group();
  const ground = new ItemWorldFixture(
    scene,
    new THREE.PerspectiveCamera(),
    { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip',
    inventory,
    '/dst/data/anim',
    player,
  );
  ground.entities.bindPerishWorld(world);
  const restoredGround = new ItemWorldFixture(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer,
    '/dst/data/databundles/images.zip',
    restored,
    '/dst/data/anim',
    player,
  );
  try {
    const address = inventorySlotAddress(0);
    expect((await executeDebugCommand('c_give("butterfly",2)', inventory)).ok).toBe(true);
    const entity = inventory.getEntity(address)!,
      perish = entity.components.perishable;
    expect(perish.perishtime.value).toBe(BUTTERFLY_PERISH_TIME);
    expect(entity.hasTag('show_spoilage')).toBe(true);
    const timer = perish.timer.value;
    world.advance(9);
    expect(perish.timer.value).toBe(timer);
    world.advance(1);
    expect(perish.timer.value).toEqual({ status: 'perishing', remainingSeconds: 1430 });
    world.advance(3);
    inventory.exportState();
    expect(perish.timer.value).toEqual({ status: 'perishing', remainingSeconds: 1427 });
    world.advance(7);
    inventory.exportState();
    expect(perish.timer.value).toEqual({ status: 'perishing', remainingSeconds: 1420 });
    expect(inventory.transfer(address, cursorSlotAddress(), 2)).toBe(true);
    let json = '';
    const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
    expect(
      (
        await executeDebugCommand('c_save()', inventory, undefined, () => {
          json = serializeSave(
            template,
            {
              entities: {},
              inventory: inventory.exportSaved(),
              elapsedSeconds: world.scheduler.now,
              playerTransform: { position: [0, 0, 0], rotationY: 0 },
            },
            SAVE_CATALOG,
          );
        })
      ).ok,
    ).toBe(true);
    loadSavedInventory(restored, deserializeSave(json, SAVE_CATALOG), SAVE_CATALOG.recipes);
    expect(restored.exportState()).toEqual(inventory.exportState());
    expect(restored.getEntity(cursorSlotAddress())!.components.perishable.GetPercent()).toBeCloseTo(1420 / 1440);
    // c_spawn creates a live butterfly whose starvation is stopped until captured.
    expect(
      (
        await executeDebugCommand('c_spawn("butterfly")', inventory, async id => {
          await ground.spawnFromSave(
            'wild',
            { ...SAVE_CATALOG.items[id], itemId: id, count: 1 },
            new THREE.Vector3(30, 0, 0),
          );
          return true;
        })
      ).ok,
    ).toBe(true);
    const wild = ground.entities.get('wild')!;
    expect(wild.components.perishable.timer.value).toEqual({ status: 'paused', remainingSeconds: 1440 });
    world.advance(1500);
    expect(wild.components.perishable.GetPercent()).toBe(1);
    expect(
      (
        await executeDebugCommand('c_give("butter",2);c_spawn("butter")', inventory, async id => {
          await ground.spawnFromSave(
            'butter:command',
            { ...SAVE_CATALOG.items[id], itemId: id, count: 1 },
            new THREE.Vector3(12, 0, 9),
          );
          return true;
        })
      ).ok,
    ).toBe(true);
    const butter = ground.exportRecords().find(record => record.id === 'butter:command')!;
    // A fresh single butter: perishable's full remaining time and no stackable record.
    expect(butter.components).toEqual({ perishable: { time: SAVE_CATALOG.items.butter.perishTime } });
    expect(
      (
        await executeDebugCommand('c_save()', inventory, undefined, () => {
          json = serializeSave(
            template,
            {
              entities: { butter: [butter] },
              inventory: inventory.exportSaved(),
              elapsedSeconds: world.scheduler.now,
              playerTransform: { position: [0, 0, 0], rotationY: 0 },
            },
            SAVE_CATALOG,
          );
        })
      ).ok,
    ).toBe(true);
    const savedButter = deserializeSave(json, SAVE_CATALOG);
    loadSavedInventory(restored, savedButter, SAVE_CATALOG.recipes);
    restoredGround.restoreEntities(savedButter.world.entities);
    expect(restoredGround.exportRecords()).toEqual([butter]);
    expect(restored.exportState()).toEqual(inventory.exportState());
  } finally {
    ground.dispose();
    restoredGround.dispose();
    inventory.dispose();
    restored.dispose();
  }
});

it('starves an entire stack into independently rolled loot after removing the butterflies', async () => {
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  const inventory = createInventoryStore([]),
    world = createPerishWorld();
  inventory.entities.bindPerishWorld(world);
  // The world the butterflies are SpawnPrefab'd into, which spawns their loot.
  const items = new ItemWorldFixture(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    undefined,
    '/dst/data/databundles/images.zip',
    inventory,
    '/dst/data/anim',
    new THREE.Group(),
  );
  try {
    expect((await executeDebugCommand('c_give("butterfly",3)', inventory)).ok).toBe(true);
    const entity = inventory.getEntity(inventorySlotAddress(0))!;
    const events: string[] = [];
    // The player inst holding the stack is told about the murder.
    testPlayer({ inventory }).ListenForEvent('murdered', () => events.push('murdered'));
    entity.ListenForEvent('onremove', () => events.push('removed'));
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.5)
      .mockReturnValue(0.5);
    world.advance(BUTTERFLY_PERISH_TIME);
    expect(entity.isRemoved).toBe(true);
    expect(inventory.count('butterfly')).toBe(0);
    expect(inventory.count('butter')).toBe(1);
    expect(inventory.count('butterflywings')).toBe(2);
    expect(events).toEqual(['murdered', 'removed']);
    expect(entity.components.perishable.updateTimer.value).toEqual({ status: 'stopped' });
    let saved = '';
    const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
    expect(
      (
        await executeDebugCommand('c_save()', inventory, undefined, () => {
          saved = serializeSave(
            template,
            {
              entities: {},
              inventory: inventory.exportSaved(),
              elapsedSeconds: world.scheduler.now,
              playerTransform: { position: [0, 0, 0], rotationY: 0 },
            },
            SAVE_CATALOG,
          );
        })
      ).ok,
    ).toBe(true);
    expect(
      Object.values(deserializeSave(saved, SAVE_CATALOG).players.local.inventory.items).map(item => item.prefab),
    ).toEqual(['butter', 'butterflywings']);
  } finally {
    items.dispose();
    inventory.dispose();
  }
});
