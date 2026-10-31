import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PANDORAS_CHEST_DEFINITION, PANDORAS_CHEST_ID } from '../../prefab/src/pandoraschest';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import type { PlacementSaveRecord } from '../../prefab/src/saveRecord';
import type { WorldContext } from '../../prefab/src/worldContext';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { prefabDisplay } from '@dontstarve-web/display';

// An imported Caves record: the ruins chest with the chest_labyrinth loot it was saved with.
const RECORD: PlacementSaveRecord = {
  id: 'dst_04E26ADB66396E8D_pandoraschest_id_101861',
  transform: { position: [2316, 0, 852], rotationY: 0 },
  components: {
    container: { slotCount: 9, slots: [
      { slotKey: '0', item: { entityId: 'dst_04E26ADB66396E8D_pandoraschest_id_101861_0', itemId: 'footballhat', count: 1 } },
      { slotKey: '1', item: { entityId: 'dst_04E26ADB66396E8D_pandoraschest_id_101861_1', itemId: 'spear', count: 1 } },
    ] },
    building: { state: 'closed' },
  },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const relative = url.slice(url.indexOf('/dst/data/') + '/dst/data/'.length);
    return new Response(await readFile(new URL(`../../../public/dst/data/${relative}`, import.meta.url)));
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createPlacement(awake = createSignal(true)) {
  const scheduler = new GameTimeScheduler();
  const world = { scene: new THREE.Scene(), player: new THREE.Object3D(), ground: new THREE.Group(), scheduler,
    camera: new THREE.PerspectiveCamera(), renderer: { domElement: new EventTarget() },
    tickingarea: () => createMemo(() => awake.get()) } as unknown as WorldContext;
  const placement = new AnimatedBuildingPlacement(world, { [PANDORAS_CHEST_ID]: PANDORAS_CHEST_DEFINITION }, () => true);
  return { world, placement, awake, dispose: () => { placement.dispose(); scheduler.dispose(); } };
}

it('loads a saved chest with MakeChest tags and components and the non-looping closed clip, and saves it unchanged', async () => {
  const { placement, dispose } = createPlacement();
  try {
    const model = placement.spawnFromSave(PANDORAS_CHEST_ID, RECORD);
    const instance = prefabInstance(model)!;
    // fn: PlayAnimation("closed") without looping, so the clip rests on its last frame.
    expect(instance.sprite.sprite.peek().clip).toMatchObject({ name: 'closed', loop: false, finished: true });
    expect(instance.sprite.sprite.peek().queue).toEqual([]);
    await prefabDisplay(model)!.artLoaded();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/dst/data/anim/pandoras_chest.zip'));
    expect(instance.sprite.currentAnimation).toBe('closed');
    for (const tag of ['structure', 'chest', 'SnowCovered']) expect(instance.hasTag(tag)).toBe(true);
    // indestructible = true: no workable, lootdropper or burnable.
    expect(Object.keys(instance.components).sort())
      .toEqual(['container', 'hauntable', 'inspectable', 'lunarhailbuildup', 'roseinspectable']);
    expect(instance.hasTag('HAMMER_workable')).toBe(false);
    expect(instance.components.container!.GetNumSlots()).toBe(9);
    expect(instance.entityId).toBe(RECORD.id);
    expect(placement.exportRecords()).toEqual([{ prefabId: PANDORAS_CHEST_ID, record: RECORD }]);
  } finally { dispose(); }
});

it('releases the chest art while its tile sleeps and redraws the declared closed clip when it wakes', async () => {
  const { world, placement, awake, dispose } = createPlacement();
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    const model = placement.spawnFromSave(PANDORAS_CHEST_ID, RECORD);
    const instance = prefabInstance(model)!, display = prefabDisplay(model)!;
    await display.artLoaded();
    const declared = instance.sprite.sprite.peek().clip;
    expect(model.getObjectsByProperty('isMesh', true).length).toBeGreaterThan(0);

    awake.set(false); await tick();
    expect(instance.status.peek()).toBe('asleep');
    expect(model.parent).toBeNull();
    expect(instance.sprite.loaded).toBe(false);
    expect(model.getObjectsByProperty('isMesh', true)).toHaveLength(0);
    expect(instance.components.container!.GetNumSlots()).toBe(9);

    awake.set(true); await tick(); await display.artLoaded();
    expect(model.parent).toBe(world.scene);
    expect(instance.sprite.loaded).toBe(true);
    expect(instance.sprite.sprite.peek().clip).toEqual(declared);
    expect(instance.sprite.currentAnimation).toBe('closed');
    expect(model.getObjectsByProperty('isMesh', true).length).toBeGreaterThan(0);
    expect(placement.exportRecords()[0].record).toEqual(RECORD);
  } finally { dispose(); }
});
