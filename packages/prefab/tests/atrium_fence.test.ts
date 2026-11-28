import { readFile } from 'node:fs/promises';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { createMemo, createSignal, EventEmitter, GameTimeScheduler } from '@dontstarve-web/signals';
import { World } from 'cannon-es';
import { Scene, Vector3 } from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { COLLISION } from '../../componets/src/physicsState';
import { BindTileMapSize, TileTracker } from '../../componets/src/tileManager';
import { atriumFencePrefabs, AtriumFenceInstance, ATRIUM_FENCE_ID as ID } from '../src/atrium_fence';
import { PrefabEntityManager, type PrefabInstance } from '../src/prefabInstance';
import type { EntitySaveRecord } from '../src/saveRecord';
import { WORLD_SCALE } from '../src/tile';
import type { WorldEvents } from '../src/worldContext';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { createPickupInventory } from '../../../tests/fixtures/pickupFixture';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function setup(position: Vector3) {
  const fetch = vi.fn(
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  vi.stubGlobal('fetch', fetch);
  const tile = new TileTracker(() => position).tile.value;
  const awake = createSignal(true);
  const scene = new Scene();
  const displays = new PrefabDisplayGroup(scene);
  const worldEvents = new EventEmitter<WorldEvents>();
  const scheduler = new GameTimeScheduler();
  const physics = new World();
  const player = { position: position.clone(), IsVisible: () => true };
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {
    tickingarea: key => createMemo(() => key.get() === tile && awake.get()),
    scheduler,
  });
  const definitions = atriumFencePrefabs({ worldEvents, physics, scheduler, getPlayers: () => [player] });
  prefabs.register(definitions);
  const registry = new EntityRegistry([], prefabs, () => position);
  registry.registerPrefabs(PREFAB_DEFINITIONS.atriumFences);

  return {
    awake,
    scene,
    fetch,
    definitions,
    prefabs,
    registry,
    worldEvents,
    scheduler,
    player,
    fence() {
      const [inst] = prefabs.instances(ID);
      if (!(inst instanceof AtriumFenceInstance)) {
        throw new Error('Expected atrium_fence in the shared manager');
      }
      return inst;
    },
    dispose() {
      registry.dispose();
      prefabs.dispose();
      displays.dispose();
      scheduler.dispose();
    },
  };
}

let unbindTiles: () => void;
beforeEach(() => {
  unbindTiles = BindTileMapSize(8192);
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => {
  unbindTiles();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('loads atrium_fence from the imported Caves save and requests its original archive', async () => {
  const raw = JSON.parse(
    await readFile(new URL('../../../public/saves/Cluster_1/Caves.json', import.meta.url), 'utf8'),
  );
  raw.players = { local: { ...initialWorld.players.local, shardId: raw.world.shardId } };
  const [record] = deserializeSave(JSON.stringify(raw), SAVE_CATALOG).world.entities[ID] as EntitySaveRecord[];
  const context = setup(new Vector3(...record.transform.position));
  try {
    await context.registry.restoreAll({ [ID]: [record] });
    const inst = context.fence();
    expect(inst.status.value).toBe('active');
    expect(inst.listTags()).toEqual(['blocker']);
    expect(inst.sprite.sprite.value).toMatchObject({
      clip: { name: 'shrunk', loop: false },
      billboard: true,
      queue: [],
    });
    expect(context.definitions[ID].assets).toEqual({
      bank: 'atrium_fence',
      animationArchive: 'atrium_fence.zip',
      buildArchives: ['atrium_fence.zip'],
    });
    expect(inst.physics.json.value).toMatchObject({
      capsule: { radius: 0.1, height: 2 },
      group: COLLISION.OBSTACLES,
      mask: COLLISION.WORLD | COLLISION.ITEMS,
    });
    expect(inst.fenceid).toBe(record.components.fenceid);
    expect(context.registry.exportRecords()[ID]).toEqual([record]);
    await prefabDisplay(inst.transform.model)!.artLoaded();
    expect(context.fetch).toHaveBeenCalledWith(expect.stringContaining('/dst/data/anim/atrium_fence.zip'));
    expect(inst.sprite.currentAnimation).toBe('shrunk');
  } finally {
    context.dispose();
  }
});

it('keeps the powered shape across tile sleep and lowers it only inside the near threshold after unlock', async () => {
  const context = setup(new Vector3(3, 0, 6));
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  try {
    await context.registry.restoreAll({
      [ID]: [{ id: 'fence', transform: { position: [3, 0, 6], rotationY: 0 }, components: { fenceid: 5 } }],
    });
    const inst = context.fence();
    const model = inst.transform.model;
    await prefabDisplay(model)!.artLoaded();

    context.worldEvents.emit('atriumpowered', true);
    context.scheduler.advance(0.5);
    expect(inst.sprite.sprite.value).toMatchObject({
      clip: { name: 'grow5', loop: false },
      queue: [{ name: 'idle5_active', loop: false }],
    });
    expect(inst.physics.json.value?.mask).toBe(
      COLLISION.WORLD | COLLISION.ITEMS | COLLISION.CHARACTERS | COLLISION.GIANTS,
    );
    await flush();
    expect(inst.physicsBody?.collisionResponse).toBe(true);

    const appearance = inst.sprite.sprite.value.appearance;
    context.awake.set(false);
    await flush();
    expect(inst.status.value).toBe('asleep');
    expect(model.parent).toBeNull();
    context.awake.set(true);
    await flush();
    await prefabDisplay(model)!.artLoaded();
    expect(inst.status.value).toBe('active');
    expect(model.parent).toBe(context.scene);
    expect(inst.sprite.currentAnimation).toBe('idle5_active');
    expect(inst.sprite.sprite.value.appearance).toEqual(appearance);
    expect(inst.fenceid).toBe(5);

    context.player.position.x = 3 + 7 * WORLD_SCALE;
    const closingTask = inst.closingtask;
    context.worldEvents.emit('atriumpowered', false);
    expect(inst.sprite.sprite.value.queue).toEqual([{ name: 'idle5', loop: false }]);
    context.scheduler.advance(1);
    expect(inst.closed).toBe(true);
    expect(inst.closingtask).toBe(closingTask);
    context.player.position.x -= 1;
    context.scheduler.advance(1);
    expect(inst.closed).toBe(false);
    expect(inst.closingtask).toBeUndefined();
    expect(inst.sprite.sprite.value).toMatchObject({
      clip: { name: 'shrink5', loop: false },
      queue: [{ name: 'shrunk', loop: false }],
    });
    expect(inst.physics.json.value?.mask).toBe(COLLISION.WORLD | COLLISION.ITEMS);
    await flush();
    expect(inst.physicsBody?.collisionResponse).toBe(false);

    context.player.position.x = 3 + 8 * WORLD_SCALE;
    context.scheduler.advance(1);
    expect(inst.closed).toBe(true);
    expect(inst.openingtask).toBeUndefined();
    expect(inst.sprite.sprite.value).toMatchObject({
      clip: { name: 'grow5', loop: false },
      queue: [{ name: 'idle5', loop: false }],
    });
  } finally {
    context.dispose();
  }
});

it('round-trips c_spawn and c_save through the save reader and rejects c_give', async () => {
  const position = new Vector3(3, 0, -6);
  const first = setup(position);
  const second = setup(position);
  const inventory = createPickupInventory();
  try {
    expect((await executeDebugCommand('c_spawn("atrium_fence")', inventory, id => first.registry.spawn(id))).ok).toBe(
      true,
    );
    expect((await executeDebugCommand('c_give("atrium_fence")', inventory)).ok).toBe(false);
    const inst = first.fence();
    expect(Number.isInteger(inst.fenceid)).toBe(true);
    expect(inst.fenceid).toBeGreaterThanOrEqual(1);
    expect(inst.fenceid).toBeLessThanOrEqual(5);
    // The fence is closed before saving, but only the shape is a persisted field.
    first.player.position.x += 8 * WORLD_SCALE;
    first.scheduler.advance(1.5);
    expect(inst.closed).toBe(true);
    let json = '';
    expect(
      (
        await executeDebugCommand('c_save()', inventory, undefined, () => {
          json = serializeSave(
            deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
            {
              entities: first.registry.exportRecords(),
              inventory: inventory.exportSaved(),
              elapsedSeconds: 1.5,
              playerTransform: { position: [3, 0, -6], rotationY: 0 },
            },
            SAVE_CATALOG,
          );
        })
      ).ok,
    ).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities[ID];
    expect(saved).toEqual([
      { id: inst.entityId, transform: { position: [3, 0, -6], rotationY: 0 }, components: { fenceid: inst.fenceid } },
    ]);
    await second.registry.restoreAll({ [ID]: saved });
    const loaded = second.fence();
    expect(loaded.entityId).toBe(inst.entityId);
    expect(loaded.fenceid).toBe(inst.fenceid);
    expect(loaded.position.toArray()).toEqual([3, 0, -6]);
    expect(loaded.sprite.sprite.value.clip).toMatchObject({ name: 'shrunk', loop: false });
    second.worldEvents.emit('atriumpowered', true);
    second.scheduler.advance(1);
    expect(loaded.sprite.sprite.value.clip).toMatchObject({ name: `idle${loaded.fenceid}_active`, loop: false });
  } finally {
    first.dispose();
    second.dispose();
    inventory.dispose();
  }
});
