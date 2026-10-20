import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EventEmitter } from '../../signals/src/EventEmitter';
import { createPickupInventory } from './pickupFixture';
import { createDisposalResources, registerDisposal, type DisposalEvents } from '../../../src/registerDisposal';
import { createChestInventoryPanel } from '@dontstarve-web/ui';
import { setupEmoteWheel } from '../../../src/emoteWheel';

const tasks = vi.hoisted(() => new Set<(dt: number) => void>());
const panelTasks = vi.hoisted(() => [] as (() => void)[]);
vi.mock('../../../src/animate', () => ({
  backTasks: panelTasks,
  registerFrontTask(update: (dt: number) => void) {
    tasks.add(update);
    return () => tasks.delete(update);
  },
}));
vi.mock('@dontstarve-web/ui', () => ({
  createChestInventoryPanel: vi.fn(() => ({
    setOpen: vi.fn(), bindActions: vi.fn(), dispose: vi.fn(),
  })),
  slotTransferController: { clearSelection: vi.fn() },
}));
vi.mock('../../../src/emoteWheel', () => ({ setupEmoteWheel: vi.fn(() => vi.fn()) }));
vi.mock('../../../src/playerStats', () => ({
  playerStats: { sanity: { peek: () => 35, set: vi.fn() } }, applyPlayerFoodEffects: vi.fn(),
}));

it('updates application resources until scene disposal, then releases them once', () => {
  const events = new EventEmitter<DisposalEvents>();
  const panel = { dispose: vi.fn() };
  const statusHud = { advanceClockAnimation: vi.fn(), dispose: vi.fn() };
  const frameController = { update: vi.fn(), dispose: vi.fn() };
  const actionController = { dispose: vi.fn() };
  const stopInventoryReceived = vi.fn(), stopEmoteWheel = vi.fn(), stopContextMenu = vi.fn();
  registerDisposal(events, {
    panels: [panel], statusHud,
    frameControllers: [frameController], actionControllers: [actionController],
    stopInventoryReceived, stopEmoteWheel, stopContextMenu,
  });
  try {
    for (const task of tasks) task(0.25);
    expect(statusHud.advanceClockAnimation).toHaveBeenCalledWith(0.25);
    expect(frameController.update).toHaveBeenCalledOnce();
    expect(panel.dispose).not.toHaveBeenCalled();

    new EventEmitter<DisposalEvents>().emit('dispose', undefined);
    expect(tasks.size).toBe(2);

    events.emit('dispose', undefined);
    events.emit('dispose', undefined);
    expect(tasks.size).toBe(0);
    for (const cleanup of [panel.dispose, statusHud.dispose,
      frameController.dispose, actionController.dispose,
      stopInventoryReceived, stopEmoteWheel, stopContextMenu]) {
      expect(cleanup).toHaveBeenCalledOnce();
    }
    expect(frameController.update).toHaveBeenCalledOnce();
  } finally {
    events.emit('dispose', undefined);
    tasks.clear();
  }
});

it('creates panels before scene initialization and owns subscriptions until explicit scene disposal', () => {
  const events = new EventEmitter<DisposalEvents>();
  const inventory = createPickupInventory();
  const stopReceived = vi.fn();
  const subscribeReceived = vi.spyOn(inventory, 'subscribeReceived').mockReturnValue(stopReceived);
  const stopContextMenu = vi.fn(), subscribeContextMenu = vi.fn(() => stopContextMenu);
  const player = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  const gameUi = { chestPanel: {}, cookPotPanel: {}, iceBoxPanel: {}, emoteWheel: {},
    inventoryBar: { contextMenu: { subscribe: subscribeContextMenu } },
    statusHud: { advanceClockAnimation: vi.fn(), dispose: vi.fn() } };
  const options = { gameUi, inventory, view: { player, camera, renderer: { domElement: {} } },
    actionEvents: new EventEmitter(), inventorySlotItem: vi.fn(), handEquipmentBinding: { flush: vi.fn() },
    isActionInterrupting: () => false, updateCursor: vi.fn(), locomotor: {}, pickupDoer: {}, turfMap: {},
  } as unknown as Parameters<typeof createDisposalResources>[0];
  const startIndex = vi.mocked(createChestInventoryPanel).mock.results.length;
  const resources = createDisposalResources(options);
  const panels = vi.mocked(createChestInventoryPanel).mock.results.slice(startIndex).map(result => result.value);
  try {
    expect(panels).toHaveLength(3);
    expect(panelTasks).toEqual([]);
    expect(subscribeReceived).not.toHaveBeenCalled();
    resources.setContainerOpen('cookpot', player, true);
    expect(panels[1].setOpen).toHaveBeenCalledWith(player, true, 'cookpot');
    const scene = { buildingPlacement: {} } as Parameters<typeof resources.register>[1];
    const actions = resources.register(events, scene);
    expect(actions.beginFood({ containerId: 'player', slotKey: '0' }, 'seeds')).toBe(false);
    expect(subscribeReceived).toHaveBeenCalledOnce();
    expect(subscribeContextMenu).toHaveBeenCalledOnce();
    expect(setupEmoteWheel).toHaveBeenCalledWith(gameUi.emoteWheel, options.view.renderer.domElement,
      undefined, options.actionEvents, options.updateCursor);
    for (const panel of panels) expect(panel.bindActions).toHaveBeenCalledWith(scene.buildingPlacement);
    for (const task of tasks) task(.25);
    expect(gameUi.statusHud.advanceClockAnimation).toHaveBeenCalledWith(.25);
    events.emit('dispose', undefined);
    events.emit('dispose', undefined);
    expect(tasks.size).toBe(0);
    expect(panelTasks).toEqual([]);
    for (const panel of panels) expect(panel.dispose).toHaveBeenCalledOnce();
    expect(stopReceived).toHaveBeenCalledOnce();
    expect(stopContextMenu).toHaveBeenCalledOnce();
    expect(vi.mocked(setupEmoteWheel).mock.results.at(-1)!.value).toHaveBeenCalledOnce();
  } finally {
    events.emit('dispose', undefined);
    inventory.dispose();
    subscribeReceived.mockRestore();
    tasks.clear();
    panelTasks.length = 0;
  }
});
