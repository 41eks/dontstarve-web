import { readFile } from 'node:fs/promises';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { Scene, Vector3 } from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { BindTileMapSize, TileTracker } from '../../componets/src/tileManager';
import { fixedCamera } from '../src/followcamera';
import { LIVINGTREE_CONFIG as CONFIG } from '../src/generated/livingtree.schema';
import type { SpawnGroundItem } from '../src/groundPrefab';
import { livingTreePrefabs, LivingTreeInstance, LIVINGTREE_ART, LIVINGTREE_ID as ID } from '../src/livingtree';
import { PrefabEntityManager, type PrefabInstance } from '../src/prefabInstance';
import type { EntityPersistData, EntitySaveRecord } from '../src/saveRecord';
import { FireFxHost } from '../src/treeFire';
import { testInventoryStore } from '../../../tests/fixtures/testInventory';
import { bindTestWorld } from '../../../tests/fixtures/worldContentFixture';

const POS = new Vector3(8, 0, -12);
const record = (id: string, components: EntityPersistData = {}, position = POS): EntitySaveRecord => ({
  id,
  components,
  transform: { position: [position.x, 0, position.z], rotationY: 0 },
});
const readTemplate = async () =>
  JSON.parse(await readFile(new URL('../../../public/saves/initial-world.json', import.meta.url), 'utf8'));

function setup() {
  vi.stubGlobal('window', new EventTarget());
  const fetch = vi.fn(
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  vi.stubGlobal('fetch', fetch);
  const unbindGrid = BindTileMapSize(8192);
  const tile = new TileTracker(() => POS).tile.value;
  const awake = createSignal(true);
  const displays = new PrefabDisplayGroup(new Scene());
  const scheduler = new GameTimeScheduler();
  const fire = FireFxHost.create('/dst/data/anim');
  const spawnFire = vi.spyOn(fire, 'spawn');
  const spawnGroundItem = vi.fn<SpawnGroundItem>(() => undefined);
  const shakeCamera = vi.fn();
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {
    tickingarea: key => createMemo(() => key.get() === tile && awake.get()),
  });
  prefabs.register(
    livingTreePrefabs({
      scheduler,
      fire,
      TheCamera: fixedCamera(90),
      spawnGroundItem,
      supportsOfflineSkins: false,
      shakeCamera,
    }),
  );
  const registry = new EntityRegistry([], prefabs, () => POS);
  registry.registerPrefabs(PREFAB_DEFINITIONS.livingtree);
  const tree = (id?: string) => {
    const entity = id ? prefabs.get(id) : [...prefabs.instances(ID)][0];
    if (!(entity instanceof LivingTreeInstance)) {
      throw new Error('Expected a livingtree instance in the shared manager');
    }
    return entity;
  };
  return {
    registry,
    tree,
    scheduler,
    awake,
    fetch,
    spawnFire,
    spawnGroundItem,
    shakeCamera,
    dispose() {
      registry.dispose();
      prefabs.dispose();
      fire.dispose();
      displays.dispose();
      scheduler.dispose();
      unbindGrid();
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

it('loads livingtree records with the Lua appearance and burns a saved burnt stump into ash', async () => {
  const template = await readTemplate();
  const save = {
    ...template,
    world: {
      ...template.world,
      entities: {
        [ID]: [
          record('livingtree_snow', { lunarhailbuildup: { workleft: 3, buildupcurrent: 0.75 } }),
          record('livingtree_burnt', { livingtree: { burnt: true } }),
          record('livingtree_burnt_stump', { livingtree: { stump: true, burnt: true } }),
        ],
      },
    },
  };
  const parsed = deserializeSave(JSON.stringify(save), SAVE_CATALOG);
  const context = setup();
  try {
    await context.registry.restoreAll(parsed.world.entities);
    const standing = context.tree('livingtree_snow');
    const burnt = context.tree('livingtree_burnt');
    const expected = [...CONFIG.tags, CONFIG.snow.tag, 'inspectable', 'canlight', 'CHOP_workable', 'LunarBuildup'];
    expect([...standing.listTags()].sort()).toEqual(expected.sort());
    expect(standing.sprite.sprite.value.clip).toMatchObject({ name: CONFIG.clips.idle.name, loop: true });
    expect(prefabDisplay(standing.transform.model)!.snowLook).toEqual({
      shown: true,
      override: { archive: 'snow.zip', symbol: CONFIG.snow.symbol, source: CONFIG.snow.buildup },
    });
    expect(standing.minimap.icon).toBe(CONFIG.tree.icon);
    expect(standing.components.lunarhailbuildup?.timer.value.status).toBe('scheduled');
    expect(LIVINGTREE_ART.bank).toBe(CONFIG.bank);
    await prefabDisplay(standing.transform.model)!.artLoaded();
    for (const archive of LIVINGTREE_ART.buildArchives) {
      expect(context.fetch).toHaveBeenCalledWith(expect.stringContaining(`/dst/data/anim/${archive}`));
    }

    expect(burnt.sprite.sprite.value.clip).toMatchObject({ name: CONFIG.clips.burnt_tall.name, loop: true });
    expect(burnt.minimap.icon).toBe(CONFIG.burnt.icon);
    expect(burnt.hasTag(CONFIG.burnt.tag)).toBe(true);
    expect(burnt.rayTestOnBB).toBe(true);
    expect(burnt.components.lunarhailbuildup).toBeUndefined();
    expect(context.spawnGroundItem).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'ash', count: 1 }), POS);
    expect(context.registry.exportRecords()[ID].map(entry => entry.id)).not.toContain('livingtree_burnt_stump');
    context.scheduler.advance(CONFIG.burnt.extinguishDelay);
    expect(burnt.components.burnable).toBeUndefined();
    expect(burnt.components.workable?.GetWorkLeft()).toBe(CONFIG.burnt.work);
    burnt.components.workable!.WorkedBy({ hasTag: name => name === 'playerghost' }, 1);
    expect(burnt.sprite.sprite.value.clip).toMatchObject({ name: CONFIG.clips.chop_burnt_tall.name, loop: false });
    expect(context.spawnGroundItem).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'charcoal' }), POS, {
      fling: true,
    });
    context.scheduler.advance(CONFIG.clipSeconds.chop_burnt_tall);
    expect(burnt.isRemoved).toBe(true);
  } finally {
    context.dispose();
  }
});

it('draws UpdateLunarHailBuildup from the buildup and the world snow, and wakes with the latest of both', async () => {
  const context = setup();
  const world = bindTestWorld(context.scheduler);
  const look = (source: string, shown = true) => ({
    shown,
    override: { archive: 'snow.zip', symbol: CONFIG.snow.symbol, source },
  });
  try {
    // One decay step from empty: buildup decays away within two periods of LoadPostPass's random start.
    const state = { workleft: 2, buildupcurrent: 0.005 };
    await context.registry.restoreAll({ [ID]: [record('livingtree_hail', { lunarhailbuildup: state })] });
    const inst = context.tree();
    const display = prefabDisplay(inst.transform.model)!;
    await display.artLoaded();
    expect(display.snowLook).toEqual(look(CONFIG.snow.buildup));
    world.snowLevel.set(0.5);
    expect(display.snowLook).toEqual(look(CONFIG.snow.snowyBuildup));

    context.awake.set(false);
    await Promise.resolve();
    expect(inst.status.value).toBe('asleep');
    world.snowLevel.set(0);
    context.awake.set(true);
    await display.artLoaded();
    expect(display.snowLook).toEqual(look(CONFIG.snow.buildup));

    context.scheduler.advance(2 * CONFIG.lunarHail.decayPeriod);
    expect(inst.hasTag('LunarBuildup')).toBe(false);
    expect(display.snowLook).toEqual(look(CONFIG.snow.source, false));
    world.snowLevel.set(0.5);
    expect(display.snowLook).toEqual(look(CONFIG.snow.source));
    // The sprite json stays as declared: the look is the display's, from the component and the world.
    const json = inst.sprite.sprite.value;
    world.snowLevel.set(0);
    expect(inst.sprite.sprite.value).toBe(json);
  } finally {
    context.dispose();
    world.unbind();
  }
});

it('keeps the declared look and persisted buildup across tile sleep and wakes its fire child with it', async () => {
  const context = setup();
  try {
    const state = { workleft: 2, buildupcurrent: 0.625 };
    await context.registry.restoreAll({ [ID]: [record('livingtree_burning', { lunarhailbuildup: state })] });
    const inst = context.tree();
    const { propagator, burnable, lunarhailbuildup } = inst.components;
    expect(propagator!.flashpoint).toBeGreaterThanOrEqual(15);
    expect(propagator!.flashpoint).toBeLessThanOrEqual(25);
    expect(propagator!.propagaterange).toBeGreaterThanOrEqual(5);
    expect(propagator!.propagaterange).toBeLessThanOrEqual(7);
    expect(propagator!.heatoutput).toBeGreaterThanOrEqual(5);
    expect(propagator!.heatoutput).toBeLessThanOrEqual(8.5);

    burnable!.Ignite(true);
    const fire = context.spawnFire.mock.results[0].value.instance as PrefabInstance;
    const display = prefabDisplay(inst.transform.model)!;
    await display.artLoaded();
    expect(fire.entityParent).toBe(inst);
    expect(fire.persists).toBe(false);
    expect(fire.status.value).toBe('active');
    const appearance = inst.sprite.sprite.value.appearance;
    expect(context.fetch).toHaveBeenCalledWith(expect.stringContaining('/dst/data/anim/fire.zip'));

    context.awake.set(false);
    await Promise.resolve();
    expect(inst.status.value).toBe('asleep');
    expect(fire.status.value).toBe('asleep');
    context.awake.set(true);
    await display.artLoaded();
    expect(inst.status.value).toBe('active');
    expect(fire.status.value).toBe('active');
    expect(inst.sprite.sprite.value.clip).toMatchObject({ name: CONFIG.clips.idle.name, loop: true });
    expect(inst.sprite.sprite.value.appearance).toEqual(appearance);
    expect(lunarhailbuildup!.OnSave()).toEqual(state);
    expect(inst.GetPersistData().livingtree).toEqual({ burnt: true });
    inst.remove();
    expect(fire.status.value).toBe('removed');
  } finally {
    context.dispose();
  }
});

it('round-trips c_spawn, felling and c_save through the world registry and rejects c_give', async () => {
  const first = setup();
  const inventory = testInventoryStore([], SAVE_CATALOG.items);
  let records: readonly EntitySaveRecord[] = [];
  try {
    expect((await executeDebugCommand(`c_spawn("${ID}")`, inventory, id => first.registry.spawn(id))).ok).toBe(true);
    expect((await executeDebugCommand(`c_give("${ID}")`, inventory)).ok).toBe(false);
    const inst = first.tree();
    await prefabDisplay(inst.transform.model)!.artLoaded();
    const worker = { getPosition: () => POS.clone().add(new Vector3(1, 0, 0)) };
    const workable = inst.components.workable!;
    expect(workable.GetWorkLeft()).toBe(CONFIG.tree.work.count);
    expect(workable.WorkedBy(worker, 1)).toBe(true);
    expect(inst.sprite.sprite.value.clip).toMatchObject({ name: CONFIG.clips.chop.name, loop: false });
    expect(inst.sprite.sprite.value.queue).toMatchObject([{ name: CONFIG.clips.idle.name, loop: true }]);
    expect(workable.WorkedBy(worker, CONFIG.tree.work.count - 1)).toBe(true);
    expect(inst.sprite.sprite.value.clip).toMatchObject({ name: CONFIG.clips.fallleft.name, loop: false });
    expect(inst.sprite.sprite.value.queue).toMatchObject([{ name: CONFIG.clips.stump.name, loop: true }]);
    expect(inst.components.workable?.GetWorkAction()).toBe('DIG');
    expect(first.spawnGroundItem.mock.calls.map(([item]) => item.itemId)).toEqual(CONFIG.loot.normal);
    first.scheduler.advance(CONFIG.shake.delay);
    expect(first.shakeCamera).toHaveBeenCalledOnce();

    const template = await readTemplate();
    let exported = '';
    expect(
      (
        await executeDebugCommand('c_save()', inventory, undefined, () => {
          exported = serializeSave(
            template,
            {
              entities: { [ID]: first.registry.exportRecords()[ID] },
              inventory: inventory.exportSaved(),
              playerTransform: { position: [POS.x, 0, POS.z], rotationY: 0 },
              elapsedSeconds: first.scheduler.now,
            },
            SAVE_CATALOG,
          );
        })
      ).ok,
    ).toBe(true);
    records = deserializeSave(exported, SAVE_CATALOG).world.entities[ID];
    expect(records).toEqual([record(String(inst.entityId), { livingtree: { stump: true } })]);
  } finally {
    first.dispose();
    inventory.dispose();
  }

  const second = setup();
  try {
    await second.registry.restoreAll({ [ID]: records });
    const inst = second.tree();
    expect(inst.sprite.sprite.value.clip).toMatchObject({ name: CONFIG.clips.stump.name, loop: false });
    expect(inst.minimap.icon).toBe(CONFIG.stump.icon);
    expect(inst.components.workable?.GetWorkAction()).toBe('DIG');
    expect(inst.components.workable?.GetWorkLeft()).toBe(1);
    expect(inst.physics.json.value?.mask).toBe(0);
    expect(second.registry.exportRecords()[ID]).toEqual(records);
  } finally {
    second.dispose();
  }
});
