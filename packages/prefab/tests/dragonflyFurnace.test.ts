import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { inventorySlotAddress, type ItemEntity } from '../../inventory/src';
import { prefabDisplay } from '../../display/src';
import { createSignal } from '../../signals/src';
import { findActionEntity } from '../src/actionEntity';
import type { DragonflyFurnaceInstance } from '../src/dragonfly_furnace';
import { prefabInstance } from '../src/prefabInstance';
import { PlaySound } from '../src/sound';
import type { WorldContext } from '../src/worldContext';
import { FRAMES } from '../../stategraphs/src/stategraph';
import { performRummageAction } from '../../stategraphs/src/rummage';
import { executeDebugCommand } from '../../../src/debugCommands';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { managedBuildings } from '../../../tests/fixtures/managedBuildings';
import { createPickupInventory } from '../../../tests/fixtures/pickupFixture';
import { sceneActions, sceneDoer } from '../../../tests/fixtures/sceneActions';
import { testItem, testRestoreItem } from '../../../tests/fixtures/testInventory';

vi.mock('../src/sound', async importOriginal => ({
  ...(await importOriginal<object>()),
  PlaySound: vi.fn(() => ({ stop: vi.fn(), isPlaying: () => false, setVolume: vi.fn() })),
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const FIRE_LOOP = 'dontstarve/common/together/dragonfly_furnace/fire_LP';
const played = () => vi.mocked(PlaySound).mock.calls.map(([path]) => path);

/** A world whose building containers are addressed in `inventory`, as the scene registers them. */
function setup(inventory = createPickupInventory(), dropLoot = vi.fn()) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  const world = {
    scene: new THREE.Scene(),
    player: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(),
    cameraFacing: createSignal(8),
    cameraHeading: createSignal(45),
    renderer: { domElement: new EventTarget() },
    dropLoot,
    registerContainer: (...args: Parameters<typeof inventory.registerContainer>) =>
      inventory.registerContainer(...args),
    unregisterContainer: (...args: Parameters<typeof inventory.unregisterContainer>) =>
      inventory.unregisterContainer(...args),
    spawnItem: testItem,
    restoreItem: testRestoreItem,
  } as unknown as WorldContext;
  return { inventory, dropLoot, placement: managedBuildings(world, { consume: () => false }) };
}

it('builds on the source timeline, heats and lights, and hammers down to its loot and contents', async () => {
  const { inventory, dropLoot, placement } = setup();
  try {
    const model = placement.spawnFromSave('dragonflyfurnace', {
      id: 'furnace',
      transform: { position: [3, 0, -6], rotationY: 0 },
      components: {
        building: {},
        container: { items: { 1: { id: 'stored-seeds', prefab: 'seeds', components: { stackable: { stack: 2 } } } } },
      },
    });
    const inst = prefabInstance<DragonflyFurnaceInstance>(model)!;
    // A drawn sprite plays its clips through; with nothing drawn they settle at once.
    await prefabDisplay(model)!.artLoaded();
    placement.update(FRAMES);
    for (const tag of ['structure', 'wildfireprotected', 'cooker', 'HASHEATER']) {
      expect(inst.hasTag(tag), tag).toBe(true);
    }
    expect(inst.components.heater!.GetHeat()).toBe(115);
    expect(inst.light.json.value).toMatchObject({
      intensity: 0.5,
      falloff: 0.9,
      colour: [235 / 255, 121 / 255, 12 / 255],
    });
    expect(inst.minimap.icon).toBe('dragonfly_furnace.png');
    expect(inst.sprite.currentAnimation).toBe('hi');
    // OnEntityWake: the fire loop runs while the furnace is awake.
    expect(played()).toContain(FIRE_LOOP);

    vi.mocked(PlaySound).mockClear();
    inst.PushEvent('onbuilt');
    expect(inst.sprite.currentAnimation).toBe('place');
    expect(played()).toEqual(['dontstarve/common/together/dragonfly_furnace/place']);
    placement.update(30 * FRAMES);
    expect(played()).toContain('dontstarve/common/fireAddFuel');
    expect(played()).not.toContain(FIRE_LOOP);
    placement.update(10 * FRAMES);
    expect(played().slice(-2)).toEqual(['dontstarve/common/together/dragonfly_furnace/light', FIRE_LOOP]);

    const workable = inst.components.workable!,
      address = { containerId: 'world:dragonflyfurnace:furnace', slotKey: '0' };
    expect(inventory.getEntity(address)?.prefab).toBe('seeds');
    workable.WorkedBy(sceneDoer);
    expect(inst.sprite.currentAnimation).toBe('hi_hit');
    expect(inventory.getEntity(address)).toBeNull();
    expect(workable.GetWorkLeft()).toBe(5);
    workable.WorkedBy(sceneDoer, 5);
    expect(inst.isRemoved).toBe(true);
    const loot = dropLoot.mock.calls.flatMap(([items]) => items).map(({ itemId }: { itemId: string }) => itemId);
    expect(new Set(loot)).toEqual(new Set(['dragon_scales', 'redgem', 'charcoal']));
  } finally {
    placement.dispose();
    inventory.dispose();
  }
});

it('incinerates what its open container holds from the panel button or a right click, then reopens after the clip', async () => {
  const { inventory, placement } = setup();
  try {
    const model = placement.spawnFromSave('dragonflyfurnace', {
      id: 'furnace',
      transform: { position: [3, 0, -6], rotationY: 0 },
      components: {
        building: {},
        container: {
          items: {
            1: { id: 'stored-twigs', prefab: 'twigs', components: { stackable: { stack: 3 } } },
            2: { id: 'stored-grass', prefab: 'cutgrass', components: {} },
          },
        },
      },
    });
    const inst = prefabInstance<DragonflyFurnaceInstance>(model)!,
      container = inst.components.container!;
    await prefabDisplay(model)!.artLoaded();
    placement.update(FRAMES);
    // containers.lua params.dragonflyfurnace.itemtestfn refuses irreplaceable items.
    const spec = { name: '', maxStack: 1, icon: '' };
    expect(container.slots[3].accepts(spec, 'glommerflower')).toBe(false);
    expect(container.slots[3].accepts(spec, 'twigs')).toBe(true);
    // ShouldIncinerateItem keeps fruitcake and a container that still holds something.
    const item = (prefab: string, holds = false) =>
      ({
        prefab,
        hasTag: () => false,
        components: holds ? { container: { IsEmpty: () => false } } : {},
      }) as unknown as ItemEntity;
    const incinerator = inst.components.incinerator!;
    expect(incinerator.ShouldIncinerateItem(item('winter_food4'))).toBe(false);
    expect(incinerator.ShouldIncinerateItem(item('backpack', true))).toBe(false);
    expect(incinerator.ShouldIncinerateItem(item('twigs'))).toBe(true);

    // componentactions incinerator: only the right button, and only while the doer has the container open.
    expect(sceneActions(model, sceneDoer, true)).not.toContain('INCINERATE');
    expect(performRummageAction(findActionEntity(model)!, sceneDoer)).toBe(true);
    expect(sceneActions(model, sceneDoer, true)).toContain('INCINERATE');
    expect(sceneActions(model, sceneDoer, false)).not.toContain('INCINERATE');

    const twigs = inventory.getEntity({ containerId: 'world:dragonflyfurnace:furnace', slotKey: '0' })!;
    const burnt = vi.fn();
    twigs.ListenForEvent('onincinerated', burnt);
    vi.mocked(PlaySound).mockClear();
    // The widget button: BufferedAction(doer, inst, ACTIONS.INCINERATE):Do().
    expect(placement.performContainerAction(model, 'INCINERATE', sceneDoer)).toBe(true);
    expect(container.IsEmpty()).toBe(true);
    expect(twigs.isRemoved).toBe(true);
    expect(burnt.mock.calls[0].at(-1)).toMatchObject({ incinerator: inst, doer: sceneDoer });
    expect(container.IsOpen()).toBe(false);
    expect(container.canbeopened).toBe(false);
    expect(inst.sprite.currentAnimation).toBe('incinerate');
    expect(played()).toContain('qol1/dragonfly_furnace/incinerate');
    expect(sceneActions(model, sceneDoer)).not.toContain('RUMMAGE');
    // GetCurrentAnimationLength() - GetCurrentAnimationTime() + FRAMES: the 42-frame clip and one frame more.
    placement.update(42 * FRAMES);
    expect(container.canbeopened).toBe(false);
    placement.update(2 * FRAMES);
    expect(container.canbeopened).toBe(true);
    expect(sceneActions(model, sceneDoer)).toContain('RUMMAGE');
  } finally {
    placement.dispose();
    inventory.dispose();
  }
});

it('c_spawn and c_save keep a skinned furnace with its contents', async () => {
  const { inventory, placement } = setup();
  const restoredInventory = createPickupInventory(),
    restored = setup(restoredInventory);
  try {
    const spawn = async (id: string) => {
      if (id !== 'dragonflyfurnace') {
        return false;
      }
      placement.spawnFromSave('dragonflyfurnace', {
        id: 'furnace',
        transform: { position: [3, 0, -6], rotationY: 0 },
        skinname: 'dragonflyfurnace_crystal',
        components: { building: {} },
      });
      return true;
    };
    expect((await executeDebugCommand('c_spawn("dragonflyfurnace"); c_give("twigs", 4)', inventory, spawn)).ok).toBe(
      true,
    );
    const address = { containerId: 'world:dragonflyfurnace:furnace', slotKey: '1' };
    expect(inventory.transfer(inventorySlotAddress(0), address, 4)).toBe(true);
    let json = '';
    expect(
      (
        await executeDebugCommand('c_save()', inventory, undefined, () => {
          const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
          json = serializeSave(
            template,
            {
              entities: {
                dragonflyfurnace: placement.exportRecords().map(({ record }) => ({
                  ...record,
                  transform: { ...record.transform, position: [...record.transform.position] },
                })),
              },
              inventory: inventory.exportSaved(),
              elapsedSeconds: 0,
              playerTransform: { position: [0, 0, 0], rotationY: 0 },
            },
            SAVE_CATALOG,
          );
        })
      ).ok,
    ).toBe(true);
    const [record] = deserializeSave(json, SAVE_CATALOG).world.entities.dragonflyfurnace;
    expect(record.transform.position).toEqual([3, 0, -6]);
    expect(record.skinname).toBe('dragonflyfurnace_crystal');
    const loaded = prefabInstance(restored.placement.spawnFromSave('dragonflyfurnace', record))!;
    expect(loaded.skinId).toBe('dragonflyfurnace_crystal');
    expect(restoredInventory.getEntity(address)?.snapshot()).toMatchObject({ itemId: 'twigs', count: 4 });
  } finally {
    placement.dispose();
    inventory.dispose();
    restored.placement.dispose();
    restoredInventory.dispose();
  }
});
