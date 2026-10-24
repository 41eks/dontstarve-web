import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { SaplingManager } from '../../prefab/src/sapling';
import { GroundItemManager } from '../../../src/groundItems';
import { createPickupInventory } from './pickupFixture';
import { createPickupDoer } from '../../stategraphs/src/pickup';
import { performToolWork, collectEquippedActions } from '../../stategraphs/src/componentactions';
import { getPickActions } from '../../stategraphs/src/pick';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { createSignal, type SeasonState } from '../../signals/src';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const inventory = createPickupInventory(), scene = new THREE.Scene(), player = new THREE.Group();
  const ground = new GroundItemManager(scene, new THREE.PerspectiveCamera(),
    { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer, '/dst/data/databundles/images.zip',
    inventory, '/dst/data/anim', player);
  const season = createSignal<SeasonState>({ season: 'autumn', progress: 0 });
  const saplings = new SaplingManager(scene, '/dst/data/anim', {
    season, prepareSpawn: (definition, fling) => ground.prepareSpawn(definition, fling),
  });
  const registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.saplings, {
    restore: (id, record) => saplings.spawn(id, new THREE.Vector3(...record.transform.position), record),
    debugSpawn: id => saplings.spawn(id, player.position.clone()),
    exportRecords: () => saplings.exportRecords(),
    dispose: () => saplings.dispose(),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, {
    entities: { ...Object.fromEntries(['sapling', 'sapling_moon'].map(id => [id, saplings.exportRecords()
      .filter(({ prefabId }) => prefabId === id).map(({ record }) => record)])), ground_item: ground.exportRecords() },
    inventory: inventory.exportState(), elapsedSeconds: 100, playerTransform: { position: [0, 0, 0], rotationY: 0 },
  }, SAVE_CATALOG);
  const dispose = () => { registry.dispose(); ground.dispose(); inventory.dispose(); };
  return { inventory, scene, player, ground, saplings, season, registry, save, dispose,
    worker: createPickupDoer(player, inventory) };
}

it('picks twigs, regrows after four days through grow → sway, and saves/restores the empty sapling', async () => {
  const s = setup(), restored = setup();
  try {
    s.player.position.set(3, 0, 6);
    expect((await executeDebugCommand('c_spawn("sapling")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    const [model] = s.scene.children.filter(child => child.userData.prefab === 'sapling') as THREE.Group[];
    const animation = model.userData.animationController;
    expect(animation.currentAnimation).toBe('sway');
    expect(model.userData.tags).toEqual(['plant', 'renewable', 'silviculture', 'lunarplant_target', 'pickable', 'canlight']);
    expect(model.userData.actionEntity.hasTag('DIG_workable')).toBe(true);
    expect(getPickActions(s.scene).find(action => action.model === model)?.available).toBe(true);

    expect(model.userData.components.pickable.pick({ giveItem: (item: string, count: number) => s.inventory.add(item, count) })).toBe(true);
    expect(s.inventory.count('twigs')).toBe(1);
    expect(animation.currentAnimation).toBe('picked');
    expect(model.userData.tags).not.toContain('pickable');
    s.saplings.update(1000, new THREE.Quaternion());

    const saved = deserializeSave(s.save(), SAVE_CATALOG);
    const [record] = saved.world.entities.sapling;
    expect(record.components.pickable).toEqual({ picked: true, regrowSeconds: 920 });
    const copy = await restored.saplings.spawn('sapling', new THREE.Vector3(...record.transform.position), record);
    // Pickable:OnLoad calls makeemptyfn rather than replaying the pick.
    expect(copy.userData.animationController.currentAnimation).toBe('empty');
    expect(copy.userData.entityId).toBe(model.userData.entityId);

    s.saplings.update(920, new THREE.Quaternion());
    expect(model.userData.pickablePlantState.phase.peek()).toBe('ready');
    expect(animation.currentAnimation).toBe('grow');
    for (let frame = 0; frame < 45; frame++) s.saplings.update(1 / 30, new THREE.Quaternion());
    expect(animation.currentAnimation).toBe('sway');
    // Regrowth tasks may not exceed TUNING.SAPLING_REGROW_TIME.
    const invalid = JSON.parse(s.save());
    invalid.world.entities.sapling = [{ ...record, components: { pickable: { picked: true, regrowSeconds: 1921 } } }];
    expect(() => deserializeSave(JSON.stringify(invalid), SAVE_CATALOG)).toThrow(/regrowSeconds/);
  } finally { s.dispose(); restored.dispose(); }
});

it('digs sapling_moon into dug_sapling_moon plus ready twigs, and burns a picked sapling to ash', async () => {
  const s = setup();
  try {
    expect((await executeDebugCommand('c_give("dug_sapling_moon",2);c_give("shovel");c_spawn("sapling_moon")', s.inventory,
      id => s.registry.spawn(id))).ok).toBe(true);
    expect(s.inventory.getItemSpec('dug_sapling_moon').maxStack).toBe(10);
    const shovel = s.inventory.entities.create({ itemId: 'shovel', count: 1 });
    s.inventory.configureItem(shovel);
    expect(performToolWork('DIG', s.saplings.digTargets[0].entity!, s.worker, shovel)).toBe(true);
    expect(s.ground.exportRecords().map(record => record.components.stack?.itemId)).toEqual(['twigs', 'dug_sapling_moon']);
    expect(s.saplings.exportRecords()).toEqual([]);

    const model = await s.saplings.spawn('sapling', new THREE.Vector3(30, 0, 0));
    model.userData.components.pickable.pick({ giveItem: () => true });
    const torch = s.inventory.entities.create({ itemId: 'torch', count: 1 });
    s.inventory.configureItem(torch);
    expect(collectEquippedActions(torch, model.userData.actionEntity, true)).toContain('LIGHT');
    model.userData.components.burnable.Ignite();
    expect(s.saplings.exportRecords()).toEqual([]);
    s.saplings.update(20, new THREE.Quaternion());
    expect(model.parent).toBeNull();
    expect(s.ground.exportRecords().at(-1)?.components.stack).toMatchObject({ itemId: 'ash', count: 1 });
  } finally { s.dispose(); }
});
