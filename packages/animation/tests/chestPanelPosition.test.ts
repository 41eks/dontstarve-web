import * as THREE from 'three';
import { beforeEach, expect, it, vi } from 'vitest';

import { createSignal, getWatchWorldContent, type GetWatchWorldContent, type WorldContentEnvironment } from '@dontstarve-web/signals';
import { createEmptyEntity, prefabInstance } from '../../prefab/src/prefabInstance';
import { buildingContainerId, containerPanelAnchor, createBuildingContainer } from '../../prefab/src/containers';
import { MakeBuildingContainer } from '../../prefab/src/building';
import { DefaultBurntStructureFn } from '../../prefab/src/standardcomponents';
import type { PrefabWorldContext } from '../../prefab/src/worldContext';
import { withEntity } from './entityFixture';
import { PLAYER_COLLIDER_RADIUS } from '../../prefab/src/player';
import { createChestInventoryPanel } from '../../ui/src/chest-inventory-panel';
import type { DstChestPanelElement } from '../../ui/src/chest-panel';

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
const player = new THREE.Group();
const canvas = {
  getBoundingClientRect: () => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 800, width: 800, height: 800,
    toJSON: () => ({}),
  }),
};

beforeEach(() => {
  player.clear();
  player.position.set(0, 0, 0);
  camera.position.set(0, 8, 20);
  camera.lookAt(0, 2, 0);
  camera.updateMatrixWorld();
});

it.each(['treasurechest'] as const)('anchors the %s panel above the moving player and keeps it visible through closing', async (prefab) => {
  const element = Object.assign(new EventTarget(), {
    hidden: true, isClosing: false, slotContainer: undefined as { id: string } | undefined,
    setAnchor: vi.fn(),
    open({ containerId }: { containerId: string }) { this.slotContainer = { id: containerId }; },
    close() {
      this.slotContainer = undefined;
      this.isClosing = true;
      (this as unknown as EventTarget).dispatchEvent(new Event('game:chest-close'));
    },
  });
  // The world republishes player positions; the panel follows that signal instead of a per-frame task.
  const playerpositions = createSignal<THREE.Vector3[]>([]);
  const world = { playerpositions, scheduler: {} } as unknown as WorldContentEnvironment;
  const republish = () => playerpositions.set([player.position.clone()]);
  let opener: ReturnType<typeof prefabInstance>;
  const closeContainer = vi.fn((model: THREE.Object3D) => prefabInstance(model)?.components.container?.Close(opener));
  const controller = createChestInventoryPanel(element as unknown as DstChestPanelElement, {
    camera, canvas, player, closeContainer,
    getWatchWorldContent: (key, registerCleanup, options) => getWatchWorldContent(key, registerCleanup, world, options),
  });
  const { instance, display } = createEmptyEntity(prefab);
  const chest = display.model;
  chest.position.set(10, 0, 0);
  instance.entityId = 'chest';
  opener = prefabInstance(withEntity(player, 'waxwell'))!;
  const container = instance.components.container = createBuildingContainer(prefab, instance);
  container.Open(opener);
  container.onclosefn = () => controller.close(chest);
  controller.open(chest, prefab, { containerId: buildingContainerId(prefab, 'chest'), slots: container.slots });
  const expected = (x: number) => {
    const point = new THREE.Vector3(x, PLAYER_COLLIDER_RADIUS * 3.6 + 1, 0).project(camera);
    return [(point.x + 1) * 400, (1 - point.y) * 400];
  };
  expect(element.hidden).toBe(false);
  expect(element.setAnchor).toHaveBeenLastCalledWith(...expected(0));
  player.position.x = 3;
  republish();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(element.setAnchor).toHaveBeenLastCalledWith(...expected(3));
  element.close();
  expect(closeContainer).toHaveBeenCalledWith(chest);
  expect(container.IsOpen()).toBe(false);
  expect(element.hidden).toBe(false);
  player.position.x = 4;
  republish();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(element.setAnchor).toHaveBeenLastCalledWith(...expected(4));
  element.isClosing = false;
  republish();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(element.hidden).toBe(true);
  controller.dispose(); container.dispose(); opener!.remove(); instance.remove(); display.dispose();
});

it('places a panel beside the player where the container declares it', () => {
  expect(containerPanelAnchor('treasurechest')).toBe('player-top');
  expect(containerPanelAnchor('mushroom_light2')).toBe('building-right');
  const setAnchor = vi.fn();
  const element = Object.assign(new EventTarget(), { hidden: true, isClosing: false, slotContainer: undefined as { id: string } | undefined,
    setAnchor, open({ containerId }: { containerId: string }) { this.slotContainer = { id: containerId }; }, close() { this.slotContainer = undefined; } });
  const world = { playerpositions: createSignal<THREE.Vector3[]>([]), scheduler: {} } as unknown as WorldContentEnvironment;
  const controller = createChestInventoryPanel(element as unknown as DstChestPanelElement, { camera, canvas, player, closeContainer: vi.fn(),
    getWatchWorldContent: (key, registerCleanup, options) => getWatchWorldContent(key, registerCleanup, world, options) });
  const pot = new THREE.Group();
  controller.open(pot, 'cookpot', { containerId: 'world:cookpot:pot', slots: [] });
  const centre = new THREE.Vector3(0, 0, 0).project(camera);
  expect(setAnchor.mock.lastCall![0]).toBeGreaterThan((centre.x + 1) * 400);
  controller.dispose();
});

it('closes the panel of a burnt building through its container, after dropping the contents', () => {
  const onContainerInteraction = vi.fn();
  const world = { playerpositions: createSignal<THREE.Vector3[]>([]), scheduler: {} } as unknown as WorldContentEnvironment;
  const { instance, display } = createEmptyEntity('treasurechest');
  instance.entityId = 'chest';
  const burnable = { canlight: true };
  (instance.components as { burnable?: unknown }).burnable = burnable;
  const watch: GetWatchWorldContent = (key, registerCleanup, options) => getWatchWorldContent(key, registerCleanup, world, options);
  const container = MakeBuildingContainer(instance, 'treasurechest', { onContainerInteraction, getWatchWorldContent: watch } as unknown as PrefabWorldContext);
  const opener = prefabInstance(withEntity(player, 'waxwell'))!;
  container.Open(opener);
  expect(onContainerInteraction).toHaveBeenLastCalledWith(expect.objectContaining({ isOpen: true, model: display.model }));
  DefaultBurntStructureFn(instance);
  expect(onContainerInteraction).toHaveBeenLastCalledWith(expect.objectContaining({ isOpen: false, model: display.model }));
  expect(burnable.canlight).toBe(false);
  expect(instance.components.container).toBeUndefined();
  opener.remove(); instance.remove(); display.dispose();
});
