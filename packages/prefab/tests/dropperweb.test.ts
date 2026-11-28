import { PrefabDisplayGroup } from '@dontstarve-web/display';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { GroundCreep } from '../../componets/src/groundcreep';
import { DROPPERWEB_ID, DropperwebInstance, dropperwebPrefabs } from '../src/dropperweb';
import { PrefabEntityManager, type PrefabInstance } from '../src/prefabInstance';
import { TILE_SIZE, WORLD_SCALE } from '../src/tile';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { createPickupInventory } from '../../../tests/fixtures/pickupFixture';

const AT = new THREE.Vector3(2.5 * TILE_SIZE, 0, 2.5 * TILE_SIZE);

function setup() {
  vi.stubGlobal('window', new EventTarget());
  const scheduler = new GameTimeScheduler();
  const groundCreep = new GroundCreep(
    { cellRange: () => ({ min: -32, max: 32 }), canHoldCreep: () => true },
    scheduler,
    () => [{ position: AT }],
  );
  const displays = new PrefabDisplayGroup(new THREE.Scene());
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { scheduler });
  prefabs.register(dropperwebPrefabs({ scheduler, groundCreep, random: () => 0.99 }));
  const registry = new EntityRegistry([], prefabs, () => AT);
  registry.registerPrefabs(PREFAB_DEFINITIONS.dropperwebs);
  const webs = () => [...prefabs.instances(DROPPERWEB_ID)] as DropperwebInstance[];
  const dispose = () => {
    groundCreep.dispose();
    registry.dispose();
    prefabs.dispose();
    displays.dispose();
    scheduler.dispose();
  };
  return { scheduler, groundCreep, prefabs, registry, webs, dispose };
}
afterEach(() => vi.unstubAllGlobals());

it('c_spawn makes an artless web that spreads 5-unit creep, and c_save keeps its health and children', async () => {
  const first = setup(),
    inventory = createPickupInventory();
  let json = '';
  try {
    expect(
      (await executeDebugCommand('c_spawn("dropperweb")', inventory, prefab => first.registry.spawn(prefab))).ok,
    ).toBe(true);
    expect((await executeDebugCommand('c_give("dropperweb")', inventory)).ok).toBe(false);
    const [web] = first.webs();
    expect(web.listTags()).toEqual(['cavedweller', 'spiderden']);
    expect(web.minimap.icon).toBe('whitespider_den.png');
    // math.random(2, 3) at the top of the range; health keeps health.lua's default 100.
    expect([web.components.health.maxhealth, web.components.childspawner.maxchildren]).toEqual([100, 3]);
    expect(web.GroundCreepEntity!.radius).toBeCloseTo(5 * WORLD_SCALE);
    first.groundCreep.FastForward();
    first.scheduler.advance(0);
    expect(first.groundCreep.OnCreep(AT)).toBe(true);
    expect(first.groundCreep.GetTriggeredCreepSpawners(AT)).toEqual([web]);

    web.components.health.SetVal(40);
    const records = first.registry.exportRecords();
    expect(records.dropperweb![0]!.components).toEqual({
      health: { current: 40, maximum: 100 },
      childspawner: expect.objectContaining({ childreninside: 3 }),
    });
    expect(
      (
        await executeDebugCommand('c_save()', inventory, undefined, () => {
          json = serializeSave(
            deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
            {
              entities: records,
              inventory: inventory.exportSaved(),
              elapsedSeconds: 1,
              playerTransform: { position: [0, 0, 0], rotationY: 0 },
            },
            SAVE_CATALOG,
          );
        })
      ).ok,
    ).toBe(true);
  } finally {
    first.dispose();
  }

  const saved = deserializeSave(json, SAVE_CATALOG).world.entities.dropperweb!;
  const second = setup();
  try {
    await second.registry.restoreAll({ dropperweb: saved });
    const [web] = second.webs();
    expect(web.entityId).toBe(saved[0]!.id);
    expect(web.position.toArray()).toEqual(AT.toArray());
    expect(web.components.health.currenthealth).toBe(40);
    expect(web.components.childspawner.childreninside).toBe(3);
    // The creep is not saved: the reloaded web feeds it again.
    second.groundCreep.FastForward();
    second.scheduler.advance(0);
    expect(second.groundCreep.OnCreep(AT)).toBe(true);
  } finally {
    second.dispose();
  }
});
