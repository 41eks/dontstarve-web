import * as THREE from 'three';
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../../src/animate', () => ({ backTasks: [] }));
vi.mock('../../../src/camera', () => ({ camera: new THREE.PerspectiveCamera(60, 1, 0.1, 1000) }));
vi.mock('../../../src/player', () => ({ player: new THREE.Group() }));
vi.mock('../../../src/universal', () => ({
  renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }) } },
}));

import { createChestInventoryPanel } from '../../../src/chestInventoryPanel';
import { backTasks } from '../../../src/animate';
import { camera } from '../../../src/camera';
import { player } from '../../../src/player';
import type { DstChestPanelElement } from '../../ui/src/chest-panel';

beforeEach(() => {
  backTasks.length = 0;
  player.clear();
  player.position.set(0, 0, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1));
  head.position.y = 2;
  player.add(head);
  camera.position.set(0, 8, 20);
  camera.lookAt(0, 2, 0);
  camera.updateMatrixWorld();
});

it.each(['treasurechest', 'icebox', 'dragonflychest', 'saltbox'] as const)('anchors the %s panel above the moving player and keeps it visible through closing', (prefab) => {
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
  const controller = createChestInventoryPanel(element as unknown as DstChestPanelElement, prefab);
  const chest = new THREE.Group();
  chest.position.set(10, 0, 0);
  chest.userData.entityId = 'chest';
  controller.setOpen(chest, true);
  const expected = (x: number) => {
    const point = new THREE.Vector3(x, 5, 0).project(camera);
    return [(point.x + 1) * 400, (1 - point.y) * 400];
  };
  expect(element.hidden).toBe(false);
  expect(element.setAnchor).toHaveBeenLastCalledWith(...expected(0));
  player.position.x = 3;
  backTasks.forEach((update) => update(0));
  expect(element.setAnchor).toHaveBeenLastCalledWith(...expected(3));
  controller.setOpen(chest, false);
  expect(element.hidden).toBe(false);
  player.position.x = 4;
  backTasks.forEach((update) => update(0));
  expect(element.setAnchor).toHaveBeenLastCalledWith(...expected(4));
  element.isClosing = false;
  backTasks.forEach((update) => update(0));
  expect(element.hidden).toBe(true);
});
