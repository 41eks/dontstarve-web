import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowerPlanting, FLOWER_ANIMATIONS } from '../../prefab/src/flower';
import { ButterflyController } from '../../prefab/src/butterfly';
import { PointerRaycaster } from '../../prefab/src/pointerRaycaster';
import type { WorldContext } from '../../prefab/src/worldContext';
import { InventorySlot, InventoryStore, inventorySlotAddress } from '../../inventory/src';
import { getPrefabLightOverride } from '../../prefab/src/localLight';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup(random = () => 0.5) {
  const bytes = await readFile(new URL('../../../public/dst/data/anim/flowers.zip', import.meta.url));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
  const windowEvents = new EventTarget();
  vi.stubGlobal('window', windowEvents);
  const canvas = new EventTarget();
  const label = { show: vi.fn(), hide: vi.fn(), update: vi.fn() };
  const world = {
    scene: new THREE.Scene(), player: new THREE.Group(), ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(), renderer: { domElement: canvas },
    createCursorLabel: () => label,
  } as unknown as WorldContext;
  const address = inventorySlotAddress(0);
  const store = new InventoryStore([{ address, slot: new InventorySlot({ itemId: 'butterfly', count: 2 }) }], {
    butterfly: { name: '蝴蝶', icon: 'butterfly.tex', maxStack: 40 },
  });
  const consume = vi.fn(() => store.applySlotChanges([{ slot: address, itemId: 'butterfly', delta: -1 }]));
  const planted = vi.fn();
  const manager = new FlowerPlanting(world, 'anim', planted, random);
  const groundPoint = vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(new THREE.Vector3(3, 0, 4));
  const click = (button = 2) => canvas.dispatchEvent(Object.assign(new Event('pointerdown', { cancelable: true }), { button }));
  return { manager, world, store, address, consume, planted, groundPoint, click, label, windowEvents };
}

describe('butterfly planting', () => {
  it('shows the source placer without consuming inventory, then right-click plants exactly one flower', async () => {
    const s = await setup();
    await s.manager.begin(s.consume);
    expect(s.store.count('butterfly')).toBe(2);
    expect(s.label.show).toHaveBeenCalledWith(expect.stringContaining('种植'), 'right');
    const preview = s.world.scene.children[0];
    expect(preview.userData.tags).toBeUndefined();
    expect(getPrefabLightOverride(preview)).toBe(1);
    expect(s.manager.exportRecords()).toEqual([]);
    s.click(0);
    expect(s.consume).not.toHaveBeenCalled();
    s.groundPoint.mockReturnValue(undefined);
    s.click();
    expect(s.consume).not.toHaveBeenCalled();
    s.groundPoint.mockReturnValue(new THREE.Vector3(3, 0, 4));
    s.click();
    s.click();
    expect(s.store.count('butterfly')).toBe(1);
    expect(s.consume).toHaveBeenCalledTimes(1);
    expect(s.planted).toHaveBeenCalledTimes(1);
    expect(preview.parent).toBeNull();
    expect(getPrefabLightOverride(preview)).toBeUndefined();
    const flower = s.world.scene.children[0];
    expect(flower.name).toBe('Flower');
    expect(flower.userData.tags).toContain('flower');
    expect(s.manager.exportRecords()).toEqual([{
      id: flower.userData.entityId, transform: { position: [3, 0, 4], rotationY: 0 },
      components: { flower: { animation: 'f6', planted: true } },
    }]);
    expect(s.manager.renderEntities[0].footPosition.toArray()).toEqual([3, 0, 4]);
    const material = (flower.children[0].children[0] as THREE.Mesh).material as THREE.Material;
    expect(Array.isArray(material) ? material[0].opacity : material.opacity).toBe(1);
  });

  it('does not consume a butterfly on Escape, during a cancelled load, or when the source slot is empty', async () => {
    const s = await setup();
    let finishFetch!: (response: Response) => void;
    const actualFetch = fetch;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finishFetch = resolve; })));
    const loading = s.manager.begin(s.consume);
    s.windowEvents.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    finishFetch(await actualFetch('flowers.zip'));
    await loading;
    expect(s.world.scene.children).toEqual([]);
    expect(s.store.count('butterfly')).toBe(2);
    await s.manager.begin(s.consume);
    s.windowEvents.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    s.click();
    expect(s.consume).not.toHaveBeenCalled();
    await s.manager.begin(s.consume);
    s.store.applySlotChanges([{ slot: s.address, itemId: 'butterfly', delta: -2 }]);
    s.click();
    expect(s.manager.exportRecords()).toEqual([]);
    expect(s.world.scene.children).toEqual([]);
    expect(s.planted).not.toHaveBeenCalled();
  });

  it('keeps source spacing and preserves restored flower IDs and art without consuming butterflies', async () => {
    const s = await setup(() => 0);
    const rose = await s.manager.spawnFromSave('e_rose', 'rose', new THREE.Vector3(3, 0, 4));
    expect(rose.userData.tags).toContain('thorny');
    await s.manager.begin(s.consume);
    s.click();
    expect(s.consume).not.toHaveBeenCalled();
    s.groundPoint.mockReturnValue(new THREE.Vector3(5, 0, 4));
    s.click();
    expect(s.manager.exportRecords().map(({ components }) => components.flower.animation)).toEqual(['rose', 'rose']);
    const record = s.manager.exportRecords()[1];
    const restored = await setup();
    await restored.manager.spawnFromSave(record.id, record.components.flower.animation, new THREE.Vector3(...record.transform.position));
    expect(restored.manager.exportRecords()[0]).toEqual(record);
    expect(restored.consume).not.toHaveBeenCalled();
    for (const [index, animation] of FLOWER_ANIMATIONS.entries()) {
      await restored.manager.spawnFromSave(`e_variant_${index}`, animation, new THREE.Vector3(index, 0, 10));
    }
    expect(restored.world.scene.children).toHaveLength(12);
    const model = new THREE.Group();
    const butterfly = new ButterflyController(model, { start() {}, playOnce() {}, update() {} }, {
      isDay: () => true, getThreatPositions: () => [],
      getFlowers: () => restored.world.scene.children.map((object) => ({
        id: object.userData.entityId, position: object.position,
      })),
    });
    butterfly.update(0.1);
    expect(butterfly.targetFlowerId).toBe(record.id);
  });
});

it('disposes shared flower assets, preview and input listeners without planting', async () => {
  const s = await setup();
  await s.manager.spawnFromSave('e_flower', 'f1', new THREE.Vector3());
  await s.manager.begin(s.consume);
  const removeCanvas = vi.spyOn(s.world.renderer.domElement, 'removeEventListener');
  const removeWindow = vi.spyOn(s.windowEvents, 'removeEventListener');
  s.manager.dispose(); s.manager.dispose();
  expect(s.world.scene.children).toEqual([]);
  expect(s.manager.exportRecords()).toEqual([]);
  expect(removeCanvas).toHaveBeenCalledOnce();
  expect(removeWindow).toHaveBeenCalledTimes(2); // pointermove and Escape
  s.click();
  expect(s.consume).not.toHaveBeenCalled();
  await expect(s.manager.spawnFromSave('late', 'f1', new THREE.Vector3())).rejects.toThrow('disposed');
});
