import { findActionEntity } from '../../prefab/src/actionEntity';
import { prefabDisplay } from '@dontstarve-web/display';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { FlowerPlanting } from '../../prefab/src/flower';
import { PlantDeployment } from '../../prefab/src/plantDeployment';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import type { ActionAnimationController } from '../../stategraphs/src/actionContext';
import { createInventoryStore } from '../../../src/inventory';
import { cursorSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { createSignal, EventEmitter } from '../../signals/src';
import { PickActionController, getPickActions, type PickActor } from '../../stategraphs/src/pick';
import type { WorldEvents } from '../../prefab/src/worldContext';
import { Combat, type CombatInst } from '../../componets/src/combat';
import { Health } from '../../componets/src/health';
import { createPerishWorld } from './perishWorldFixture';
import { PERISH_FAST } from '../../componets/src/perishable';
import { GroundItemManager } from '../../../src/groundItems';
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { SpriteState } from '../../display/src/spriteState';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(random = () => .5) {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const scene = new THREE.Scene(), player = new THREE.Group(), canvas = new EventTarget();
  const world = { scene, player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    worldEvents: new EventEmitter<WorldEvents>(),
    cameraFacing: createSignal(1), cameraHeading: createSignal(0),
    renderer: { domElement: canvas } as unknown as THREE.WebGLRenderer };
  const flowers = new FlowerPlanting(world, random);
  const inventory = createInventoryStore([]), registry = new EntityRegistry();
  registry.register(PREFAB_DEFINITIONS.flowers, {
    restore: (_, record) => flowers.spawnFromSave(record.id, record.components.flower!.animation, new THREE.Vector3(...record.transform.position), record.components.flower!.planted === true),
    debugSpawn: async () => { flowers.transplant(player.position); },
    exportRecords: () => flowers.exportRecords().map(record => ({ prefabId: 'flower', record })),
    dispose: () => flowers.dispose(),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: { flower: flowers.exportRecords() }, inventory: inventory.exportState(),
    elapsedSeconds: 100, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  return { world, flowers, inventory, registry, save, dispose: () => { registry.dispose(); inventory.dispose(); } };
}

it('buffers planting at frame six, preserves cancelled butterflies and saves the flower and cursor stack', async () => {
  const s = setup(), restored = setup();
  const graph = new WilsonStateGraph({ playAnimation: () => 1, playSound() {}, stopSound() {}, setCasting() {}, onStateChanged() {} });
  const animation = { stategraph: graph, cancelEmote: vi.fn(), setFacing: vi.fn() } as unknown as ActionAnimationController;
  const locomotor = { destination: undefined, goToPoint: vi.fn(() => true), stop: vi.fn() };
  let deployment: PlantDeployment | undefined;
  try {
    expect((await executeDebugCommand('c_give("butterfly",2)', s.inventory)).ok).toBe(true);
    s.inventory.getEntity(inventorySlotAddress(0))!.setFreshnessPercent(.6);
    expect(s.inventory.transfer(inventorySlotAddress(0), cursorSlotAddress(), 2)).toBe(true);
    const source = () => {
      const address = cursorSlotAddress(), entity = s.inventory.getEntity(address);
      if (!entity) return undefined;
      const isValid = () => s.inventory.getEntity(address) === entity && !entity.isRemoved;
      return { entity, isValid, take: () => isValid() ? s.inventory.extract(address, 1, entity) ?? undefined : undefined,
        putBack: (item: typeof entity) => { s.inventory.receiveAt(address, item); } };
    };
    const transplant = vi.fn((position: THREE.Vector3) => s.flowers.transplant(position));
    const point = new THREE.Vector3(2, 0, 0);
    vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(point);
    deployment = new PlantDeployment(s.world, animation, locomotor, source, {
      plants: { planted_flower: { transplant } }, canPlant: point => point.x >= 0,
    });
    expect(deployment.request(new THREE.Vector3(-1, 0, 0))).toBe(false);
    expect(deployment.request(point)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    deployment.update(); graph.update(5 / 30); deployment.cancel(); graph.update(1);
    expect(transplant).not.toHaveBeenCalled();
    expect(s.inventory.get(cursorSlotAddress())?.count).toBe(2);
    expect(s.flowers.exportRecords()).toEqual([]);
    expect(deployment.request(point)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    deployment.update(); graph.update(5 / 30);
    expect(s.inventory.get(cursorSlotAddress())?.count).toBe(2);
    graph.update(1 / 30);
    expect(s.inventory.get(cursorSlotAddress())).toMatchObject({ count: 1, freshnessPercent: .6 });
    const record = s.flowers.exportRecords()[0];
    expect(record.transform.position).toEqual(point.toArray());
    expect(record.components.flower).toEqual({ animation: 'f6', planted: true });
    const flower = s.world.scene.children.find(model => lookupPrefabInstance(model)?.prefab === 'flower')!;
    expect(prefabInstance(flower)!.listTags()).toContain('flower');
    // The planted flower exists at once; its display draws it once the art has loaded.
    await prefabDisplay(flower).artLoaded();
    expect(s.flowers.renderEntities.find(entity => entity.object === flower)?.footPosition).toBe(flower.position);
    expect(deployment.canDeploy(new THREE.Vector3(4.2, 0, 0), source()!.entity)).toBe(false);
    expect(deployment.canDeploy(new THREE.Vector3(4.3, 0, 0), source()!.entity)).toBe(true);
    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG);
    await restored.flowers.spawnFromSave(record.id, record.components.flower.animation, new THREE.Vector3(...record.transform.position));
    restored.inventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    expect(restored.flowers.exportRecords()).toEqual(s.flowers.exportRecords());
    expect(restored.inventory.exportState()).toEqual(s.inventory.exportState());
    expect(saved.world.entities.flower).toEqual([record]);
  } finally { deployment?.dispose(); graph.cancelAction(); s.dispose(); restored.dispose(); }
});

it('quick-picks petals at frame six, preserves a cancelled flower and reloads the harvested result', async () => {
  const s = setup(), restored = setup();
  const graph = new WilsonStateGraph({ playAnimation: () => 1, playSound() {}, stopSound() {}, setCasting() {}, onStateChanged() {} });
  const animation = { stategraph: graph, cancelEmote: vi.fn(), setFacing: vi.fn() } as unknown as ActionAnimationController;
  const locomotor = { destination: undefined, goToPoint: vi.fn(() => true), stop: vi.fn() };
  const sanity = vi.fn(), killed = vi.fn();
  const picker: PickActor = { hasTag: () => false, components: { sanity: { DoDelta: sanity } } };
  const prepare = vi.fn(() => ({ picker, giveItem: (itemId: string, count: number) => s.inventory.add(itemId, count), dispose: vi.fn() }));
  const controller = new PickActionController(s.world, animation, locomotor, prepare, new SpriteState({ name: 'idle' }));
  try {
    const flower = await s.flowers.spawnFromSave('flower:pick', 'f6', new THREE.Vector3(2, 0, 0));
    const component = (findActionEntity(flower)?.components ?? prefabInstance(flower)!.components).pickable;
    const entity = findActionEntity(flower);
    const candidate = getPickActions(flower)[0];
    expect(candidate.available).toBe(true);
    s.world.worldEvents.on('plantkilled', killed);
    const picked = vi.fn(() => expect(flower.parent).toBe(s.world.scene));
    flower.addEventListener('picked' as never, picked);
    const target = candidate.action.target as Parameters<PickActionController['request']>[0];
    expect(controller.request(target)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.update(); expect(graph.stateName).toBe('doshortaction');
    graph.update(5 / 30); controller.cancel(); graph.update(1);
    expect(s.inventory.count('petals')).toBe(0);
    expect(s.flowers.exportRecords()).toHaveLength(1);
    expect(sanity).not.toHaveBeenCalled();
    expect(controller.request(target)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.update(); graph.update(5 / 30);
    expect(s.inventory.count('petals')).toBe(0);
    graph.update(1 / 30);
    expect(s.inventory.count('petals')).toBe(1);
    expect(sanity).toHaveBeenCalledExactlyOnceWith(5);
    expect(killed).toHaveBeenCalledWith({ doer: picker, pos: new THREE.Vector3(2, 0, 0) });
    expect(picked).toHaveBeenCalledOnce();
    expect(entity.isRemoved).toBe(true);
    expect(component.state.timer.peek()).toEqual({ status: 'stopped' });
    expect(component.canBePicked).toBe(false);
    expect(flower.parent).toBeNull();
    expect(s.flowers.plantedFlowers).toEqual([]);
    expect(s.flowers.renderEntities).toEqual([]);
    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG);
    expect(saved.world.entities.flower).toEqual([]);
    restored.inventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    expect(restored.inventory.exportState()).toEqual(s.inventory.exportState());
  } finally { controller.dispose(); graph.cancelAction(); s.dispose(); restored.dispose(); }
});

it('applies rose thorns through combat and respects equipped bramble protection and plantkin sanity immunity', async () => {
  const s = setup();
  const sanity = vi.fn(), pushEvent = vi.fn();
  const inst: CombatInst = { getPosition: () => s.world.player.position, getPhysicsRadius: () => 0,
    hasTag: () => false, components: {} };
  const health = new Health(150), combat = new Combat(inst, () => 0);
  inst.components.health = health;
  const picker: PickActor = { hasTag: () => false, PushEvent: pushEvent,
    components: { sanity: { DoDelta: sanity }, combat, inventory: s.inventory } };
  try {
    // A carried protective item does not protect until equipped.
    s.inventory.add('torch', 1);
    const torch = s.inventory.getEntity(inventorySlotAddress(0))!;
    torch.addTag('bramble_resistant');
    const rose = await s.flowers.spawnFromSave('rose:pick', 'rose', new THREE.Vector3());
    const component = (findActionEntity(rose)?.components ?? prefabInstance(rose)!.components).pickable;
    expect(component.pick({ picker, giveItem: () => false })).toBe(false);
    expect(health.currenthealth).toBe(150); expect(sanity).not.toHaveBeenCalled();
    expect(component.pick({ picker, giveItem: (itemId: string, count: number) => s.inventory.add(itemId, count) })).toBe(true);
    expect(health.currenthealth).toBe(149);
    expect(pushEvent).toHaveBeenCalledExactlyOnceWith('thorns');
    expect(sanity).toHaveBeenCalledExactlyOnceWith(5);
    expect(s.inventory.EquipFromInventory(torch)).toBe(true);
    const protectedRose = await s.flowers.spawnFromSave('rose:protected', 'rose', new THREE.Vector3(8, 0, 0));
    expect((findActionEntity(protectedRose)?.components ?? prefabInstance(protectedRose)!.components).pickable.pick({
      picker: { ...picker, hasTag: (tag: string) => tag === 'plantkin' },
      giveItem: (itemId: string, count: number) => s.inventory.add(itemId, count),
    })).toBe(true);
    expect(health.currenthealth).toBe(149);
    expect(pushEvent).toHaveBeenCalledOnce(); expect(sanity).toHaveBeenCalledOnce();
    expect(s.inventory.count('petals')).toBe(2);
  } finally { health.dispose(); s.dispose(); }
});

it('perishes harvested petals in discrete batches and preserves freshness and quantity through cursor transfer and reload', async () => {
  const s = setup(), restored = setup(), world = createPerishWorld(), restoredWorld = createPerishWorld();
  s.inventory.entities.bindPerishWorld(world); restored.inventory.entities.bindPerishWorld(restoredWorld);
  const ground = new GroundItemManager(s.world.scene, s.world.camera, s.world.renderer, '/dst/data/databundles/images.zip',
    s.inventory, '/dst/data/anim', s.world.player);
  const restoredGround = new GroundItemManager(restored.world.scene, restored.world.camera, restored.world.renderer, '/dst/data/databundles/images.zip',
    restored.inventory, '/dst/data/anim', restored.world.player);
  ground.entities.bindPerishWorld(world); restoredGround.entities.bindPerishWorld(restoredWorld);
  try {
    const flower = await s.flowers.spawnFromSave('flower:petals', 'f1', new THREE.Vector3());
    expect((findActionEntity(flower)?.components ?? prefabInstance(flower)!.components).pickable.pick({
      giveItem: (itemId: string, count: number) => s.inventory.add(itemId, count),
    })).toBe(true);
    expect((await executeDebugCommand('c_give("petals")', s.inventory)).ok).toBe(true);
    const entity = s.inventory.getEntity(inventorySlotAddress(0))!, perishable = entity.components.perishable;
    expect(perishable.perishtime.peek()).toBe(PERISH_FAST);
    const timer = perishable.timer.peek();
    world.advance(9); expect(perishable.timer.peek()).toBe(timer);
    world.advance(1);
    expect(perishable.timer.peek()).toEqual({ status: 'perishing', remainingSeconds: PERISH_FAST - 10 });
    world.advance(3);
    expect(s.inventory.transfer(inventorySlotAddress(0), cursorSlotAddress(), 2)).toBe(true);
    expect(s.inventory.getEntity(cursorSlotAddress())).toBe(entity);
    expect(perishable.timer.peek()).toEqual({ status: 'perishing', remainingSeconds: PERISH_FAST - 13 });
    expect((await executeDebugCommand('c_spawn("petals")', s.inventory, async id => {
      if (!PREFAB_DEFINITIONS.groundItems.debugSpawnIds.includes(id)) return false;
      await ground.spawnFromSave('petals:ground', { ...SAVE_CATALOG.items[id], itemId: id, count: 1, freshnessPercent: .25 }, new THREE.Vector3(12, 0, 9));
      return true;
    })).ok).toBe(true);
    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG), {
        entities: { flower: s.flowers.exportRecords(), ground_item: ground.exportRecords() }, inventory: s.inventory.exportState(),
        elapsedSeconds: world.scheduler.now, playerTransform: { position: [0, 0, 0], rotationY: 0 },
      }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG);
    restored.inventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    expect(restored.inventory.exportState()).toEqual(s.inventory.exportState());
    const loaded = restored.inventory.getEntity(cursorSlotAddress())!;
    expect(loaded.components.perishable.GetPercent()).toBeCloseTo((PERISH_FAST - 13) / PERISH_FAST);
    const record = saved.world.entities.ground_item[0], stack = record.components.stack!;
    await restoredGround.spawnFromSave(record.id, { ...SAVE_CATALOG.items[stack.itemId], ...stack }, new THREE.Vector3(...record.transform.position));
    expect(restoredGround.exportRecords()).toEqual(ground.exportRecords());
    restoredWorld.advance(480);
    await vi.waitFor(() => expect(restoredGround.exportRecords()[0].components.stack?.itemId).toBe('spoiled_food'));
    expect(restoredGround.exportRecords()[0]).toMatchObject({ transform: record.transform, components: { stack: { count: 1 } } });
    restoredWorld.advance(PERISH_FAST - 480);
    expect(loaded.isRemoved).toBe(true);
    expect(loaded.components.perishable.updateTimer.peek()).toEqual({ status: 'stopped' });
    expect(restored.inventory.get(cursorSlotAddress())).toMatchObject({ itemId: 'spoiled_food', count: 2 });
    expect(restored.inventory.count('petals')).toBe(0);
  } finally { ground.dispose(); restoredGround.dispose(); s.dispose(); restored.dispose(); }
});

it('spawns the source planted_flower command as a persistent flower, including its rose type', async () => {
  const s = setup(() => 0), restored = setup();
  try {
    s.world.player.position.set(9, 0, 6);
    expect((await executeDebugCommand('c_spawn("planted_flower")', s.inventory, id => s.registry.spawn(id))).ok).toBe(true);
    const model = s.world.scene.children[0];
    expect(lookupPrefabInstance(model)?.prefab).toBe('flower');
    expect(prefabInstance(model)!.listTags()).toContain('thorny');
    let json = '';
    expect((await executeDebugCommand('c_save()', s.inventory, undefined, () => { json = s.save(); })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG), record = saved.world.entities.flower[0];
    await restored.flowers.spawnFromSave(record.id, record.components.flower!.animation, new THREE.Vector3(...record.transform.position), record.components.flower!.planted === true);
    expect(restored.flowers.exportRecords()).toEqual(s.flowers.exportRecords());
    expect(record.transform.position).toEqual([9, 0, 6]);
  } finally { s.dispose(); restored.dispose(); }
});

it('restores natural flowers without changing their planted flag and preserves both origins through save/load', async () => {
  const s = setup(), restored = setup();
  try {
    await s.flowers.spawnFromSave('flower:natural', 'rose', new THREE.Vector3(12, 0, 24), false);
    await s.flowers.spawnFromSave('flower:planted', 'f4', new THREE.Vector3(24, 0, 24));
    const save = deserializeSave(s.save(), SAVE_CATALOG);
    const [natural, planted] = save.world.entities.flower;
    expect(natural.components.flower).toEqual({ animation: 'rose' });
    expect(planted.components.flower).toEqual({ animation: 'f4', planted: true });
    for (const record of save.world.entities.flower) await restored.flowers.spawnFromSave(record.id,
      record.components.flower!.animation, new THREE.Vector3(...record.transform.position), record.components.flower!.planted === true);
    expect(restored.flowers.exportRecords()).toEqual(s.flowers.exportRecords());
    expect(restored.world.scene.children[0].userData.planted).toBe(false);
    expect(prefabInstance(restored.world.scene.children[0])!.listTags()).toContain('thorny');
  } finally { s.dispose(); restored.dispose(); }
});
