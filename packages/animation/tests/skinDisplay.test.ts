import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { prefabDisplay } from '@dontstarve-web/display';
import type { ArchiveSpriteAssets } from '@dontstarve-web/animation/archiveSprite';
import { InventorySlot, InventoryStore, inventorySlotAddress, type ItemEntity } from '../../inventory/src';
import { INVENTORY_ITEM_SPECS } from '../../../src/inventoryItems';
import { createArchiveEntity, prefabInstance } from '../../prefab/src/prefabInstance';
import { itemAt, ItemWorldFixture } from './itemWorldFixture';
import { createPickupInventory } from './pickupFixture';
import { SpriteResources } from '../../display/src/spriteResources';
import definitions from '../../prefab/src/definitions.json';
import { testInventoryStore } from './testInventory';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const fetchAsset = async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)));
const meshOf = (model: THREE.Object3D) => model.getObjectByProperty('isMesh', true) as THREE.Mesh;
/** The archive owner the item's declared skin source draws from. */
const skinArt = (inst: ItemEntity) => (inst.sprite.sprite.peek().appearance.get('skin') as unknown as { skin: { art: ArchiveSpriteAssets } }).skin.art;
const itemWorld = (scene: THREE.Scene, inventory: InventoryStore) => new ItemWorldFixture(scene, new THREE.PerspectiveCamera(), undefined,
  '/dst/data/databundles/images.zip', inventory, '/dst/data/anim', new THREE.Group());
const materialNames = (model: THREE.Object3D) => {
  const material = meshOf(model).material;
  return (Array.isArray(material) ? material : [material]).map(material => material.name);
};

beforeEach(() => { vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('fetch', fetchAsset); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('uses the latest json skin while paused, reuses loaded art, and ignores a load completed after removal', async () => {
  const archives = GROUND_ITEM_DEFINITIONS.greenstaff.skinArchives;
  let releaseFirst!: () => void, releaseLast!: () => void;
  const first = new Promise<void>(resolve => { releaseFirst = resolve; });
  const last = new Promise<void>(resolve => { releaseLast = resolve; });
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('dynamic/greenstaff_an.')) { await first; }
    if (url.includes('dynamic/greenstaff_planet.')) { await last; }
    return fetchAsset(url);
  });
  vi.stubGlobal('fetch', fetch);
  const scene = new THREE.Scene(), inventory = createPickupInventory(), items = itemWorld(scene, inventory);
  const model = items.spawnFromSave('greenstaff', { itemId: 'greenstaff', count: 1, name: 'greenstaff', icon: '' }, new THREE.Vector3());
  const instance = itemAt(model), display = prefabDisplay(model)!, assets = skinArt(instance);
  try {
    await display.artLoaded();
    const base = materialNames(model), clip = instance.sprite.sprite.peek().clip;
    instance.sprite.setPaused(true);
    instance.skinId = 'greenstaff_an';
    await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes('dynamic/greenstaff_an.'))).toBe(true));
    instance.skinId = 'greenstaff_clockwork';
    await display.artLoaded();
    expect(materialNames(model)).toContain('sprite:greenstaff_clockwork');
    releaseFirst();
    await assets.loadBuild(archives.greenstaff_an);
    await tick();
    expect(materialNames(model)).toContain('sprite:greenstaff_clockwork');
    const loads = fetch.mock.calls.length;
    instance.skinId = 'greenstaff_an';
    await tick();
    expect(materialNames(model)).toContain('sprite:greenstaff_an');
    expect(fetch).toHaveBeenCalledTimes(loads);
    instance.skinId = undefined;
    await tick();
    expect(materialNames(model)).toEqual(base);
    expect(instance.sprite.sprite.peek().clip).toBe(clip);

    instance.setActive(false); await tick();
    instance.skinId = 'greenstaff_planet'; await tick();
    expect(fetch).toHaveBeenCalledTimes(loads);
    expect(model.parent).toBeNull();
    instance.setActive(true);
    await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => url.includes('dynamic/greenstaff_planet.'))).toBe(true));
    const loaded = assets.loadBuild(archives.greenstaff_planet);
    instance.remove(); await tick();
    releaseLast(); await loaded; await tick();
    expect(model.parent).toBeNull();
    expect(model.getObjectByProperty('isMesh', true)).toBeUndefined();
    expect(scene.children).toHaveLength(0);
  } finally { releaseFirst(); releaseLast(); items.dispose(); inventory.dispose(); }
});

it('applies a layered skin without resetting the clip, progress, callback or private appearance', async () => {
  const definition: import('../../prefab/src/building').BuildingDeclaration = definitions.animatedBuildings.researchlab2;
  const resources = new SpriteResources();
  // Its own tint and opacity need the sprite's private material copies.
  const { instance, display } = createArchiveEntity('researchlab2', resources.archive({ animationArchive: definition.archive,
    buildArchives: [definition.buildArchive ?? definition.archive], bank: 'researchlab2' }, { colour: [1, 1, 1], opacity: 1 }),
  { name: 'proximity_loop' }, 'researchlab2', entity => {
    entity.sprite.setSkinSource({ archives: definition.skinArchives!, art: resources.archives,
      symbols: definition.skinSymbols, baseSymbols: definition.baseSymbols, animationBanks: definition.skinAnimationBanks });
  });
  try {
    await display.artLoaded();
    const model = display.model, sprite = instance.sprite, complete = vi.fn();
    sprite.setColour([.3, .6, .9]); sprite.setOpacity(.4);
    sprite.playOnce('proximity_loop', complete);
    const frames = sprite.numFrames, dt = sprite.currentAnimationLength / frames;
    const halfway = Math.floor(frames / 2);
    sprite.setFrame(1);
    for (let frame = 1; frame < halfway; frame++) { sprite.update(dt); }
    const clip = sprite.sprite.peek().clip;
    instance.skinId = 'researchlab2_pod';
    await display.artLoaded();
    expect(sprite.sprite.peek().clip).toBe(clip);
    expect(complete).not.toHaveBeenCalled();
    expect(materialNames(model)).toContain('sprite:researchlab2_pod');
    const materials = meshOf(model).material as THREE.MeshBasicMaterial[];
    expect(materials.every(material => material.opacity === .4)).toBe(true);
    expect(materials.every(material => material.color.toArray().every((value, index) => Math.abs(value - [.3, .6, .9][index]) < 1e-6))).toBe(true);
    const op = sprite.sprite.peek().appearance.get('skin');
    expect(op?.kind).toBe('skin');
    expect(resources.archives.peekAnimation(definition.skinArchives!.researchlab2_pod)).toBeDefined();
    for (let frame = halfway; frame < frames; frame++) { sprite.update(dt); }
    expect(complete).toHaveBeenCalledOnce();
    instance.skinId = undefined;
    await display.artLoaded();
    expect(materialNames(model)).not.toContain('sprite:researchlab2_pod');
    expect(sprite.sprite.peek().clip).toBe(clip);
    expect(complete).toHaveBeenCalledOnce();
  } finally { instance.remove(); display.dispose(); resources.dispose(); }
});

it('keeps an item\'s skin on its own sprite json across the ground, a container and the next drop', async () => {
  const slot = inventorySlotAddress(0);
  const inventory = testInventoryStore([{ address: slot, slot: new InventorySlot() }], INVENTORY_ITEM_SPECS);
  const items = itemWorld(new THREE.Scene(), inventory);
  const entity = inventory.entities.create({ itemId: 'greenstaff', count: 1 });
  const definition = { ...entity.snapshot(), name: 'greenstaff', icon: 'greenstaff.tex', entity };
  items.spawnGroundItem(definition, new THREE.Vector3());
  try {
    // The ground display draws the item's sprite; reskinning on the ground writes that json and nothing else.
    expect(prefabInstance(entity.transform.model)!.sprite).toBe(entity.sprite);
    entity.skinId = 'greenstaff_an';
    expect(entity.sprite.sprite.peek().skinId).toBe('greenstaff_an');
    expect(entity.snapshot().skinId).toBe('greenstaff_an');
    // Picked up: the inst leaves the scene, it and its sprite json stay, and the slot reads the skin from it.
    expect(inventory.receiveAt(slot, entity)).toBe(true);
    expect(entity.inlimbo).toBe(true);
    expect(inventory.get(slot)?.skinId).toBe('greenstaff_an');
    entity.skinId = 'greenstaff_clockwork';
    expect(inventory.get(slot)?.skinId).toBe('greenstaff_clockwork');
    // Dropped again: the same inst returns to the scene, dressed in its skin.
    expect(inventory.extract(slot, 1, entity)).toBe(entity);
    items.spawnGroundItem(definition, new THREE.Vector3(1, 0, 1));
    expect(prefabInstance(entity.transform.model)!.sprite).toBe(entity.sprite);
    await prefabDisplay(entity.transform.model)!.artLoaded();
    expect(materialNames(entity.transform.model)).toContain('sprite:greenstaff_clockwork');
  } finally { items.dispose(); inventory.dispose(); }
});
