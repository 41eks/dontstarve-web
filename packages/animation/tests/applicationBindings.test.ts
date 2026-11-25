import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createSignal, EventEmitter } from '@dontstarve-web/signals';
import { inventorySlotAddress } from '@dontstarve-web/inventory';
import type { BookWorld } from '@dontstarve-web/prefab/books';
import type { PlayerInstance } from '@dontstarve-web/prefab/player_common';
import { createChestInventoryPanel, createFollowText, type SlotContextMenuRequest } from '@dontstarve-web/ui';
import { createApplicationBindings } from '../../../src/applicationBindings';
import { bindInventoryContextMenu } from '../../../src/inventoryContextMenu';
import type { DisposalEvents } from '../../../src/scene';
import { setupEmoteWheel } from '../../../src/emoteWheel';
import { buildingContainerId, createBuildingContainer } from '../../prefab/src/containers';
import { createEmptyEntity } from '../../prefab/src/prefabInstance';
import { Locomotor } from '../../prefab/src/locomotor';
import { createPickupInventory } from './pickupFixture';
import { wilsonPlayer } from './wilsonPlayer';

const tasks = vi.hoisted(() => new Set<(dt: number) => void>());
vi.mock('../../../src/animate', () => ({
  registerFrontTask(update: (dt: number) => void) {
    tasks.add(update);
    return () => tasks.delete(update);
  },
}));
vi.mock('@dontstarve-web/ui', () => ({
  createChestInventoryPanel: vi.fn(() => ({
    open: vi.fn(),
    close: vi.fn(),
    bindActions: vi.fn(),
    dispose: vi.fn(),
  })),
  createFollowText: vi.fn(() => ({ update: vi.fn(), dispose: vi.fn() })),
}));
vi.mock('../../../src/emoteWheel', () => ({ setupEmoteWheel: vi.fn(() => vi.fn()) }));
vi.mock('../../../src/InputManager', () => ({ bindWorldControls: vi.fn(() => vi.fn()) }));

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  tasks.clear();
});

function setup() {
  const inventory = createPickupInventory();
  const playerEntity = wilsonPlayer(
    () => 1,
    player => {
      player.components.inventory = inventory;
    },
  );
  const player = playerEntity.transform.model;
  const contextMenu = createSignal<SlotContextMenuRequest | null>(null);
  const dialog = {
    chestPanel: new EventTarget(),
    cookPotPanel: new EventTarget(),
    iceBoxPanel: new EventTarget(),
  };
  const gameUi = {
    ...dialog,
    emoteWheel: {},
    inventoryBar: {
      contextMenu,
      containers: [{ id: 'player:inventory' }],
      animateReceive: vi.fn(),
    },
    statusHud: { advanceAnimation: vi.fn(), dispose: vi.fn() },
  };
  const view = {
    scene: new THREE.Scene(),
    player,
    camera: new THREE.PerspectiveCamera(),
    renderer: { domElement: new EventTarget() },
  };
  const screenPosition = { x: 200, y: 150 };
  const screenProjection = { GetScreenPos: vi.fn(() => screenPosition) };
  const actionEvents = new EventEmitter();
  const options = {
    gameUi,
    inventory,
    screenProjection,
    view,
    playerEntity,
    actionEvents,
    inventorySlotItem: vi.fn(),
    isActionInterrupting: () => false,
    updateCursor: vi.fn(),
    locomotor: new Locomotor({ position: player.position, velocity: new THREE.Vector3() }),
    turfMap: {},
  } as unknown as Parameters<typeof createApplicationBindings>[0];
  const firstPanel = vi.mocked(createChestInventoryPanel).mock.results.length;
  const bindings = createApplicationBindings(options);
  const panels = vi
    .mocked(createChestInventoryPanel)
    .mock.results.slice(firstPanel)
    .map(result => result.value);
  const disposalEvents = new EventEmitter<DisposalEvents>();
  const worldFx = { spawn: vi.fn() };
  const scene = { disposalEvents, buildingPlacement: {}, worldFx } as unknown as Parameters<
    typeof bindings.bindScene
  >[0];
  return {
    bindings,
    inventory,
    playerEntity,
    dialog,
    gameUi,
    contextMenu,
    panels,
    panelOptions: vi.mocked(createChestInventoryPanel).mock.calls[firstPanel][1],
    options,
    scene,
    disposalEvents,
    screenPosition,
    screenProjection,
    worldFx,
    dispose() {
      bindings.dispose();
      playerEntity.remove();
      inventory.dispose();
    },
  };
}

it('routes container events before scene binding and releases the scene subscriptions once', () => {
  const s = setup();
  const received = vi.spyOn(s.inventory, 'subscribeReceived');
  const menu = vi.spyOn(s.contextMenu, 'subscribe');
  const accessibility = vi.spyOn(s.inventory, 'setStorageAccessible');
  const { instance, display } = createEmptyEntity('treasurechest');
  const chest = createBuildingContainer('treasurechest', instance);
  const containerId = buildingContainerId('treasurechest', String(instance.entityId));
  try {
    expect(tasks.size).toBe(0);
    expect(received).not.toHaveBeenCalled();
    chest.Open(s.playerEntity);
    s.bindings.onContainerInteraction({ buildId: 'treasurechest', model: display.model, isOpen: true });
    expect(s.panels[0].open).toHaveBeenCalledWith(display.model, 'treasurechest', { containerId, slots: chest.slots });
    expect(accessibility).toHaveBeenLastCalledWith(containerId, true);
    s.dialog.chestPanel.dispatchEvent(new CustomEvent('game:chest-close', { detail: { containerId } }));
    expect(accessibility).toHaveBeenLastCalledWith(containerId, false);
    s.panelOptions.closeContainer(display.model);
    expect(chest.IsOpen()).toBe(false);
    s.bindings.onContainerInteraction({ buildId: 'treasurechest', model: display.model, isOpen: false });
    expect(s.panels[0].close).toHaveBeenCalledWith(display.model);

    s.bindings.bindScene(s.scene);
    expect(s.playerEntity.components.playercontroller).toBeDefined();
    expect(s.playerEntity.hasTag('reader')).toBe(true);
    s.playerEntity.setPosition(4, 0, 3);
    s.playerEntity.components.reader!.Read({
      components: {
        book: {
          OnRead: (_reader: PlayerInstance, world: BookWorld) => {
            world.spawnFx?.('fx_book_rain', s.playerEntity);
            return [true];
          },
        },
      },
    });
    expect(s.worldFx.spawn).toHaveBeenCalledExactlyOnceWith('fx_book_rain', new THREE.Vector3(4, 0, 3));
    expect(s.playerEntity.Map).toBeDefined();
    expect(menu).toHaveBeenCalledOnce();
    expect(setupEmoteWheel).toHaveBeenCalledWith(
      s.gameUi.emoteWheel,
      s.playerEntity,
      s.options.actionEvents,
      s.options.updateCursor,
    );
    for (const panel of s.panels) {
      expect(panel.bindActions).toHaveBeenCalledWith(s.scene.buildingPlacement);
    }
    const slot = inventorySlotAddress(0);
    received.mock.calls[0][0]([{ slot, itemId: 'rocks', delta: 2 }], { x: 4, y: 0, z: 3 });
    expect(s.screenProjection.GetScreenPos).toHaveBeenCalledWith(new THREE.Vector3(4, 0, 3));
    expect(s.gameUi.inventoryBar.animateReceive).toHaveBeenCalledWith(slot, s.screenPosition, 2);

    const [hudTask, followTextTask] = [...tasks].slice(-2);
    hudTask(0.25);
    followTextTask(0.25);
    expect(s.gameUi.statusHud.advanceAnimation).toHaveBeenCalledWith(0.25);
    const followText = vi.mocked(createFollowText).mock.results.at(-1)!.value;
    expect(followText.update).toHaveBeenCalledOnce();
    expect(tasks.size).toBe(4);

    s.disposalEvents.emit('dispose', undefined);
    s.disposalEvents.emit('dispose', undefined);
    expect(tasks.size).toBe(0);
    expect(s.playerEntity.components.playercontroller).toBeUndefined();
    expect(s.playerEntity.hasTag('reader')).toBe(false);
    expect(s.playerEntity.fishingHost).toBeUndefined();
    expect(s.playerEntity.Map).toBeUndefined();
    expect(s.options.view.registerFrameTask).toBeUndefined();
    expect(followText.dispose).toHaveBeenCalledOnce();
    for (const panel of s.panels) {
      expect(panel.dispose).toHaveBeenCalledOnce();
    }
    expect(s.gameUi.statusHud.dispose).toHaveBeenCalledOnce();
    expect(vi.mocked(setupEmoteWheel).mock.results.at(-1)!.value).toHaveBeenCalledOnce();
    accessibility.mockClear();
    s.dialog.chestPanel.dispatchEvent(new CustomEvent('game:chest-close', { detail: { containerId } }));
    expect(accessibility).not.toHaveBeenCalled();
  } finally {
    instance.remove();
    display.dispose();
    s.dispose();
  }
});

it('releases the early panels when startup fails before the scene is bound', () => {
  const s = setup();
  const subscribe = vi.spyOn(s.contextMenu, 'subscribe');
  try {
    s.bindings.dispose();
    s.bindings.dispose();
    expect(tasks.size).toBe(0);
    expect(subscribe).not.toHaveBeenCalled();
    expect(s.gameUi.statusHud.dispose).toHaveBeenCalledOnce();
    for (const panel of s.panels) {
      expect(panel.dispose).toHaveBeenCalledOnce();
    }
  } finally {
    s.dispose();
  }
});

it('drops the original stack at the action frame and leaves a replacement stack alone', () => {
  const inventory = createPickupInventory();
  const player = wilsonPlayer();
  const contextMenu = createSignal<SlotContextMenuRequest | null>(null);
  const stop = bindInventoryContextMenu(contextMenu, inventory, player, new EventEmitter());
  const drop = vi.spyOn(inventory, 'DropItem');
  const originalSlot = inventorySlotAddress(0);
  const replaceFrom = inventorySlotAddress(1);
  try {
    inventory.add('rocks', 2);
    inventory.add('twigs', 3);
    const original = inventory.getEntity(originalSlot)!;
    const replacement = inventory.getEntity(replaceFrom)!;
    const item = { id: 'rocks', entityId: original.id, name: 'Rocks', count: 2, maxStack: 40, icon: '' };
    const request = { slot: originalSlot, item, action: 'drop', shiftKey: false } as const;

    contextMenu.set(request);
    expect(drop).not.toHaveBeenCalled();
    expect(inventory.swap(originalSlot, replaceFrom)).toBe(true);
    player.sg.update(7 / 30);
    expect(drop).not.toHaveBeenCalled();
    expect(inventory.getEntity(originalSlot)).toBe(replacement);
    expect(inventory.getEntity(replaceFrom)).toBe(original);

    player.sg.update(1);
    contextMenu.set({ ...request, slot: replaceFrom });
    player.sg.update(7 / 30);
    expect(drop).toHaveBeenCalledExactlyOnceWith(original, player.position);
    expect(inventory.getEntity(originalSlot)).toBe(replacement);
    expect(inventory.getEntity(replaceFrom)).toBeNull();
  } finally {
    stop();
    player.remove();
    inventory.dispose();
  }
});
