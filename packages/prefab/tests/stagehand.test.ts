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
import { STAGEHAND_CONFIG as CONFIG } from '../src/generated/stagehand.schema';
import { PrefabEntityManager, type PrefabInstance } from '../src/prefabInstance';
import { stagehandPrefabs, StagehandInstance, STAGEHAND_ART, STAGEHAND_ID as ID } from '../src/stagehand';
import { FireFxHost } from '../src/treeFire';
import { importedSave } from '../../../tests/fixtures/importedSave';
import { testInventoryStore } from '../../../tests/fixtures/testInventory';

const readSave = async (file: string) =>
  JSON.parse(await readFile(new URL(`../../../public/saves/${file}`, import.meta.url), 'utf8'));
const HIDING = { name: CONFIG.clips.idle_loop_01.name, loop: false };

function setup(position: Vector3) {
  vi.stubGlobal('window', new EventTarget());
  const fetch = vi.fn(
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  vi.stubGlobal('fetch', fetch);

  const unbindGrid = BindTileMapSize(8192);
  const tile = new TileTracker(() => position).tile.value;
  const awake = createSignal(true);
  const scene = new Scene();
  const displays = new PrefabDisplayGroup(scene);
  const scheduler = new GameTimeScheduler();
  const fire = FireFxHost.create('/dst/data/anim');
  const spawnCampfire = vi.spyOn(fire, 'spawnCampfire');
  const spawnLoot = vi.fn(() => undefined);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {
    tickingarea: key => createMemo(() => key.get() === tile && awake.get()),
  });
  prefabs.register(stagehandPrefabs({ scheduler, fire, getLightLevel: () => 1, spawnLoot }));
  const registry = new EntityRegistry([], prefabs, () => position);
  registry.registerPrefabs(PREFAB_DEFINITIONS.stagehand);
  const stagehand = () => {
    const [inst] = prefabs.instances(ID);
    if (!(inst instanceof StagehandInstance)) {
      throw new Error('Expected stagehand in the shared manager');
    }
    return inst;
  };

  return {
    registry,
    scheduler,
    stagehand,
    awake,
    spawnCampfire,
    spawnLoot,
    fetch,
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

it('restores the imported stagehand and requests its declared bank, snow and skin archives', async () => {
  const [record] = importedSave('Master').world.entities[ID];
  const context = setup(new Vector3(...record.transform.position));
  try {
    const skinname = 'stagehand_cawnival_alt';
    await context.registry.restoreAll({ [ID]: [{ ...record, skinname }] });
    const inst = context.stagehand();
    expect(inst.status.value).toBe('active');
    expect(inst.sg.stateName).toBe('idle_hiding');
    expect(inst.sprite.sprite.value).toMatchObject({ clip: HIDING, facingMode: CONFIG.facings, skinId: skinname });
    expect(inst.sprite.sprite.value.appearance.get(`layer:${CONFIG.snow.layer}`)).toMatchObject({ hidden: true });
    expect(inst.sprite.sprite.value.appearance.get('skin')).toMatchObject({
      skin: { baseSymbols: CONFIG.skinSymbolOverrides },
    });
    expect(inst.components.lunarhailbuildup.OnSave()).toEqual(record.components.lunarhailbuildup);
    expect([...inst.listTags()].sort()).toEqual(
      [
        ...CONFIG.tags,
        ...((record.components.lunarhailbuildup?.workleft ?? 0) > 0 ? ['LunarBuildup'] : []),
        CONFIG.physics.blocker,
        CONFIG.snow.tag,
        'canlight',
        'HAMMER_workable',
        'inspectable',
        'locomotor',
      ].sort(),
    );
    expect(inst.components.inspectable.GetStatus()).toBe('HIDING');
    expect(inst.physics.json.value).toMatchObject({
      mass: 0,
      group: CONFIG.physics.hiding.group,
      capsule: { radius: 0.5, height: 1 },
    });
    expect(STAGEHAND_ART.bank).toBe(CONFIG.bank);

    await prefabDisplay(inst.transform.model)!.artLoaded();
    for (const archive of [
      ...STAGEHAND_ART.buildArchives,
      CONFIG.skins[skinname],
      CONFIG.skins[skinname].replace(/\.zip$/, '.dyn'),
    ]) {
      expect(context.fetch).toHaveBeenCalledWith(expect.stringContaining(`/dst/data/anim/${archive}`));
    }
  } finally {
    context.dispose();
  }
});

it('keeps the extinguish clip and appearance across tile sleep while its burn FX follows the parent', async () => {
  const position = new Vector3(8, 0, -12);
  const context = setup(position);
  try {
    await context.registry.restoreAll({
      [ID]: [
        {
          id: 'stagehand_buildup',
          transform: { position: [position.x, 0, position.z], rotationY: Math.PI / 2 },
          components: { lunarhailbuildup: { workleft: 1, buildupcurrent: 0.75 } },
        },
      ],
    });
    const inst = context.stagehand();
    const { propagator, burnable, lunarhailbuildup } = inst.components;
    expect(propagator.flashpoint).toBeGreaterThanOrEqual(5);
    expect(propagator.flashpoint).toBeLessThanOrEqual(10);
    expect(propagator.propagaterange).toBeGreaterThanOrEqual(3);
    expect(propagator.propagaterange).toBeLessThanOrEqual(5);
    expect(propagator.heatoutput).toBeGreaterThanOrEqual(3);
    expect(propagator.heatoutput).toBeLessThanOrEqual(5);
    expect(lunarhailbuildup.timer.value.status).toBe('scheduled');

    burnable.Ignite(true);
    const fx = context.spawnCampfire.mock.results[0].value.instance as PrefabInstance;
    const display = prefabDisplay(inst.transform.model)!;
    await display.artLoaded();
    expect(inst.sprite.sprite.value.clip).toMatchObject({ name: CONFIG.clips.extinguish.name, loop: false });
    expect(fx.entityParent).toBe(inst);
    expect(fx.status.value).toBe('active');
    expect(fx.persists).toBe(false);
    const appearance = inst.sprite.sprite.value.appearance;

    context.awake.set(false);
    await Promise.resolve();
    expect(inst.status.value).toBe('asleep');
    expect(fx.status.value).toBe('asleep');
    context.awake.set(true);
    await Promise.resolve();
    await display.artLoaded();
    expect(inst.status.value).toBe('active');
    expect(fx.status.value).toBe('active');
    expect(inst.sprite.sprite.value.clip).toMatchObject({ name: CONFIG.clips.extinguish.name, loop: false });
    expect(inst.sprite.sprite.value.appearance).toEqual(appearance);
    expect(lunarhailbuildup.OnSave()).toEqual({ workleft: 1, buildupcurrent: 0.75 });

    context.scheduler.advance(20 / 30);
    expect(burnable.IsBurning()).toBe(false);
    inst.remove();
    expect(fx.status.value).toBe('removed');
  } finally {
    context.dispose();
  }
});

it('round-trips the real c_spawn and c_save path, retaining only the source persistent component', async () => {
  const position = new Vector3(3, 0, -6);
  const first = setup(position);
  const inventory = testInventoryStore([], SAVE_CATALOG.items);
  let records;
  try {
    expect((await executeDebugCommand(`c_spawn("${ID}")`, inventory, id => first.registry.spawn(id))).ok).toBe(true);
    expect((await executeDebugCommand(`c_give("${ID}")`, inventory)).ok).toBe(false);
    const spawned = first.stagehand();
    expect(spawned.sprite.sprite.value.clip).toMatchObject(HIDING);
    const { workable, lunarhailbuildup } = spawned.components;
    for (let index = 0; index < CONFIG.workable.workLeft; index++) {
      expect(workable.WorkedBy({}, 2)).toBe(true);
    }
    first.scheduler.advance(1 / 30);
    expect(spawned.sg.stateName).toBe('giveup');
    expect(workable.CanBeWorked()).toBe(false);
    first.scheduler.advance(14 / 30);
    expect(first.spawnLoot).toHaveBeenCalledWith(CONFIG.loot.prefab, spawned.position, undefined);

    const buildup = { workleft: 2, buildupcurrent: 1 };
    lunarhailbuildup.OnLoad(buildup);
    let exported = '';
    const template = await readSave('initial-world.json');
    expect(
      (
        await executeDebugCommand('c_save()', inventory, undefined, () => {
          exported = serializeSave(
            template,
            {
              entities: { [ID]: first.registry.exportRecords()[ID] },
              inventory: inventory.exportSaved(),
              playerTransform: { position: [position.x, 0, position.z], rotationY: 0 },
              elapsedSeconds: first.scheduler.now,
            },
            SAVE_CATALOG,
          );
        })
      ).ok,
    ).toBe(true);
    records = deserializeSave(exported, SAVE_CATALOG).world.entities[ID];
    expect(records).toEqual([
      {
        id: String(spawned.entityId),
        transform: { position: [position.x, 0, position.z], rotationY: 0 },
        components: { lunarhailbuildup: buildup },
      },
    ]);
  } finally {
    first.dispose();
    inventory.dispose();
  }

  const second = setup(position);
  try {
    await second.registry.restoreAll({ [ID]: records! });
    const restored = second.stagehand();
    expect(restored.sprite.sprite.value.clip).toMatchObject(HIDING);
    expect(restored.components.workable.workleft.value).toBe(CONFIG.workable.workLeft);
    expect(restored.hasTag('LunarBuildup')).toBe(true);
    expect(prefabDisplay(restored.transform.model)!.snowLook).toEqual({
      shown: true,
      override: { archive: 'snow.zip', symbol: CONFIG.snow.symbol, source: CONFIG.snow.buildup },
    });
    expect(second.registry.exportRecords()[ID]).toEqual(records);
  } finally {
    second.dispose();
  }
});
