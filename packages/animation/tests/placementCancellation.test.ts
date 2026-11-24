import { fixedCamera } from '../../prefab/src/followcamera';
import { withEntity } from './entityFixture';
import { testLocomotor } from './testLocomotor';
import { playerDoer } from './playerDoer';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import { actionTool } from './actionFixtures';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { disposePlacingPlayers, placingPlayer } from './placingPlayer';
import { InstancedArchiveSprites, type InstancedSprite } from '../src/instancedArchiveSprites';
import { PrefabDisplayGroup, SpriteResources, SpriteState } from '../../display/src';
import { BuildingPlacer } from '../../prefab/src/buildingPlacer';
import { buildingPlacer } from '../../prefab/src/building';
import { PrefabEntityManager, PrefabInstance } from '../../prefab/src/prefabInstance';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import type { WorldContext } from '../../prefab/src/worldContext';
import { displayLightOverride } from '../../display/src/displaySprites';
import { InventorySlot, inventorySlotAddress } from '../../inventory/src';
import { EventEmitter, createEquipmentExistenceState, createSignal } from '../../signals/src';
import type { PlayerActionEvents } from '../../stategraphs/src/actionEvents';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import { registerActionEntity, disposeActionEntity, findActionEntity } from '../../prefab/src/actionEntity';
import { GroundItemAssets } from '../../prefab/src/groundItems';
import { bufferingStategraph } from './bufferingStategraph';
import { slotWith, testInventoryStore } from './testInventory';

/** Fetches of the mirrored assets wait for this, when a test holds them back. */
let fetchGate: Promise<void> | undefined;
/** The shared-batch instances retained so far, in order, and those released since. */
const retained: InstancedSprite[] = [];
const released = new Set<InstancedSprite>();
/** Those not released yet, drawn in `scene`: a test's own entities, whatever art an earlier test's entities finish loading. */
const live = (scene: THREE.Scene) =>
  retained.filter(instance => {
    if (released.has(instance)) {
      return false;
    }
    let node: THREE.Object3D | null = (instance as unknown as { model: THREE.Object3D }).model;
    while (node && node !== scene) {
      node = node.parent;
    }
    return node === scene;
  });

beforeEach(() => {
  fetchGate = undefined;
  retained.length = 0;
  released.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      await fetchGate;
      const relative = url.slice(url.indexOf('/dst/data/') + '/dst/data/'.length);
      try {
        return new Response(await readFile(new URL(`../../../public/dst/data/${relative}`, import.meta.url)));
      } catch {
        return new Response(null, { status: 404 });
      }
    }),
  );
  const retain = InstancedArchiveSprites.prototype.retain;
  vi.spyOn(InstancedArchiveSprites.prototype, 'retain').mockImplementation(function (
    this: InstancedArchiveSprites,
    ...args
  ) {
    const instance = retain.apply(this, args),
      dispose = instance.dispose;
    instance.dispose = () => {
      released.add(instance);
      dispose();
    };
    retained.push(instance);
    return instance;
  });
  vi.spyOn(GroundItemAssets.prototype, 'loadAnimation').mockResolvedValue({} as never);
  vi.spyOn(GroundItemAssets.prototype, 'loadBuild').mockResolvedValue({} as never);
  vi.stubGlobal('window', new EventTarget());
});

afterEach(() => {
  disposePlacingPlayers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

/** A building's build flow as the application wires it: its placer, and the shared manager that spawns what it builds. */
function buildingFlow(world: WorldContext, onbuilt: () => void) {
  // The placer and the building it spawns draw treasure_chest's shared archive in the batches.
  const declaration = {
    archive: 'treasure_chest.zip',
    name: 'Building',
    buildLabel: 'building',
    idleAnimation: 'closed',
    skinArchives: { treasurechest_cake: 'dynamic/treasurechest_cake.zip' },
  };
  const displays = new PrefabDisplayGroup(world.scene),
    sprites = new SpriteResources();
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(
    displays,
    undefined,
    {},
    {
      building: {
        fn: () => {
          const inst = new PrefabInstance('building', new SpriteState({ name: 'closed', billboard: true }));
          inst.ListenForEvent('onbuilt', onbuilt);
          return inst;
        },
        assets: { animationArchive: declaration.archive, buildArchives: [declaration.archive], bank: 'chest' },
        assetOptions: { instancedAnimations: 'all' },
        skins: declaration.skinArchives,
      },
    },
  );
  const placer = new BuildingPlacer<'building'>(
    world,
    () => buildingPlacer(declaration, 'chest'),
    () => true,
  );
  let disposed = false;
  return {
    placer,
    prefabs,
    begin: (buildId: 'building', skinId?: string) => placer.begin(buildId, skinId),
    spawn: (buildId: 'building') => {
      prefabs.spawn(buildId, placer.groundInFrontOfPlayer());
    },
    exportRecords: () => prefabs.exportRecords(),
    get renderEntities() {
      return [...displays.renderEntities, ...placer.renderEntities];
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      placer.dispose();
      prefabs.dispose();
      displays.dispose();
      sprites.dispose();
    },
  };
}

function setup() {
  const cursor = { hidden: true };
  const canvas = new EventTarget();
  const cameraFacing = createSignal(8);
  const world = {
    actionEvents: new EventEmitter<PlayerActionEvents>(),
    scene: new THREE.Scene(),
    player: new THREE.Object3D(),
    ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(),
    cameraFacing,
    cameraHeading: createSignal(45),
    TheCamera: fixedCamera(45),
    renderer: { domElement: canvas },
    createCursorLabel: () => ({
      show: () => {
        cursor.hidden = false;
      },
      hide: () => {
        cursor.hidden = true;
      },
      update: () => {},
    }),
  } as unknown as WorldContext;
  vi.spyOn(PointerRaycaster.prototype, 'trackPointer').mockImplementation(() => {});
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(new THREE.Vector3(3, 0, 4));
  vi.spyOn(PointerRaycaster.prototype, 'isOverGround', 'get').mockReturnValue(true);
  const store = testInventoryStore(
    [{ address: inventorySlotAddress(0), slot: slotWith(new InventorySlot(), { itemId: 'log', count: 2 }) }],
    {
      log: { name: 'log', maxStack: 20, icon: 'log.tex' },
      building: { name: 'building', maxStack: 40, icon: 'building.tex' },
    },
  );
  const recipe = {
    recipeId: 'building',
    productId: 'building',
    productCount: 1,
    ingredients: { log: 2 },
    buffered: true,
  };
  expect(store.craft(recipe, 'treasurechest_cake')).toBe(true);
  const onbuilt = vi.fn();
  const placement = buildingFlow(world, onbuilt);
  const spawn = vi.fn((id: string, point: THREE.Vector3, skin?: string) =>
    placement.prefabs.spawn(id, point, undefined, skin),
  );
  const validity = { allowed: true };
  const player = placingPlayer(world, placement.placer, spawn, store, () => validity.allowed);
  const begin = () => placement.begin('building', store.bufferedSkin('building'));
  const click = (button: number) => {
    player.click(button === 0 ? 'PRIMARY' : 'SECONDARY');
    if (button === 0) {
      player.place();
    }
  };
  return { world, cameraFacing, cursor, store, recipe, spawn, onbuilt, placement, begin, click, player, validity };
}

it('an accepted action cancels a paid preview through events and skips its own cancellation', async () => {
  const { world, store, placement, begin, spawn, cursor } = setup();
  await placement.spawn('building');
  const existing = world.scene.children[0];
  await begin();
  const paidState = store.exportState();
  const preview = world.scene.children[1];
  await vi.waitFor(() => expect(lookupPrefabInstance(preview)!.sprite.loaded).toBe(true));
  // The building and the placer are each drawn by their resources' shared batches.
  expect(live(world.scene)).toHaveLength(2);
  const released = vi.spyOn(live(world.scene)[1], 'dispose');
  const equipped = createEquipmentExistenceState('HANDS');
  const tool = actionTool('reskin_tool');
  const model = withEntity(new THREE.Group(), 'icebox');
  world.scene.add(model);
  model.position.set(400, 0, 0); // out of the player's reach, so the walk never arrives
  const target = registerActionEntity(lookupPrefabInstance(model)!);
  const animation = bufferingStategraph();
  // The player walks towards the target with its own locomotor; it never arrives, so the cast is never buffered.
  const controller = new PlayerController(
    world,
    animation.graph,
    testLocomotor(world.player).locomotor,
    equipped,
    playerDoer(withEntity(world.player, 'wilson')),
  );
  const cast = () =>
    controller.DoAction(controller.createAction({ action: 'CASTSPELL', target, invobject: tool.entity })!);
  const cancel = vi.spyOn(controller, 'cancel');
  try {
    // Without the tool in hand the action is invalid: nothing begins.
    expect(cast()).toBe(false);
    expect(world.scene.children).toEqual([existing, preview, model]);
    expect(cancel).not.toHaveBeenCalled();
    world.actionEvents!.emit('action:interrupt', { reason: 'slot-select' });
    expect(world.scene.children).toEqual([existing, preview, model]);
    expect(store.exportState()).toEqual(paidState);
    cancel.mockClear();
    equipped.set(tool);
    expect(cast()).toBe(true);
    expect(cancel).toHaveBeenCalledOnce(); // The owner resets itself once; its event skips itself.
    expect(world.scene.children).toEqual([existing, model]);
    expect(released).toHaveBeenCalledOnce();
    expect(cursor.hidden).toBe(true);
    expect(store.exportState()).toEqual(paidState);
    expect(spawn).not.toHaveBeenCalled();
    world.actionEvents!.emit('action:interrupt', { reason: 'drop' });
    expect(controller.bufferedAction).toBeDefined();
    world.actionEvents!.emit('action:interrupt', { reason: 'slot-select' });
    expect(controller.bufferedAction).toBeUndefined();
    expect(animation.sg.pushBufferedAction).not.toHaveBeenCalled();
    controller.dispose();
    cancel.mockClear();
    world.actionEvents!.emit('action:interrupt', { reason: 'emote' });
    expect(cancel).not.toHaveBeenCalled();
    expect(store.exportState()).toEqual(paidState);
  } finally {
    controller.dispose();
    disposeActionEntity(findActionEntity(model));
    placement.dispose();
    store.dispose();
  }
});

it('walks to the recipe placement point and builds only on the dolongaction hit frame', async () => {
  const { world, store, spawn, onbuilt, placement, begin, player } = setup();
  const { walk, animation } = player;
  await begin();
  const preview = world.scene.children[0];
  const slot = new THREE.Vector3(3, 0, 4);
  expect(player.click()).toBe(true);
  // The placer is released and the player sets off; nothing is spent or placed yet.
  expect(preview.parent).toBeNull();
  expect(walk.walking).toBe(true);
  expect([walk.locomotor.destination?.x, walk.locomotor.destination?.z]).toEqual([slot.x, slot.z]);
  expect(world.player.position.toArray()).toEqual([0, 0, 0]);
  expect(spawn).not.toHaveBeenCalled();
  expect(placement.exportRecords()).toHaveLength(0);

  walk.arrive();
  expect(animation.last?.action).toBe('BUILD');
  expect(animation.graph.stateName).toBe('dolongaction');
  expect(spawn).not.toHaveBeenCalled();
  animation.hit();
  expect(spawn).toHaveBeenCalledOnce();
  expect(store.count('building')).toBe(0);
  expect(store.isBuffered('building')).toBe(false);
  expect(onbuilt).toHaveBeenCalledTimes(1);
  const [placed] = placement.exportRecords();
  expect(placed.record.transform.position).toEqual([slot.x, 0, slot.z]);
});

it('right-click removes the preview and lets the paid build resume', async () => {
  const { world, cursor, store, recipe, spawn, onbuilt, placement, begin, click } = setup();
  await placement.spawn('building');
  const existing = world.scene.children[0];
  await begin();
  const preview = world.scene.children[1];
  expect(displayLightOverride(preview)).toBe(1);
  expect(placement.renderEntities.map(({ object }) => object)).toContain(preview);
  const paidState = store.exportState();
  expect(cursor.hidden).toBe(false);

  click(2);
  expect(preview.parent).toBeNull();
  expect(world.scene.children).toEqual([existing]);
  expect(cursor.hidden).toBe(true);
  expect(store.exportState()).toEqual(paidState);
  expect(spawn).not.toHaveBeenCalled();
  expect(onbuilt).not.toHaveBeenCalled();
  click(0);
  expect(spawn).not.toHaveBeenCalled();
  expect(placement.exportRecords()).toHaveLength(1);

  expect(store.craft(recipe)).toBe(false);
  expect(store.bufferedSkin('building')).toBe('treasurechest_cake');
  await begin();
  expect(store.exportState()).toEqual(paidState);
  expect(lookupPrefabInstance(world.scene.children[1])?.skinId).toBe('treasurechest_cake');
  click(0);
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(displayLightOverride(world.scene.children[1])).toBe(0);
  expect(store.isBuffered('building')).toBe(false);
  expect(store.count('building')).toBe(0);
  expect(store.count('log')).toBe(0);
  expect(placement.exportRecords()).toHaveLength(2);
  expect(onbuilt).toHaveBeenCalledTimes(1);
});

it('does not resurrect a preview cancelled while assets load', async () => {
  const { world, cursor, store, spawn, placement, begin, click } = setup();
  let release!: () => void;
  fetchGate = new Promise(done => {
    release = done;
  });
  const pending = begin();
  await new Promise(resolve => setTimeout(resolve, 0));
  const paidState = store.exportState();
  click(2);
  expect(cursor.hidden).toBe(true);
  expect(store.exportState()).toEqual(paidState);

  await begin();
  const resumed = world.scene.children[0];
  release();
  await pending;
  // Whatever the cancelled placer's load built is released: only the resumed placer stays in the batches.
  await vi.waitFor(() => expect(lookupPrefabInstance(resumed)!.sprite.loaded).toBe(true));
  expect(live(world.scene)).toHaveLength(1);
  expect(world.scene.children).toEqual([resumed]);
  expect(cursor.hidden).toBe(false);
  expect(spawn).not.toHaveBeenCalled();
  click(0);
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(placement.exportRecords()).toHaveLength(1);
});

it('disposal releases the placed sprites, preview and pointer once', async () => {
  const { placement, begin, world, click, spawn } = setup();
  const pointerDispose = vi.spyOn(PointerRaycaster.prototype, 'dispose');
  await placement.spawn('building');
  await begin();
  await vi.waitFor(() => {
    for (const model of world.scene.children) {
      expect(lookupPrefabInstance(model)!.sprite.loaded).toBe(true);
    }
  });
  // The building or wall and its placer each release their instance in the shared batches.
  const resources = live(world.scene).map(instance => vi.spyOn(instance, 'dispose'));
  expect(resources).toHaveLength(2);
  placement.dispose();
  placement.dispose();
  expect(world.scene.children).toEqual([]);
  expect(placement.exportRecords()).toEqual([]);
  expect(placement.renderEntities).toEqual([]);
  expect(pointerDispose).toHaveBeenCalledOnce();
  expect(placement.placer.active).toBe(false);
  resources.forEach(resource => expect(resource).toHaveBeenCalledOnce());
  click(0);
  expect(spawn).not.toHaveBeenCalled();
  // A disposed build flow refuses a new placer.
  await expect(async () => begin()).rejects.toThrow('disposed');
});

it('revalidates the recipe point at the build hit frame and preserves the paid skin on failure', async () => {
  const { begin, player, validity, store, spawn, placement } = setup();
  try {
    await begin();
    validity.allowed = false;
    expect(player.click()).toBe(true);
    expect(player.walk.walking).toBe(false);
    expect(placement.placer.active).toBe(true);
    validity.allowed = true;
    expect(player.click()).toBe(true);
    player.walk.arrive();
    validity.allowed = false;
    expect(player.animation.hit()).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
    expect(store.bufferedSkin('building')).toBe('treasurechest_cake');
    expect(placement.exportRecords()).toHaveLength(0);
  } finally {
    player.dispose();
    placement.dispose();
    store.dispose();
  }
});
