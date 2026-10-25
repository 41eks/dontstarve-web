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
import { bindTestWorld, tickWorld } from './worldContentFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { createSignal } from '../../signals/src';
import { prefabInstance } from '../../prefab/src/prefabInstance';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(inventory = createPickupInventory()) {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const scene = new THREE.Scene(), player = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(), renderer = { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer;
  const ground = new GroundItemManager(scene, camera,
    renderer, '/dst/data/databundles/images.zip',
    inventory, '/dst/data/anim', player);
  const scheduler = new GameTimeScheduler();
  const { season, unbind } = bindTestWorld(scheduler);
  const saplings = new SaplingManager(scene, '/dst/data/anim', {
    prepareSpawn: (definition, fling) => ground.prepareSpawn(definition, fling),
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
  const dispose = () => { registry.dispose(); ground.dispose(); inventory.dispose(); unbind(); scheduler.dispose(); };
  return { inventory, scene, player, ground, saplings, season, scheduler, registry, save, dispose,
    world: { scene, player, camera, renderer, ground: new THREE.Group(), cameraFacing: createSignal(1), cameraHeading: createSignal(0) },
    worker: createPickupDoer(player, inventory) };
}

it('picks twigs, regrows after four days through grow → sway, and saves/restores the empty sapling', async () => {
  const s = setup(), restored = setup();
  try {
    s.player.position.set(3, 0, 6);
    expect((await executeDebugCommand('c_spawn("sapling")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    const [model] = s.scene.children.filter(child => child.userData.instance?.prefab === 'sapling') as THREE.Group[];
    const animation = model.userData.animationController;
    expect(animation.currentAnimation).toBe('sway');
    expect(prefabInstance(model)!.listTags()).toEqual(['plant', 'renewable', 'silviculture', 'lunarplant_target', 'pickable', 'tickingarea', 'canlight', 'witherable']);
    expect(model.userData.actionEntity.hasTag('DIG_workable')).toBe(true);
    expect(getPickActions(model).find(action => action.model === model)?.available).toBe(true);

    expect(model.userData.components.pickable.pick({ giveItem: (item: string, count: number) => s.inventory.add(item, count) })).toBe(true);
    expect(s.inventory.count('twigs')).toBe(1);
    expect(animation.currentAnimation).toBe('picked');
    expect(prefabInstance(model)!.listTags()).not.toContain('pickable');
    tickWorld(s.scheduler, s.saplings, 1000, new THREE.Quaternion());

    const saved = deserializeSave(s.save(), SAVE_CATALOG);
    const [record] = saved.world.entities.sapling;
    expect(record.components.pickable).toEqual({ picked: true, regrowSeconds: 920 });
    const copy = await restored.saplings.spawn('sapling', new THREE.Vector3(...record.transform.position), record);
    // Pickable:OnLoad calls makeemptyfn rather than replaying the pick.
    expect(copy.userData.animationController.currentAnimation).toBe('empty');
    expect(copy.userData.instance?.entityId).toBe(model.userData.instance?.entityId);

    tickWorld(s.scheduler, s.saplings, 920, new THREE.Quaternion());
    expect(model.userData.pickablePlantState.phase.peek()).toBe('ready');
    expect(animation.currentAnimation).toBe('grow');
    for (let frame = 0; frame < 45; frame++) tickWorld(s.scheduler, s.saplings, 1 / 30, new THREE.Quaternion());
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
    tickWorld(s.scheduler, s.saplings, 20, new THREE.Quaternion());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(model.parent).toBeNull();
    expect(s.ground.exportRecords().at(-1)?.components.stack).toMatchObject({ itemId: 'ash', count: 1 });
  } finally { s.dispose(); }
});

it('restores an imported wither check through save/load, reschedules on expiry and cancels on removal', async () => {
  const s = setup(), restored = setup();
  try {
    const model = await s.saplings.spawn('sapling', new THREE.Vector3(30, 0, 6), {
      id: 'imported-sapling', transform: { position: [30, 0, 6], rotationY: 0 },
      components: { witherable: { taskSeconds: 2.5 } },
    });
    expect(prefabInstance(model)!.listTags()).toContain('witherable');
    tickWorld(s.scheduler, s.saplings, 1, new THREE.Quaternion());
    const saved = deserializeSave(s.save(), SAVE_CATALOG), record = saved.world.entities.sapling[0];
    expect(record.components.witherable).toEqual({ taskSeconds: 1.5 });
    const copy = await restored.saplings.spawn('sapling', new THREE.Vector3(...record.transform.position), record);
    const witherable = copy.userData.components.witherable;
    const timer = witherable.state.timer.peek();
    tickWorld(restored.scheduler, restored.saplings, 1, new THREE.Quaternion());
    expect(witherable.state.timer.peek()).toBe(timer);
    tickWorld(restored.scheduler, restored.saplings, .5, new THREE.Quaternion());
    expect(witherable.state.timer.peek()).not.toBe(timer);
    expect(witherable.state.timer.peek().status).toBe('scheduled');
    expect(copy.userData.components.pickable.canBePicked).toBe(true);
    restored.saplings.remove(copy);
    expect(witherable.state.timer.peek()).toEqual({ status: 'stopped' });
    tickWorld(restored.scheduler, restored.saplings, 60, new THREE.Quaternion());
    expect(restored.saplings.exportRecords()).toEqual([]);
  } finally { s.dispose(); restored.dispose(); }
});
