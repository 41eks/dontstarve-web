import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { SaplingManager } from '../../prefab/src/sapling';
import { PlantDeployment } from '../../prefab/src/plantDeployment';
import { createInventoryStore } from '../../../src/inventory';
import { inventorySlotAddress, cursorSlotAddress } from '../../inventory/src';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import type { ActionAnimationController } from '../../stategraphs/src/actionContext';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
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

it('plants one cursor-held sapling at frame six, preserves cancellation and reloads its regrowth and remaining stack', async () => {
  const s = setup(createInventoryStore([])), restored = setup(createInventoryStore([]));
  const graph = new WilsonStateGraph({ playAnimation: () => 1, playSound: () => {}, stopSound: () => {}, setCasting: () => {}, onStateChanged: () => {} });
  const animation = { stategraph: graph, cancelEmote: vi.fn(), setFacing: vi.fn() } as unknown as ActionAnimationController;
  const locomotor = { destination: undefined, goToPoint: vi.fn(() => true), stop: vi.fn() };
  let deployment: PlantDeployment | undefined;
  try {
    expect((await executeDebugCommand('c_give("dug_sapling",2)', s.inventory)).ok).toBe(true);
    expect(s.inventory.transfer(inventorySlotAddress(0), cursorSlotAddress(), 2)).toBe(true);
    const source = () => {
      const address = cursorSlotAddress(), entity = s.inventory.getEntity(address);
      if (!entity) return undefined;
      const isValid = () => s.inventory.getEntity(address) === entity && !entity.isRemoved;
      return { entity, isValid, take: () => isValid() ? s.inventory.extract(address, 1, entity) ?? undefined : undefined,
        putBack: (item: typeof entity) => { s.inventory.receiveAt(address, item); } };
    };
    const prepare = vi.fn(() => s.saplings.prepareTransplant('sapling'));
    deployment = new PlantDeployment(s.world, animation, locomotor, source, {
      plants: { sapling: { prepareTransplant: prepare } }, canPlant: point => point.x >= 0,
    });
    const point = new THREE.Vector3(2, 0, 0);
    expect(deployment.request(new THREE.Vector3(-1, 0, 0))).toBe(false);
    expect(deployment.request(point)).toBe(true);
    await prepare.mock.results.at(-1)!.value;
    await new Promise(resolve => setTimeout(resolve, 0));
    deployment.update(); graph.update(5 / 30); deployment.cancel(); graph.update(1);
    expect(s.inventory.get(cursorSlotAddress())?.count).toBe(2);
    expect(s.saplings.exportRecords()).toEqual([]);
    expect(deployment.request(point)).toBe(true);
    await prepare.mock.results.at(-1)!.value;
    await new Promise(resolve => setTimeout(resolve, 0));
    deployment.update(); graph.update(5 / 30);
    expect(s.inventory.get(cursorSlotAddress())?.count).toBe(2);
    graph.update(1 / 30);
    expect(s.inventory.get(cursorSlotAddress())?.count).toBe(1);
    const model = s.saplings.digTargets[0].model, pickable = model.userData.components.pickable;
    expect(model.position.equals(point)).toBe(true);
    expect(model.userData.animationController.currentAnimation).toBe('empty');
    expect(pickable.exportState()).toEqual({ picked: true, transplanted: true, regrowSeconds: 1920 });
    expect(pickable.CanBeFertilized()).toBe(false);
    expect(deployment.canDeploy(new THREE.Vector3(4.9, 0, 0), source()!.entity)).toBe(false);
    expect(deployment.canDeploy(new THREE.Vector3(5.1, 0, 0), source()!.entity)).toBe(true);
    tickWorld(s.scheduler, s.saplings, 400, new THREE.Quaternion());
    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG), record = saved.world.entities.sapling[0];
    await restored.saplings.spawn('sapling', new THREE.Vector3(...record.transform.position), record);
    restored.inventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    expect(restored.saplings.exportRecords()).toEqual(s.saplings.exportRecords());
    expect(restored.inventory.exportState()).toEqual(s.inventory.exportState());
    const copy = restored.saplings.digTargets[0].model;
    expect(copy.userData.animationController.currentAnimation).toBe('empty');
    tickWorld(restored.scheduler, restored.saplings, 1520, new THREE.Quaternion());
    expect(copy.userData.components.pickable.canBePicked).toBe(true);
    expect(copy.userData.animationController.currentAnimation).toBe('grow');
  } finally { deployment?.dispose(); graph.cancelAction(); s.dispose(); restored.dispose(); }
});

it('picks twigs, regrows after four days through grow → sway, and saves/restores the empty sapling', async () => {
  const s = setup(), restored = setup();
  try {
    s.player.position.set(3, 0, 6);
    expect((await executeDebugCommand('c_spawn("sapling")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    const [model] = s.scene.children.filter(child => child.userData.prefab === 'sapling') as THREE.Group[];
    const animation = model.userData.animationController;
    expect(animation.currentAnimation).toBe('sway');
    expect(model.userData.tags).toEqual(['plant', 'renewable', 'silviculture', 'lunarplant_target', 'pickable', 'tickingarea', 'canlight']);
    expect(model.userData.actionEntity.hasTag('DIG_workable')).toBe(true);
    expect(getPickActions(model).find(action => action.model === model)?.available).toBe(true);

    expect(model.userData.components.pickable.pick({ giveItem: (item: string, count: number) => s.inventory.add(item, count) })).toBe(true);
    expect(s.inventory.count('twigs')).toBe(1);
    expect(animation.currentAnimation).toBe('picked');
    expect(model.userData.tags).not.toContain('pickable');
    tickWorld(s.scheduler, s.saplings, 1000, new THREE.Quaternion());

    const saved = deserializeSave(s.save(), SAVE_CATALOG);
    const [record] = saved.world.entities.sapling;
    expect(record.components.pickable).toEqual({ picked: true, regrowSeconds: 920 });
    const copy = await restored.saplings.spawn('sapling', new THREE.Vector3(...record.transform.position), record);
    // Pickable:OnLoad calls makeemptyfn rather than replaying the pick.
    expect(copy.userData.animationController.currentAnimation).toBe('empty');
    expect(copy.userData.entityId).toBe(model.userData.entityId);

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
    expect(model.parent).toBeNull();
    expect(s.ground.exportRecords().at(-1)?.components.stack).toMatchObject({ itemId: 'ash', count: 1 });
  } finally { s.dispose(); }
});
