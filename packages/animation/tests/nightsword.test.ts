import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS, GROUND_ITEM_SKIN_SPECS } from '../../prefab/src/groundItems';
import { createGroundItemVisual } from './groundItemVisual';
import { nightswordVisual } from '../../prefab/src/nightsword';
import { declaredSymbol } from './animStateFixture';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { AnimState } from '../src/animState';
import { GroundItemManager } from '../../../src/groundItems';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { createPickupInventory } from './pickupFixture';
import { inventorySlotAddress, equipmentSlotAddress } from '../../inventory/src';
import { performPickupAction, createPickupDoer } from '../../stategraphs/src/pickup';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { createSanityState } from '../../signals/src';
import { Sanity } from '../../componets/src/sanity';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('uses separate source ground and equipped art and renders a skin while moving and changing facing', async () => {
  const assets = new GroundItemAssets();
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = player.userData.animationController as WilsonAnimationController;
  const mesh = player.getObjectByProperty('isMesh', true) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  const usedMaterials = () => mesh.geometry.groups.map(group => mesh.material[group.materialIndex!].name);
  try {
    expect(GROUND_ITEM_DEFINITIONS.nightsword).toMatchObject({
      name: '暗夜剑', icon: 'nightsword.tex', atlas: 'images/inventoryimages.xml',
      bank: 'nightmaresword', animation: 'idle', animationArchive: 'nightmaresword.zip', buildArchives: ['nightmaresword.zip'],
    });
    expect(Object.keys(GROUND_ITEM_DEFINITIONS.nightsword.skinArchives)).toHaveLength(5);
    expect(GROUND_ITEM_SKIN_SPECS.nightsword_cotl).toMatchObject({ itemId: 'nightsword', icon: 'nightsword_cotl.tex' });
    const animState = new AnimState(() => {});
    nightswordVisual({ id: 'nightsword', prefab: 'nightsword' }).onequip({ AnimState: animState, PushEvent() {} });
    expect((await declaredSymbol(animState, assets, 'swap_object'))?.[0].materials[0].name).toBe('ground:swap_nightmaresword');
    expect(() => nightswordVisual({ id: 'nightsword', prefab: 'nightsword', skinId: 'pickaxe_invisible' })).toThrow('Unknown nightsword skin');
    for (const skinId of [undefined, 'nightsword_cotl']) {
      const ground = await createGroundItemVisual(assets, 'nightsword', skinId);
      try {
        const groundMesh = ground.model.children[0].children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
        expect(groundMesh.geometry.drawRange.count).toBeGreaterThan(0);
        expect(groundMesh.material.some(material => material.name === `ground:${skinId ?? 'nightmaresword'}`)).toBe(true);
        animation.setCarryItem('nightsword', skinId);
        await vi.waitFor(() => { animation.update(0); expect(usedMaterials()).toContain(`ground:${skinId ?? 'swap_nightmaresword'}`); });
        for (const [facing, mirrored] of [['up', false], ['down', false], ['side', true]] as const) {
          animation.setFacing(facing, mirrored); animation.start('walk'); animation.update(1 / 30);
          expect(usedMaterials()).toContain(`ground:${skinId ?? 'swap_nightmaresword'}`);
          expect(Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
          expect(mesh.material.every(material => material.forceSinglePass)).toBe(true);
        }
      } finally { ground.dispose(); }
    }
    await animation.setCarryItem(null);
    expect(usedMaterials()).not.toContain('ground:nightsword_cotl');
    expect(usedMaterials()).not.toContain('ground:swap_nightmaresword');
  } finally { assets.dispose(); }
});

it('spawns/gives individual swords, preserves failed drops and reskin/pickup identity, then saves and reloads ground and equipped swords', async () => {
  const inventory = createPickupInventory(), restoredInventory = createPickupInventory();
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), player = new THREE.Group();
  const renderer = { domElement: new EventTarget() } as unknown as THREE.WebGLRenderer;
  player.position.set(3, 0, -6);
  const manager = new GroundItemManager(scene, camera, renderer, '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', player);
  const restored = new GroundItemManager(new THREE.Scene(), camera, renderer, '/dst/data/databundles/images.zip', restoredInventory, '/dst/data/anim', player);
  const registry = new EntityRegistry();
  const currentSanity = createSanityState(100, 200);
  const sanity = new Sanity({ components: { inventory }, hasTag: () => false }, currentSanity);
  registry.register(PREFAB_DEFINITIONS.groundItems, {
    debugSpawn: id => manager.spawnFromSave(`spawn:${id}`, { ...SAVE_CATALOG.items[id], itemId: id, count: 1 }, player.position),
    restore: (_id, record) => manager.spawnFromSave(record.id, { ...SAVE_CATALOG.items[record.components.stack!.itemId],
      ...record.components.stack! }, new THREE.Vector3(...record.transform.position)),
    exportRecords: () => manager.exportRecords().map(record => ({ prefabId: 'ground_item', record })),
    dispose: () => manager.dispose(),
  });
  try {
    expect((await executeDebugCommand('c_spawn("nightsword")', inventory, prefab => registry.spawn(prefab))).ok).toBe(true);
    expect((await executeDebugCommand('c_give("nightsword", 2)', inventory)).ok).toBe(true);
    const hand = equipmentSlotAddress('hand'), bag = inventorySlotAddress(0);
    expect(inventory.get(bag)).toMatchObject({ itemId: 'nightsword', count: 1 });
    expect(inventory.get(inventorySlotAddress(1))).toMatchObject({ itemId: 'nightsword', count: 1 });
    expect(inventory.transfer(bag, hand, 1)).toBe(true);
    const entity = inventory.getEntity(hand)!;
    expect(inventory.handEquipment.peek()?.entity).toBe(entity);
    entity.setWet(true);
    const definition = { ...SAVE_CATALOG.items.nightsword, ...entity.snapshot() };
    const position = new THREE.Vector3(7, 0, 4);
    expect(await manager.drop(definition, position, () => false)).toBe(false);
    expect(inventory.getEntity(hand)).toBe(entity);
    expect(await manager.drop(definition, position, () => inventory.extract(hand, 1, entity) ?? false)).toBe(true);
    expect(inventory.handEquipment.peek()).toBeNull();
    const beforeSkin = manager.exportRecords().find(record => record.id === entity.id)!;
    const change = await manager.reskinTargets.find(target => target.id === entity.id)!.prepareNextSkin();
    expect(change.apply()).toBe(true); change.dispose();
    expect(entity.skinId).toBe('nightsword_cotl');
    expect(entity.signals.wet.peek()).toBe(true);
    const groundRecord = manager.exportRecords().find(record => record.id === entity.id)!;
    expect(groundRecord.transform).toEqual(beforeSkin.transform);
    const model = manager.reskinTargets.find(target => target.id === entity.id)!.model;
    expect(performPickupAction(model.userData.pickupTarget, createPickupDoer(player, inventory))).toBe(true);
    expect(inventory.getEntity(hand)).toBe(entity);
    expect(inventory.handEquipment.peek()?.skinId).toBe('nightsword_cotl');
    expect(manager.exportRecords().some(record => record.id === entity.id)).toBe(false);
    sanity.OnUpdate(30);
    expect(currentSanity.peek()).toBeCloseTo(87);
    const before = registry.exportRecords(), held = inventory.exportState();
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG), {
        entities: before, inventory: held, elapsedSeconds: 12.5,
        playerTransform: { position: [3, 0, -6], rotationY: 0 },
        playerStats: { health: 150, hunger: 150, sanity: currentSanity.peek() },
      }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG);
    restoredInventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    for (const record of saved.world.entities.ground_item) await restored.spawnFromSave(record.id, {
      ...SAVE_CATALOG.items[record.components.stack!.itemId], ...record.components.stack!,
    }, new THREE.Vector3(...record.transform.position));
    expect(restored.exportRecords()).toEqual(before.ground_item);
    expect(restoredInventory.exportState()).toEqual(held);
    expect(restoredInventory.getEntity(hand)!.snapshot()).toEqual(entity.snapshot());
    expect(saved.players.local.stats!.sanity).toBeCloseTo(87);
    const restoredSanity = createSanityState(saved.players.local.stats!.sanity, 200);
    const restoredComponent = new Sanity({ components: { inventory: restoredInventory }, hasTag: () => false }, restoredSanity);
    restoredComponent.OnUpdate(30);
    expect(restoredSanity.peek()).toBeCloseTo(74);
    restoredComponent.dispose();
  } finally { sanity.dispose(); registry.dispose(); restored.dispose(); inventory.dispose(); restoredInventory.dispose(); }
});
